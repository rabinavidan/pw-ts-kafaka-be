# Architecture Decision Records

This directory records the significant, sometimes non-obvious decisions behind this
framework's design — not as a changelog, but as the *why* behind choices a reader
would otherwise have to reverse-engineer from the diff. Each ADR captures the
alternatives that were actually on the table and why they lost, so a future change
that revisits one of these trade-offs starts from the real context instead of
re-litigating it from scratch.

Format is MADR-lite: **Status**, **Context**, **Decision**, **Consequences**, and
**Alternatives considered**. Status is `Accepted` for everything here — this project
doesn't yet have a `Superseded`/`Deprecated` entry, but the numbering is stable so a
future ADR can supersede one by reference instead of editing it in place.

| ADR | Title |
|-----|-------|
| [0001](0001-shared-postgresql-over-per-service-databases.md) | Shared PostgreSQL over per-service databases |
| [0002](0002-single-kafka-consumer-owns-event-log-writes.md) | A single Kafka consumer owns every `event_log` write |
| [0003](0003-mock-server-monolith-for-local-dev-and-ci-parity.md) | `mock-server.js`: one monolith mirrors five microservices |
| [0004](0004-serialize-kafka-touching-playwright-projects.md) | Serialize Kafka-touching Playwright projects (`workers: 1`) |
| [0005](0005-idempotent-consumption-and-dead-letter-queue.md) | Idempotent consumption via a computed dedupe key, plus a dead-letter queue |
| [0006](0006-contract-tests-for-kafka-event-payloads.md) | Contract tests, not convention, for Kafka event payload shapes |
| [0007](0007-one-trace-id-per-order-assigned-at-the-edge.md) | One trace id per order, assigned at the edge |
| [0008](0008-structured-json-logs-over-formatted-strings.md) | Structured JSON logs over formatted console strings |
| [0009](0009-pin-image-versions-and-lint-k8s-manifests-in-ci.md) | Pin container image versions and lint k8s manifests in CI |

See also [`docs/sequence-diagrams.md`](../sequence-diagrams.md) for the request/event
flows several of these ADRs assume — the order saga, trace-id propagation, and the
dead-letter/idempotency path — and [`AI.md`](../../AI.md) at the repo root for how
this codebase has actually been developed milestone by milestone.
