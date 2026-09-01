# ADR-0007: One trace id per order, assigned at the edge

**Status:** Accepted
**Date:** 2026-09-01

## Context

An order's lifecycle spans multiple services and Kafka topics: `orders-service`
publishes `order.created`/`order.confirmed`/`order.cancelled` to `orders`;
`payments-service` publishes `payment.initiated`/`payment.processed`/etc. to
`payments`, for a payment that belongs to that order. Before this decision, there
was no way to answer "show me everything that happened to order X" without
manually correlating rows by `order_id`/`payment_id` across two tables and
inferring the relationship — and no way at all to correlate log lines across
services for a single request/saga.

## Decision

The gateway assigns an `X-Trace-Id` to any request that doesn't already carry one,
then forwards it on every proxied request. `orders-service` stores it on the order
row (`orders.trace_id`). `payments-service`, when creating a payment, reads the
trace id back off the **parent order** rather than minting its own — a payment's
events stay part of its order's saga instead of starting a new trace. Every Kafka
publish carries it in a `trace-id` header; `notification-service` reads that
header off every message it consumes and persists it to `event_log.trace_id`
(indexed). `GET /api/v1/events?traceId=` and `orders`/`payments` responses all
echo it back (`X-Trace-Id` response header, `traceId` in the JSON body).

## Consequences

- `GET /api/v1/events?traceId=<id>` reconstructs one order's whole lifecycle, in
  creation order, across every topic it touched, with a single query — this only
  works because [ADR-0001](0001-shared-postgresql-over-per-service-databases.md)
  put every event in one table.
- A caller that already has its own tracing infrastructure can supply
  `X-Trace-Id` and have this system participate in it, rather than always
  minting a new, disconnected id — verified end to end by
  `tests/microservices/tracing.spec.ts`'s "a caller-supplied X-Trace-Id is
  honored end to end, not replaced" test.
- The trace id is a single opaque string threaded through headers and one DB
  column — no distributed tracing infrastructure (spans, a collector, sampling)
  is required to get the "follow one order across the system" story working.
  That's also the ceiling: there's no timing/latency breakdown per hop, only
  causal ordering by `created_at`. Full distributed tracing (OpenTelemetry,
  Jaeger/Tempo) was explicitly scoped out — see the note in PR #7 — as
  disproportionate infrastructure for what this project needs to demonstrate.
- `mock-server.js` replicates the identical trace-id logic (generate-or-honor at
  creation, propagate on every subsequent operation) so the same test file's
  DB-observable assertions hold in both runtime modes.

## Alternatives considered

**Full OpenTelemetry-style distributed tracing.** Rejected for now — a collector,
span propagation, and a trace UI (Jaeger/Tempo) would demonstrate a different
(and heavier) set of skills than this project's current scope. The single
trace-id-as-correlation-key approach gets the primary payoff — "follow one order
end to end" — without that infrastructure. Left open as a candidate for a later
milestone if the project's scope grows.

**A separate `trace_id` mapping table instead of a column on `orders`/`payments`.**
Rejected — it would require a join for every trace-id lookup that a single indexed
column avoids entirely.
