# ADR-0003: `mock-server.js` — one monolith mirrors five microservices

**Status:** Accepted
**Date:** 2026-08-30

## Context

The full stack (gateway + 4 services + Kafka + Postgres) needs either a kind
cluster or `docker-compose` plus five running Node processes to exercise end to
end. That's the right shape for the `microservices` Playwright project and for
demonstrating a real Kubernetes deploy, but it's a heavy prerequisite for the `api`,
`db`, `kafka`, and `integration` projects, and for anyone just trying to run the UI
locally without standing up the whole topology.

## Decision

`mock-server.js` implements the same REST API surface as the gateway + services —
same endpoints, same request/response shapes, same status codes, same trace-id
behavior — as a single process backed directly by PostgreSQL. `npm run dev` runs
it with the UI dev server for local development; CI's `test-be`, `test-db`, and
`test-e2e` jobs run against it instead of the full microservices stack.
`docker-compose.yml`'s `postgres` service is shared by both modes.

## Consequences

- Contributors and CI don't need Kafka running at all to validate the REST
  contract, the database layer, or the UI — only `test-microservices` and
  `test-kafka`/`test-integration` need a real broker.
- Every behavior change to the microservices' HTTP surface has to be ported to
  `mock-server.js` too, by hand — there's no code generation or shared handler
  layer between the two. This is a real maintenance cost, paid deliberately: the
  M3 trace-id and structured-logging changes, for example, touched
  `mock-server.js` and all four services in parallel, each with its own copy of
  the same `initDB()` migration and the same `traceId` generation logic.
- Because `mock-server.js` writes to `event_log` synchronously in the same
  request (no separate Kafka consumer process), tests that only need to observe
  HTTP-visible, database-backed behavior — not real Kafka delivery — can validate
  against it in an environment with no Kafka broker at all, which is exactly the
  gap this filled during local development for M3's tracing feature before its
  Kafka-dependent tests could be run in CI.
- Drift between the two implementations is the main risk this ADR accepts. There's
  no automated check that `mock-server.js` and the microservices stack stay
  behaviorally identical beyond both being exercised by (mostly) the same test
  suites against different `baseURL`s.

## Alternatives considered

**Require the full stack (or kind) for every test project.** Rejected — it would
make `npm test` a multi-minute, multi-process prerequisite for even the fastest
API tests, and raise the bar for contributing to the project considerably.

**Generate `mock-server.js` from the services' route definitions.** Not pursued —
the services are simple enough (a handful of routes each) that hand-maintaining
parity has been cheaper than building and maintaining a code generator, so far.
