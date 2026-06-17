# pw-ts-kafka-be

Playwright TypeScript automated test framework for backend APIs and Kafka message flows.

## Overview

This framework provides end-to-end test coverage for backend services that expose REST APIs and communicate via Apache Kafka. It is designed for teams practising continuous testing — tests slot into CI/CD pipelines and validate message flows, stream processing, data pipelines, and API interactions in one unified suite.

## Project Structure

```
├── src/
│   ├── config/
│   │   ├── api.config.ts          # Base URL, headers, endpoint constants
│   │   └── kafka.config.ts        # Brokers, SASL, SSL, topic names
│   ├── fixtures/
│   │   └── index.ts               # Playwright fixtures: kafka + api per test
│   ├── helpers/
│   │   ├── api.helper.ts          # Typed HTTP methods with timing & retry
│   │   └── kafka.helper.ts        # Produce, consume, admin, waitForMessage
│   ├── models/
│   │   ├── api.model.ts           # API response & domain interfaces
│   │   └── kafka.model.ts         # Kafka event interfaces (Order, Payment…)
│   └── utils/
│       ├── assertion.ts           # Custom assertion helpers
│       ├── data.factory.ts        # Test data builders with randomised values
│       ├── logger.ts              # Winston logger (console + file)
│       └── retry.ts               # retry(), sleep(), waitUntil()
├── tests/
│   ├── api/
│   │   ├── health.spec.ts         # Health & readiness, SLA assertions
│   │   ├── orders.spec.ts         # Orders CRUD, pagination, error cases
│   │   └── payments.spec.ts       # Payment lifecycle, conflict detection
│   ├── kafka/
│   │   ├── producer.spec.ts       # Produce single/batch, headers, audit
│   │   ├── consumer.spec.ts       # Consume with predicate, ordering
│   │   └── message-flow.spec.ts   # Order→Payment chain, DLQ, partition order
│   └── integration/
│       ├── order-pipeline.spec.ts # API action → Kafka event verification
│       └── data-pipeline.spec.ts  # Throughput, audit trail, trace-id correlation
├── .github/workflows/
│   └── ci.yml                     # GitHub Actions: lint → api + kafka → integration
├── .env.example                   # Environment variable template
├── eslint.config.mjs
├── playwright.config.ts           # 3 projects, HTML + JSON + GitHub reporters
└── tsconfig.json                  # Strict, ES2022, path aliases
```

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20+ |
| npm | 9+ |
| Apache Kafka | 3.x (or Confluent Platform 7.x) |
| Target API service | Running and reachable |

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your broker addresses and API base URL
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_BASE_URL` | `http://localhost:3000` | Base URL of the API under test |
| `API_KEY` | — | API key sent as `X-API-Key` header |
| `KAFKA_BROKERS` | `localhost:9092` | Comma-separated broker list |
| `KAFKA_CLIENT_ID` | `playwright-test-client` | Kafka client identifier |
| `KAFKA_GROUP_ID` | `playwright-test-group` | Consumer group ID prefix |
| `KAFKA_SSL` | `false` | Enable TLS |
| `KAFKA_SASL_MECHANISM` | — | `plain`, `scram-sha-256`, or `scram-sha-512` |
| `KAFKA_SASL_USERNAME` | — | SASL username |
| `KAFKA_SASL_PASSWORD` | — | SASL password |
| `LOG_LEVEL` | `info` | Winston log level |

## Running Tests

```bash
# All suites
npm test

# Individual suites
npm run test:api          # REST API tests only
npm run test:kafka        # Kafka producer / consumer tests only
npm run test:integration  # End-to-end pipeline tests

# By tag
npm run test:smoke        # @smoke tagged tests — fast pre-deploy check
npm run test:regression   # @regression tagged tests — full coverage

# Open HTML report after a run
npm run test:report
```

## Test Tags

| Tag | Purpose |
|-----|---------|
| `@smoke` | Critical path — run before every deploy |
| `@regression` | Full suite — run on PRs and nightly |

## Local Kafka with Docker

If you do not have a Kafka cluster available, spin one up locally:

```bash
# Start Zookeeper and Kafka
docker run -d --name zookeeper -p 2181:2181 \
  -e ZOOKEEPER_CLIENT_PORT=2181 \
  confluentinc/cp-zookeeper:7.6.0

docker run -d --name kafka -p 9092:9092 \
  -e KAFKA_BROKER_ID=1 \
  -e KAFKA_ZOOKEEPER_CONNECT=zookeeper:2181 \
  -e KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://localhost:9092 \
  -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 \
  -e KAFKA_AUTO_CREATE_TOPICS_ENABLE=true \
  confluentinc/cp-kafka:7.6.0

# Create topics used by the test suite
for topic in orders payments notifications dead-letter-queue audit-events; do
  docker exec kafka kafka-topics \
    --bootstrap-server localhost:9092 \
    --create --if-not-exists \
    --topic $topic --partitions 3 --replication-factor 1
done
```

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and pull request:

```
lint-and-typecheck
    ├── test-api          (MockServer service container)
    └── test-kafka        (Confluent Kafka service container)
            └── test-integration
                    └── publish-report
```

- Kafka topics are created automatically before the Kafka and integration jobs.
- Test results and HTML reports are uploaded as job artifacts (14-day retention).
- A markdown summary is posted to the GitHub Actions step summary.

## Key Design Decisions

**Fixtures over global state.** Each test receives a fresh `KafkaHelper` (connected producer + admin) and `ApiHelper` via Playwright fixtures, ensuring isolation and automatic teardown.

**Predicate-based consumption.** `KafkaHelper.consume()` accepts a `filter` function so tests can target the exact messages they produced without coupling to topic offset state.

**Typed everything.** Domain events (`OrderEvent`, `PaymentEvent`, etc.) and API responses are fully typed, catching contract drift at compile time rather than at runtime.

**Tag-based execution.** `@smoke` and `@regression` tags let the pipeline choose the right depth for each stage without maintaining separate config files.

## Code Quality

```bash
npm run type-check   # TypeScript strict mode — zero errors expected
npm run lint         # ESLint with @typescript-eslint rules
npm run lint:fix     # Auto-fix lint issues
```

## Extending the Framework

### Add a new API endpoint

1. Add the path to `src/config/api.config.ts` → `endpoints`.
2. Add response types to `src/models/api.model.ts`.
3. Create `tests/api/<resource>.spec.ts` using the `api` fixture.

### Add a new Kafka topic

1. Add the topic name to `src/config/kafka.config.ts` → `kafkaTopics`.
2. Add the event interface to `src/models/kafka.model.ts`.
3. Add a factory function to `src/utils/data.factory.ts`.
4. Write producer/consumer specs in `tests/kafka/`.

### Add a new integration flow

1. Create `tests/integration/<flow-name>.spec.ts`.
2. Use both `kafka` and `api` fixtures in the same test to chain API actions to Kafka event assertions.

## Defect Investigation

When a test fails:

- **HTML report** — `npm run test:report` opens the interactive Playwright report with traces and logs.
- **Log file** — `test-results/test.log` contains timestamped JSON logs from every helper call.
- **Trace** — On first retry, Playwright records a `.zip` trace in `test-results/` viewable at `trace.playwright.dev`.
- **JSON results** — `test-results/results.json` is machine-readable for downstream tooling.
