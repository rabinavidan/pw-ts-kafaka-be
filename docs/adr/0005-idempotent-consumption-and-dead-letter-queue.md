# ADR-0005: Idempotent consumption via a computed dedupe key, plus a dead-letter queue

**Status:** Accepted
**Date:** 2026-08-31

## Context

Kafka guarantees at-least-once delivery: `notification-service` (the sole
consumer of every topic — [ADR-0002](0002-single-kafka-consumer-owns-event-log-writes.md))
will, under producer retries or consumer-group rebalances, see the same message
more than once. Writing every consumed message straight to `event_log` would
double-count events on redelivery.

Separately, a message that fails to parse — malformed JSON, or any payload that
doesn't match what the consumer expects — is a real possibility in a system with
independent producers, and a naive consumer that throws on a bad message risks
stalling or crash-looping on that exact offset forever, blocking every message
behind it.

## Decision

Two related but independent mechanisms, both owned by `notification-service`:

1. **Idempotent consumption.** Every consumed message is written with a computed
   `dedupe_key` (an identity derived from `topic`, `event-type`, and the message
   key at consume time — not the message's own id, since Kafka doesn't guarantee
   one) and inserted via `INSERT ... ON CONFLICT (dedupe_key) WHERE dedupe_key IS
   NOT NULL DO NOTHING`, backed by a partial unique index on `event_log`. A
   redelivered message is expected, not exceptional, and simply no-ops.
2. **Dead-letter queue.** A message that fails `JSON.parse` is caught, published
   to the `dead-letter-queue` topic with the failure reason and original topic
   attached as headers, and the consumer keeps running — it never stalls or
   drops the failure silently.

## Consequences

- The consumer's correctness no longer depends on Kafka's delivery guarantees
  matching the database's uniqueness requirements — redelivery is handled at the
  write layer, not by trying to prevent redelivery from happening.
- A poison message costs exactly one DLQ entry and zero downtime for every message
  after it — proven by `tests/microservices/dead-letter-queue.spec.ts`'s "the
  consumer keeps processing valid messages after a poison one" test, which
  produces a poison message immediately followed by a valid one and asserts the
  valid one is still consumable.
- Deduping on a *computed* identity rather than the message's own id means two
  genuinely different events that happen to share `(topic, event-type, key)` at
  the same moment would collide — accepted as extremely unlikely in this system's
  event shapes, where the key is normally an order or payment UUID.
- Both mechanisms are exercised end to end in `idempotency.spec.ts` and
  `dead-letter-queue.spec.ts` against the real running stack, not a mocked
  consumer — the whole point being to prove the behavior against actual Kafka
  redelivery/parsing semantics, not just the intent of the code.

## Alternatives considered

**Rely on Kafka exactly-once semantics (transactional producers/consumers).**
Rejected — real operational complexity (transactional coordinator, `isolation.level`
tuning) for a guarantee this system doesn't need once the consumer is idempotent
on write.

**Drop unparseable messages silently.** Rejected — a silently dropped message is
undebuggable. Routing to a DLQ with the failure reason preserves the ability to
inspect and replay it.
