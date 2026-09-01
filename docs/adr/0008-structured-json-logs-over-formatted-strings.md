# ADR-0008: Structured JSON logs over formatted console strings

**Status:** Accepted
**Date:** 2026-09-01

## Context

Before this decision, each service logged human-formatted, prefix-style strings
to the console (and the gateway logged nothing at all per-request). That reads
fine in a terminal during local development, but it isn't machine-parseable: a
log aggregator or `jq`-based query has to fall back to regex-scraping formatted
text, and the gateway's total silence meant there was no way to see per-request
activity flowing through it at all.

## Decision

Every service (gateway included) logs one JSON object per line:
`{timestamp, level, source, message, ...context}` — where `context` is whatever
structured fields the call site attached (`topic`, `key`, `eventType`, `traceId`,
etc.). No formatted-string logging remains in gateway, `orders-service`,
`payments-service`, `events-service`, `notification-service`, or `mock-server.js`.

## Consequences

- Every log line is valid JSON, parseable by `jq` or any log aggregator without a
  custom parser or regex.
- Context that used to live only in a trailing, loosely-structured object dump
  (or not be logged at all) is now a first-class, queryable field — e.g. every
  Kafka publish log line carries `{topic, key, eventType}`, making "show me every
  log line for this trace id" a `jq 'select(.traceId == "...")'` away once the
  trace id ([ADR-0007](0007-one-trace-id-per-order-assigned-at-the-edge.md)) is
  attached to the context.
- The gateway went from zero per-request logging to parity with its siblings —
  previously the one blind spot in the request path.
- Readability in a raw terminal is worse than the old formatted strings (a wall of
  JSON is harder to eyeball than `[INFO] orders: created order abc123`). Accepted
  as the right trade for CI log analysis and any future log-aggregation tooling;
  a local dev pretty-printer (piping through `jq` or similar) is the mitigation,
  not a code change.

## Alternatives considered

**A logging library with structured output built in (e.g. Winston, which is
already a dependency for the TypeScript test framework's own logger).** Not
adopted for the plain-Node services — they're deliberately dependency-light
(no `npm install` beyond what's already in `package.json`), and
`JSON.stringify({...})` on one line achieves the same machine-parseable outcome
without adding a runtime dependency to five separate service processes.
