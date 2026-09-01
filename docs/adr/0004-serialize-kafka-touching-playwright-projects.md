# ADR-0004: Serialize Kafka-touching Playwright projects (`workers: 1`)

**Status:** Accepted
**Date:** 2026-08-30 (kafka/integration), extended 2026-09-01 (microservices), buffer revised 2026-09-01

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
at once. Each such project also carries a generous `timeout` (currently 190s) to
absorb the rebalance cost, and `KafkaHelper.consume()` itself budgets
`timeoutMs + 120s` internally — raised twice already (45s → 75s → 120s) as each
prior buffer proved insufficient in practice; see Consequences for why this is
framed as an ongoing mitigation rather than a closed issue.

## Consequences

- Serializing removed *concurrent* rebalancing entirely, and did fix most of the
  flakiness. But it didn't fully eliminate it: even with only one consumer group
  ever joining at a time, the CI broker's group-coordinator was observed to
  occasionally take longer than the original 45s buffer on a single, uncontended
  join — a different test drew the "slow join" outcome on different runs
  (`order.cancelled` before serializing, `order.confirmed` after).
- **The buffer alone has not proven sufficient, twice.** Raising it to 75s held
  for exactly two CI runs (the PR that introduced it, plus the next milestone's
  PR) before recurring: a *docs-only* PR with zero code changes near Kafka
  reproduced the identical `order.confirmed matches its contract` failure twice
  in a row, including on a re-run. What makes this specific test notable isn't
  just that it's slow sometimes — it's that across every CI run observed so far,
  `order.confirmed` is the one that times out with **zero messages ever
  collected**, while its structurally-identical sibling `order.cancelled` (same
  publish shape, same two-messages-per-key pattern, running immediately after it
  in the same file) consistently succeeds in under a second. That's a much
  higher, more consistent failure rate for one specific test than "generic
  broker slowness spread evenly across ~20 Kafka-consuming calls" would predict,
  and comparing the two tests' producer code byte-for-byte turned up no
  discriminating difference. The root cause remains **unconfirmed**.
- While investigating this, a real bug was found and fixed: `KafkaHelper.consume()`
  called `consumer.disconnect()` immediately after the `waitUntil()` call that
  throws on timeout, so a timed-out consume() never disconnected its consumer —
  it leaked (heartbeat timers included) until the Playwright `kafka` fixture's own
  teardown ran, instead of the moment the timeout fired. Now wrapped in
  `try/finally`. This is a legitimate correctness fix regardless of whether it
  turns out to be a contributing factor here.
- The buffer is now 120s (raised from 75s for the same reason 75s was raised from
  45s). This is documented as a **pragmatic mitigation, not a resolution** — the
  buffer is a ceiling the wait exits from as soon as messages arrive, so widening
  it costs nothing for the common (fast) case, but if `order.confirmed`'s failure
  is a genuine delivery bug rather than slowness, no buffer size fixes it. If this
  recurs again, the next step is to instrument `notification-service`'s own
  consumption of the same message (does it receive `order.confirmed` promptly?)
  to determine whether this is specific to the test's ephemeral consumer group or
  a broader issue with that one message.
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
