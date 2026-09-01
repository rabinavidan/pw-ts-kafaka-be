# ADR-0009: Pin container image versions and lint k8s manifests in CI

**Status:** Accepted
**Date:** 2026-09-01

## Context

Every service's `Dockerfile` was built `FROM node:20-slim` — a floating tag that
resolves to whatever the latest `20.x` patch happens to be on any given build day.
The UI's runtime stage floated on `nginx:alpine` the same way, and
`docker-compose.yml`'s dev-convenience services (`kafka-ui`, `pgadmin`) floated on
`:latest`. None of this breaks anything most of the time, but it means the exact
same `docker build` command can produce a materially different image on two
different days, with no record of which patch version actually shipped — the
opposite of a reproducible build.

Separately, the twelve `k8s/*.yaml` manifests (Namespace, ConfigMap, two
StatefulSets, a Job, and six Deployments) had no automated validation at all. A
typo or a schema-invalid field (wrong indentation under `resources`, a probe
pointed at a nonexistent port) would only surface the first time someone actually
ran `kubectl apply -f k8s/` against a real cluster — which for most contributors
is not part of their everyday inner loop.

## Decision

Pin every floating image tag to an exact, verified-to-exist version:
`node:20-slim` → `node:20.20.0-slim` and `nginx:alpine` → `nginx:1.30.4-alpine`
across all seven Dockerfiles; `provectuslabs/kafka-ui:latest` → `v0.7.2` and
`dpage/pgadmin4:latest` → `9.13.0` in `docker-compose.yml`.

Add a `manifest-lint` CI job that runs `kubeconform -strict` (pinned to `v0.7.0`)
against every `k8s/*.yaml` file, plus `docker compose config` against
`docker-compose.yml` — both also runnable locally via `make k8s-lint`, so the same
check that gates CI can be run before pushing.

## Consequences

- A `docker build` today and the same command run months from now produce the
  same base layers, unless someone deliberately bumps the pinned tag.
- A manifest typo or schema violation now fails fast in CI (`Manifest Lint`
  passed/failed in ~7 seconds in practice) instead of only surfacing against a
  real cluster.
- Pinned tags need deliberate, periodic bumping — nothing here auto-updates them.
  That's an accepted maintenance cost in exchange for reproducibility; a
  Dependabot/Renovate-style bot for Docker tags was not set up as part of this
  change.
- Two categories of image reference were deliberately left alone: the app images
  in `k8s/*.yaml` (`gateway:latest`, `orders-service:latest`, etc.) are loaded
  locally via `kind load docker-image` per the documented kind workflow, never
  pulled from a registry — `:latest` there names a locally-built artifact, not a
  supply-chain floating-tag risk. And `postgres:16-alpine` plus the Confluent
  Kafka/Zookeeper images were already pinned to a specific major.minor, which is
  standard, accepted practice (patch releases within a minor are backward
  compatible security fixes) — not the `latest`-style risk this ADR addresses.

## Alternatives considered

**Pin to a `sha256` digest instead of a version tag.** More airtight, but requires
a `docker pull`/`docker manifest inspect` against a live registry to obtain the
digest — not verifiable from this project's development environment at the time
of this decision, and a wrong or stale digest silently breaks every build. An
exact version tag was chosen as the practical middle ground: verified to exist
before pinning, and far more reproducible than a floating major-only tag, without
requiring registry access to maintain.

**A Kubernetes-in-Docker (kind) job in CI that actually applies the manifests.**
Rejected for now — real cluster validation is strictly stronger than schema
validation, but stands up a kind cluster on every push, which is a heavier CI
investment than this milestone's scope. `kubeconform` catches the class of error
(schema violations, typos) that was actually observed to be a risk here.
