# ADR-0004: Serialize Kafka-touching Playwright projects (`workers: 1`)

**Status:** Accepted
**Date:** 2026-08-30 (kafka/integration), extended 2026-09-01 (microservices)

## Context

`KafkaHelper.consume()` (`src/helpers/kafka.helper.ts`) spins up a brand-new,
uniquely-named consumer group (`${groupId}-${Date.now()}`) for every single call,
subscribes `fromBeginning: true`, and tears it down when the call finishes. This
gives each call full isolation from every other test's messages, at the cost of
paying a full consumer-group join and partition-rebalance on every call.

Playwright's default is to run different spec files across multiple parallel
workers (`workers: process.env.CI ? 2 : 4` at the top level of
`playwright.config.ts`). Under that default, two or more of these ephemeral
consumer-group joins can be in flight against the same broker at once, and the
broker's group-coordinator rebalancing under that concurrent load was measured to
add 15–20s of latency per join — enough to blow through a test's timeout budget.

This was first hit and fixed for the `kafka` and `integration` projects. The
`microservices` project didn't originally touch Kafka at all (pure HTTP tests
against each service), so it ran fine under the default worker count — until M2
and M3 added ~19 Kafka-consuming tests to it (idempotency, DLQ, event-contract,
and distributed-tracing specs), at which point it hit the identical failure mode:
CI's `Microservices Tests` job started intermittently timing out with two
different tests failing across runs (`order.cancelled`, then — after serializing —
`order.confirmed`), each stalled at the full internal timeout with zero messages
ever collected.

## Decision

Every Playwright project whose tests call `KafkaHelper.consume()` runs with
`workers: 1` (`kafka`, `integration`, and — since M3 — `microservices`), forcing
its tests to run one at a time so at most one ephemeral consumer group is joining
at once. Each such project also carries a generous `timeout` (90s–140s) to absorb
the rebalance cost, and `KafkaHelper.consume()` itself budgets `timeoutMs + 75s`
internally (raised from an initial 45s buffer after serializing still weren't
enough headroom for one project — see Consequences).

## Consequences

- Serializing removed *concurrent* rebalancing entirely, and did fix most of the
  flakiness. But it didn't fully eliminate it: even with only one consumer group
  ever joining at a time, the CI broker's group-coordinator was observed to
  occasionally take longer than the original 45s buffer on a single, uncontended
  join — a different test drew the "slow join" outcome on different runs
  (`order.cancelled` before serializing, `order.confirmed` after). The fix that
  actually closed this out was raising the buffer itself to 75s, not further
  serialization — the buffer is a ceiling the wait exits from as soon as messages
  arrive, so widening it costs nothing for the common (fast) case.
- The `microservices` project's test suite now runs measurably slower in CI (~5-6
  minutes instead of ~2-3) because 62 tests execute one at a time instead of
  across parallel workers. This is treated as acceptable: correctness over speed
  for a CI job that runs once per push, not per keystroke.
- Any new Kafka-consuming test file added to `kafka`, `integration`, or
  `microservices` inherits this serialization automatically — no per-test opt-in
  needed, but also no way for a future fast, non-Kafka test in the same project to
  regain parallelism without moving to its own project.

## Alternatives considered

**Reuse one consumer group across tests instead of a fresh one per call.**
Rejected — the whole value of `KafkaHelper.consume()`'s isolation is that a test
never has to worry about another test's messages, offsets, or a prior test's
rebalance state leaking in. Reusing groups would reintroduce exactly the coupling
this design avoids.

**Increase worker count but stagger consumer-group creation with a mutex.**
Not pursued — `workers: 1` achieves the same effect with far less code, at the
cost of wall-clock time this project doesn't need to optimize for.
