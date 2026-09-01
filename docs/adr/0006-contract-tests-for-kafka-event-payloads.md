# ADR-0006: Contract tests, not convention, for Kafka event payload shapes

**Status:** Accepted
**Date:** 2026-08-31

## Context

Every producer in the system (`orders-service`, `payments-service`,
`mock-server.js`) publishes events by hand-building a JS object and calling
`publish(topic, key, value, headers)` — there's no shared schema or code-generated
type enforcing what a given `event-type` must contain. Nothing stopped two
different code paths that both publish the same `event-type` from disagreeing on
shape.

That's exactly what happened during development: `payment.failed` was published
with two different, incompatible payload shapes depending on which code path
triggered it — `PUT /payments/:id/fail` versus `simulateFailure` on payment
creation. Both "worked" in isolation; nothing caught that a consumer expecting one
shape would silently mishandle the other.

## Decision

`src/utils/contract.ts` defines the required fields for every `event-type` this
system publishes, as a single source of truth independent of any one producer.
`tests/microservices/event-contracts.spec.ts` calls the real HTTP endpoints,
consumes the real Kafka message each one produces, and asserts it against that
contract — checking actual producer output, not a hand-built fixture standing in
for it.

## Consequences

- The `payment.failed` divergence above was caught and fixed *because* this test
  existed — both producing code paths were brought onto one shared shape.
- A future producer of an existing `event-type` gets an immediate, specific
  failure if its payload doesn't match, instead of a downstream consumer silently
  mishandling a field that's missing or differently named.
- The contract lives in test code, not in a schema registry or a runtime
  validation layer — nothing prevents a payload from violating fields at
  runtime, only from doing so in CI. That's a deliberate scope limit for this
  project: contract enforcement is a testing responsibility, not a Kafka
  broker/registry infrastructure investment (see
  [ADR-0009](0009-pin-image-versions-and-lint-k8s-manifests-in-ci.md) for the
  companion approach to CI-time validation of Kubernetes manifests).

## Alternatives considered

**A schema registry (e.g. Confluent Schema Registry, Avro/Protobuf).** Rejected as
disproportionate infrastructure for this project's actual scale — it would add a
new stateful service, a serialization format change across every producer and
consumer, and operational surface (schema compatibility rules, registry
availability) this system doesn't need to demonstrate the underlying idea:
contracts should be enforced somewhere, not left to convention.

**Trust code review to catch shape drift.** Rejected — it's exactly what failed
for `payment.failed` before this test existed.
