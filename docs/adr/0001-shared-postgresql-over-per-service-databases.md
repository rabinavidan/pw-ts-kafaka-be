# ADR-0001: Shared PostgreSQL over per-service databases

**Status:** Accepted
**Date:** 2026-08-30

## Context

The microservices topology splits the API surface into five services — `gateway`,
`orders`, `payments`, `events`, `notifications` — each conceptually owning a
different concern. Textbook microservices doctrine says each service should own
its own database, reachable only through that service's API.

This project instead runs every service against one shared PostgreSQL instance
(`mockdb`), with tables `orders`, `payments`, `event_log`, and
`kafka_consumer_offsets`. Ownership is enforced by convention, not by network or
schema isolation: `orders-service` is the only writer of `orders`,
`payments-service` the only writer of `payments`, `notification-service` the only
writer of `event_log` and `kafka_consumer_offsets` (see
[ADR-0002](0002-single-kafka-consumer-owns-event-log-writes.md)). `events-service`
reads `event_log` but never writes it.

## Decision

Use a single shared PostgreSQL database for the whole stack. Each service's
`initDB()` applies its own additive migration (`CREATE TABLE IF NOT EXISTS`,
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) against
the same schema on startup — there is no central migration runner. `db/init.sql`
mirrors the same schema for docker-compose/local dev bootstrap.

## Consequences

- One Postgres container (or one `postgres-svc` StatefulSet) to stand up instead
  of four — matches this project's actual operational scale (a test framework and
  demo stack, not a production system with independent scaling/ownership needs).
- Cross-entity queries stay cheap: `GET /api/v1/events?traceId=` and
  `tests/db/*.spec.ts` can join across `orders`, `payments`, and `event_log` in a
  single connection, which is exactly what makes
  [ADR-0007](0007-one-trace-id-per-order-assigned-at-the-edge.md)'s
  "reconstruct one order's whole lifecycle with a single query" possible.
- The trade-off is real, not free: a schema change (e.g. adding `trace_id`) has to
  land in every service's `initDB()` independently rather than in one place, and
  nothing at the database level stops a future service from writing to a table it
  doesn't own — that boundary is only as strong as code review.
- `mock-server.js` ([ADR-0003](0003-mock-server-monolith-for-local-dev-and-ci-parity.md))
  depends on this: a single-process monolith backed by one database is what lets
  it replicate the full microservices behavior without also standing up four
  independent databases.

## Alternatives considered

**Database per service.** Rejected. It's the textbook-correct choice for a real
production system, but here it would mean four Postgres instances (or four
schemas with cross-schema access blocked), four sets of connection config, and no
single-query way to answer "show me everything that happened to this order" — the
exact capability distributed tracing depends on. The isolation benefit doesn't pay
for itself at this project's scale.
