# ADR-0002: A single Kafka consumer owns every `event_log` write

**Status:** Accepted
**Date:** 2026-08-30

## Context

`orders-service` and `payments-service` publish Kafka events (`order.created`,
`order.confirmed`, `payment.initiated`, …) whenever they mutate state, and both
respond to their HTTP caller immediately without waiting on Kafka. Something still
needs to persist those events to `event_log` so `events-service` can serve the UI's
event feed and `GET /api/v1/events` can answer queries like "everything that
happened to order X" (see [ADR-0007](0007-one-trace-id-per-order-assigned-at-the-edge.md)).

The naive approach — have every producer also write its own event to `event_log`
synchronously — would work, but couples every future producer to the event-log
schema and creates two write paths (HTTP handler + Kafka publish) that can drift
out of sync if one is changed without the other.

## Decision

`notification-service` is the *sole* Kafka consumer in the system. It subscribes
to all five topics (`orders`, `payments`, `notifications`, `dead-letter-queue`,
`audit-events`) and is the only service that writes to `event_log`. `orders-service`
and `payments-service` publish and forget; `events-service` only ever reads.

## Consequences

- No service shares a write path to `event_log` with another — eliminating a class
  of coupling bugs without needing a saga/orchestrator to coordinate it.
- The event feed's freshness is bounded by consumer lag, not request latency: a
  caller's HTTP response returns before the event is durably recorded in
  `event_log`, which is what makes
  [idempotent consumption](0005-idempotent-consumption-and-dead-letter-queue.md) a
  requirement, not an optimization — at-least-once Kafka delivery means
  `notification-service` *will* see redelivered messages.
- `mock-server.js` has to replicate this ordering deliberately: it writes to
  `event_log` synchronously inside the same request that publishes to Kafka
  (there's no separate consumer process in monolith mode), which is why the
  distributed-tracing tests that only need HTTP-visible behavior — not real Kafka
  delivery — can run against it directly in the sandbox instead of needing a live
  broker.
- Adding a sixth topic means updating `notification-service`'s subscription list,
  not touching every producer.

## Alternatives considered

**Producers also write `event_log` directly.** Rejected — two write paths per
event type (the DB write and the Kafka publish) that can silently diverge, and no
single place to enforce the contract every event must satisfy
([ADR-0006](0006-contract-tests-for-kafka-event-payloads.md)).

**A saga/orchestrator service.** Rejected as overkill for this system's actual
consistency needs — nothing here requires compensating transactions or a
coordinator with its own state machine; a single consumer with an idempotent write
path is sufficient and much simpler to reason about.
