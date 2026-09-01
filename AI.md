# Working with AI on this repo

This file is what it says: a factual account of how AI has actually been used to
build and extend this codebase, not a marketing claim about it. It exists so a
reader — human or AI — inheriting this repo later understands what happened,
under what process, and what to expect if they continue it the same way.

## What actually happened

Most of this repository's hardening past its initial working state — M0 through
M4 below — was done by Claude Code, working from a written improvement plan
against the existing test framework and microservices stack, one milestone at a
time, each landing as its own pull request:

| Milestone | Summary | PR |
|-----------|---------|-----|
| M0 | Hygiene — untrack IDE/tool cruft, polish the README for first-screen impact | [#4](https://github.com/rabinavidan/playwright-kafka-microservices/pull/4) |
| M1 | Coverage & live reporting — publish the live test report + coverage badge, run UI smoke tests in CI | [#5](https://github.com/rabinavidan/playwright-kafka-microservices/pull/5) |
| M2 | Resilience & event-driven depth — idempotent Kafka consumption, dead-letter-queue routing, event contract tests, negative-saga tests, microservices stack wired into CI | [#6](https://github.com/rabinavidan/playwright-kafka-microservices/pull/6) |
| M3 | Observability & tracing — distributed trace-id propagation, structured JSON logging across every service | [#7](https://github.com/rabinavidan/playwright-kafka-microservices/pull/7) |
| M4 | Delivery & infra hardening — Makefile, k8s manifest lint in CI, pinned container image versions | [#8](https://github.com/rabinavidan/playwright-kafka-microservices/pull/8) |
| M5 | Docs & storytelling — this file, [ADRs](docs/adr/), [sequence diagrams](docs/sequence-diagrams.md) | this PR |

M6 (stretch: load testing, a cross-browser matrix, test-data factory
consolidation) is not yet started as of M5.

## The process, concretely

Each milestone followed the same loop, not just once but every time:

1. **One feature branch, reset from `main` before each milestone.** Because every
   milestone lands as its own PR and gets merged before the next one starts, the
   branch is reset to the latest `main` (`git checkout -B <branch> origin/main`)
   rather than stacking milestones on top of each other's already-merged history.
2. **Implement, then validate locally with whatever the sandbox actually has.**
   This project's development sandbox has no Docker daemon and no Kafka broker —
   so local validation means real `tsc`/`eslint`, a real PostgreSQL instance for
   schema and DB-layer changes, and reading the actual Kafka-dependent code paths
   closely, rather than pretending they were exercised locally when they weren't.
   Every PR's "Test plan" says explicitly what was and wasn't independently
   reproducible before CI ran.
3. **Push, open a draft PR, and watch its CI.** CI is where the Kafka-, Docker-,
   and Kubernetes-dependent behavior that couldn't be verified locally actually
   gets exercised for the first time.
4. **Drive to green, not just to "opened."** A red CI job is diagnosed from its
   actual logs, not guessed at — including, in M3, going deep enough into a
   flaky-looking Kafka consumer-group timeout to distinguish "this is a genuine
   code bug" from "this is broker rebalance latency that needs a wider buffer"
   (see [ADR-0004](docs/adr/0004-serialize-kafka-touching-playwright-projects.md)
   for the full story — two separate CI failures, two rounds of root-causing,
   before the fix actually held). A fix is pushed, validated against the
   original failure, and re-checked in CI before being called done.
5. **Merge, then move to the next milestone only on request.** Nothing here
   auto-advances through the milestone list — each one was started because it was
   explicitly asked for.

## What this means for trusting this repo

- **Every design decision has a paper trail.** [`docs/adr/`](docs/adr/) isn't
  retroactive documentation of decisions someone already understood — it's the
  actual reasoning, including alternatives that were considered and rejected,
  for choices made while building each milestone.
- **Nothing is claimed to work that wasn't actually checked.** Where the sandbox
  couldn't exercise something (Kafka delivery, a real `kubectl apply`, an actual
  `docker build`), the PR that introduced it says so plainly instead of asserting
  it was tested.
- **CI failures were root-caused, not routed around.** No test was skipped,
  disabled, or loosened to get a red build green; every fix that landed changed
  the actual thing that was wrong.
- **This file itself, and the ADRs and diagrams alongside it, are also
  AI-authored** — under the same process described above: written from the real
  git history and code, then checked against it before publishing, not
  freehanded from a general impression of what a Node/Kafka project usually
  looks like.

## If you're continuing this work with AI

The improvement plan this project follows is milestone-scoped on purpose — each
PR does one coherent thing, gets its own CI run, and is independently
mergeable/revertable. That structure is what makes the drive-to-green loop above
tractable: a red CI job on a five-file PR is a much smaller search space than one
on a PR that touched everything at once. Keep changes scoped that way, keep
writing down *why* — not just *what* — in an ADR when a decision has real
alternatives, and keep the "Test plan" honest about what was actually verified
versus what's being trusted to CI.
