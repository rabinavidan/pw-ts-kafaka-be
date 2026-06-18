# pw-ts-kafka-be

Playwright TypeScript automated test framework for backend APIs, Kafka message flows, and a React UI dashboard with full E2E coverage.

## Overview

This framework provides end-to-end test coverage across two layers:

- **Backend tests** — REST API contract testing, Kafka producer/consumer flows, and integration pipeline verification against real Kafka brokers (or a mock server locally).
- **E2E UI tests** — Browser-level tests for the React Orders & Payments dashboard using a Page Object Model (POM) layer backed by `data-testid` locators.

The UI itself is a live React 18 + Vite SPA that connects to the mock server (`mock-server.js`) for development and CI, providing an Orders tab, Payments tab, and an Event Feed sidebar showing Kafka event activity in real time.

---

## Installation & Setup

Complete these steps in order before running any tests.

### 1. System Requirements

| Tool | Version |
|------|---------|
| Node.js | 20+ |
| npm | 9+ |
| Docker | 24+ (for local Kafka — backend tests only) |

```bash
node -v
npm -v
docker -v
```

### 2. Install Root Dependencies

```bash
npm install
```

### 3. Install UI Dependencies

```bash
npm run ui:install
```

### 4. Install Playwright Browsers

```bash
npx playwright install --with-deps chromium
```

### 5. Configure Environment Variables

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `API_BASE_URL` | `http://localhost:3000` | Base URL of the API under test |
| `API_KEY` | — | API key sent as `X-API-Key` header |
| `KAFKA_BROKERS` | `localhost:9092` | Comma-separated broker list |
| `KAFKA_CLIENT_ID` | `playwright-test-client` | Kafka client identifier |
| `KAFKA_GROUP_ID` | `playwright-test-group` | Consumer group ID prefix |
| `KAFKA_CONNECTION_TIMEOUT` | `3000` | Kafka connection timeout (ms) |
| `KAFKA_REQUEST_TIMEOUT` | `30000` | Kafka request timeout (ms) |
| `KAFKA_SSL` | `false` | Enable TLS |
| `KAFKA_SASL_MECHANISM` | — | `plain`, `scram-sha-256`, or `scram-sha-512` |
| `KAFKA_SASL_USERNAME` | — | SASL username |
| `KAFKA_SASL_PASSWORD` | — | SASL password |
| `TEST_TIMEOUT` | `60000` | Per-test timeout (ms) |
| `RETRY_ATTEMPTS` | `3` | Number of retry attempts |
| `RETRY_DELAY` | `1000` | Delay between retries (ms) |
| `LOG_LEVEL` | `info` | Winston log level |

### 6. Start Local Kafka (for backend tests)

Skip this step if you only need to run E2E UI tests — those use `mock-server.js` and don't require Kafka.

```bash
# Start Zookeeper
docker run -d --name zookeeper -p 2181:2181 \
  -e ZOOKEEPER_CLIENT_PORT=2181 \
  confluentinc/cp-zookeeper:7.6.0

# Start Kafka broker
docker run -d --name kafka -p 9092:9092 \
  --link zookeeper \
  -e KAFKA_BROKER_ID=1 \
  -e KAFKA_ZOOKEEPER_CONNECT=zookeeper:2181 \
  -e KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://localhost:9092 \
  -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 \
  -e KAFKA_AUTO_CREATE_TOPICS_ENABLE=true \
  confluentinc/cp-kafka:7.6.0
```

Wait ~10 seconds, then create the required topics:

```bash
for topic in orders payments notifications dead-letter-queue audit-events; do
  docker exec kafka kafka-topics \
    --bootstrap-server localhost:9092 \
    --create --if-not-exists \
    --topic $topic --partitions 3 --replication-factor 1
done
```

Verify:

```bash
docker exec kafka kafka-topics --bootstrap-server localhost:9092 --list
```

---

## Running Tests

### Backend tests (require Kafka)

```bash
# All backend suites
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

### E2E UI tests (no Kafka needed)

The E2E suite starts `mock-server.js` and the Vite dev server automatically before running:

```bash
npm run test:e2e
```

This runs the `e2e-orders` and `e2e-payments` Playwright projects defined in `playwright.ui.config.ts`.

### Start the UI dashboard locally

```bash
npm run dev
```

Opens the React dashboard at `http://localhost:5173` with the mock server on `http://localhost:3000`.

---

## Test Tags

| Tag | Purpose |
|-----|---------|
| `@smoke` | Critical path — run before every deploy |
| `@regression` | Full suite — run on PRs and nightly |

---

## Project Structure

```
├── mock-server.js                     # In-memory REST + Kafka event mock (port 3000)
├── generate-report.js                 # Pretty HTML report from Playwright JSON
├── generate-summary.js                # GitHub Actions job summary generator (HTML table)
├── playwright.config.ts               # Backend test projects (api, kafka, integration)
├── playwright.ui.config.ts            # UI E2E projects (e2e-orders, e2e-payments)
│
├── ui/                                # React 18 + Vite dashboard
│   └── src/
│       ├── App.tsx                    # Tab routing, toast container
│       ├── components/
│       │   ├── Header.tsx             # Nav tabs, health status indicator
│       │   ├── OrdersPanel.tsx        # Orders table, filters, bulk actions, modal
│       │   ├── PaymentsPanel.tsx      # Payments table, filters, bulk actions, modal
│       │   └── EventFeed.tsx          # Live Kafka event sidebar
│       └── hooks/
│           ├── useOrders.ts           # Orders CRUD + confirm/cancel
│           └── usePayments.ts         # Payments CRUD + process/refund/fail
│
├── src/
│   ├── config/
│   │   ├── api.config.ts             # Base URL, headers, endpoint constants
│   │   └── kafka.config.ts           # Brokers, SASL, SSL, topic names
│   ├── fixtures/
│   │   └── index.ts                  # Playwright fixtures: kafka + api per test
│   ├── helpers/
│   │   ├── api.helper.ts             # Typed HTTP methods with timing & retry
│   │   └── kafka.helper.ts           # Produce, consume, admin, waitForMessage
│   ├── models/
│   │   ├── api.model.ts              # API response & domain interfaces
│   │   └── kafka.model.ts            # Kafka event interfaces (Order, Payment…)
│   └── utils/
│       ├── assertion.ts              # Custom assertion helpers
│       ├── data.factory.ts           # Test data builders with randomised values
│       ├── logger.ts                 # Winston logger (console + file)
│       └── retry.ts                  # retry(), sleep(), waitUntil()
│
├── tests/
│   ├── api/
│   │   ├── health.spec.ts            # Health & readiness, SLA assertions
│   │   ├── orders.spec.ts            # Orders CRUD, pagination, error cases
│   │   └── payments.spec.ts          # Payment lifecycle, conflict detection
│   ├── kafka/
│   │   ├── producer.spec.ts          # Produce single/batch, headers, audit
│   │   ├── consumer.spec.ts          # Consume with predicate, ordering
│   │   └── message-flow.spec.ts      # Order→Payment chain, DLQ, partition order
│   ├── integration/
│   │   ├── order-pipeline.spec.ts    # API action → Kafka event verification
│   │   └── data-pipeline.spec.ts     # Throughput, audit trail, trace-id correlation
│   └── e2e/
│       ├── pages/                    # Page Object Model layer
│       │   ├── HeaderPage.ts         # Nav tabs, health status
│       │   ├── OrdersPage.ts         # Orders panel locators + action helpers
│       │   ├── PaymentsPage.ts       # Payments panel locators + action helpers
│       │   └── EventFeedPage.ts      # Event feed sidebar locators + wait helpers
│       ├── fixtures/
│       │   └── pages.fixture.ts      # Custom Playwright fixture injecting all POMs
│       ├── orders.e2e.spec.ts        # 24 tests: create, confirm/cancel, filters, bulk, Kafka events
│       └── payments.e2e.spec.ts      # 27 tests: create, process/refund/fail, filters, bulk, Kafka events
│
└── .github/workflows/
    └── ci.yml                        # 5-job pipeline (see CI/CD section)
```

---

## Mock Server API Reference

`mock-server.js` runs on port 3000 and provides all endpoints the UI and E2E tests use. State is in-memory and resets on restart.

| Method | Path | Description | Publishes to |
|--------|------|-------------|-------------|
| `GET` | `/health` | Service health + dependency statuses | — |
| `GET` | `/ready` | Readiness probe | — |
| `GET` | `/api/v1/events` | Live event feed (SSE-style JSON list) | — |
| `POST` | `/api/v1/orders` | Create order (`userId`, `items`, `currency`) | `orders` topic → `order.created` |
| `GET` | `/api/v1/orders` | List orders (`status`, `page`, `pageSize` filters) | — |
| `GET` | `/api/v1/orders/:id` | Get single order | — |
| `PUT` | `/api/v1/orders/:id/confirm` | Confirm a created order | `orders` → `order.confirmed` |
| `PUT` | `/api/v1/orders/:id/cancel` | Cancel an order | `orders` → `order.cancelled` |
| `POST` | `/api/v1/payments` | Create payment (`orderId`, `method`, `simulateFailure?`) | `payments` → `payment.initiated` or `payment.failed` to `dead-letter-queue` |
| `GET` | `/api/v1/payments` | List payments (`status`, `page`, `pageSize` filters) | — |
| `GET` | `/api/v1/payments/:id` | Get single payment | — |
| `PUT` | `/api/v1/payments/:id/process` | Move payment to `processed` | `payments` → `payment.processed` |
| `PUT` | `/api/v1/payments/:id/refund` | Move payment to `refunded` | `payments` → `payment.refunded` |
| `PUT` | `/api/v1/payments/:id/fail` | Move payment to `failed` | `dead-letter-queue` → `payment.failed` |

> `simulateFailure: true` in `POST /api/v1/payments` creates the payment directly as `failed` (used for DLQ testing). The UI Bulk Fail button uses the `/fail` endpoint instead, which is the preferred test path.

---

## UI Dashboard

The React dashboard (`ui/`) has three main areas:

### Orders tab

- Create orders via modal (User ID, currency, multiple product line items)
- Filter pills: **All / Created / Confirmed / Cancelled**
- Per-row actions: **Confirm** and **Cancel**
- Bulk selection with **Bulk Confirm** and **Bulk Cancel** actions
- Bulk create ×15 for load seeding

### Payments tab

- Create payments via modal (Order ID, payment method)
- Filter pills: **All / Pending / Processed / Refunded / Failed**
- Bulk selection with three actions: **Bulk Process**, **Bulk Refund**, **Bulk Fail**
- Bulk create ×10 for load seeding

### Event Feed sidebar

- Live list of Kafka events published by the mock server
- Shows event type, topic, key, and timestamp
- Updated in real time as orders and payments are mutated

---

## E2E POM Architecture

The E2E layer lives in `tests/e2e/` and uses a Page Object Model so locator details stay out of test files.

### Page classes

Each page class holds typed `Locator` fields (all by `data-testid`) and helper methods:

| Class | Responsibility |
|-------|---------------|
| `HeaderPage` | Nav tabs, health status, `goToOrders()`, `goToPayments()` |
| `OrdersPage` | Full orders panel — locators, `createOrder()`, `filterPill()`, row helpers |
| `PaymentsPage` | Full payments panel — locators, `createPayment()`, `filterPill()`, row helpers |
| `EventFeedPage` | Event sidebar — `waitForEventType()`, `eventsOfType()` |

### Custom fixture

`tests/e2e/fixtures/pages.fixture.ts` extends Playwright's `base.extend<PageFixtures>()` to inject all four POMs into every test:

```typescript
import { test, expect } from './fixtures/pages.fixture';

test('example', async ({ header, ordersPage, paymentsPage, eventFeed }) => {
  await header.goToOrders();
  await ordersPage.createOrder('user-1', 'prod-1');
  await eventFeed.waitForEventType('order.created');
});
```

### Key `data-testid` reference

| Element | `data-testid` | Notes |
|---------|--------------|-------|
| Header nav | `header-nav` | |
| Orders tab | `nav-tab-orders` | Has `active` class when selected |
| Payments tab | `nav-tab-payments` | Has `active` class when selected |
| Health indicator | `health-status` | `data-health` attr: `healthy`, `degraded`, `connecting` |
| Orders panel | `orders-panel` | |
| Filter pill | `filter-pill-{status}` | e.g. `filter-pill-confirmed` |
| Order row | `order-row-{id}` | `data-order-status` attr on each row |
| Order status cell | `order-status-{id}` | |
| Confirm button (row) | `btn-confirm-order-{id}` | |
| Cancel button (row) | `btn-cancel-order-{id}` | |
| Bulk bar | `orders-bulk-bar` | Visible when ≥1 row selected |
| Bulk confirm | `btn-bulk-confirm` | |
| Bulk cancel | `btn-bulk-cancel` | |
| Payments panel | `payments-panel` | |
| Payment row | `payment-row-{id}` | `data-payment-status` attr on each row |
| Payment status cell | `payment-status-{id}` | |
| Bulk process | `btn-bulk-process` | |
| Bulk refund | `btn-bulk-refund` | |
| Bulk fail | `btn-bulk-fail` | |
| Event sidebar | `event-sidebar` | |
| Event item | `event-item-{id}` | `data-event-type` attr |
| Toast | `toast` | `data-toast-type` attr |
| Toast message | `toast-message` | Use `.last()` when multiple toasts may be visible |

---

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and pull request:

```
lint              ui-build
  │                  │
  └───── test-be ────┘
  │                  │
  └──── test-e2e ────┘
              │
           deploy   ← main branch only
```

### Jobs

| Job | Triggers | Description |
|-----|----------|-------------|
| `lint` | push / PR | ESLint + `tsc --noEmit` |
| `ui-build` | push / PR | `vite build` — uploads `ui-dist` artifact |
| `test-be` | after `lint` | Spins up Kafka services, runs `npm test` (40 tests), generates HTML report + job summary |
| `test-e2e` | after `lint` + `ui-build` | Runs `npm run test:e2e` (51 tests) with mock server + Vite via `webServer`, generates job summary |
| `deploy` | after all three pass, main only | Deploys UI to GitHub Pages, includes BE test report |

### Job summaries

Both test jobs write a detailed HTML table to the GitHub Actions step summary via `generate-summary.js`:

```bash
SUMMARY_LABEL="Backend Tests" node generate-summary.js test-results/results.json >> $GITHUB_STEP_SUMMARY
```

The summary includes: total / passed / failed / skipped counts, pass rate, and a per-test table with status icon, suite path, test name, duration (colour-coded), and collapsible error details for failures.

### Artifacts retained (30 days)

| Artifact | Contents |
|----------|----------|
| `be-playwright-report` | Playwright HTML report for backend tests |
| `be-test-report-html` | Pretty single-file HTML report (`generate-report.js`) |
| `be-results-json` | `test-results/results.json` for downstream tooling |
| `e2e-playwright-report` | Playwright HTML report for E2E tests (with screenshots & video on failure) |
| `e2e-results-json` | `test-results/ui-results.json` |

---

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm test` | Run all backend tests |
| `npm run test:api` | API tests only |
| `npm run test:kafka` | Kafka tests only |
| `npm run test:integration` | Integration tests only |
| `npm run test:smoke` | `@smoke`-tagged tests |
| `npm run test:regression` | `@regression`-tagged tests |
| `npm run test:e2e` | E2E UI tests (auto-starts mock server + Vite) |
| `npm run test:report` | Open Playwright HTML report |
| `npm run dev` | Start mock server + Vite dev server concurrently |
| `npm run ui:install` | Install UI npm dependencies |
| `npm run ui:build` | Build UI for production |
| `npm run lint` | ESLint |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run type-check` | TypeScript strict mode check |
| `npm run clean` | Remove `test-results`, `playwright-report`, `playwright-report-ui` |

---

## Code Quality

```bash
npm run type-check   # Zero errors expected
npm run lint
npm run lint:fix
npm run clean
```

---

## Key Design Decisions

**Fixtures over global state.** Each test receives a fresh `KafkaHelper` and `ApiHelper` via Playwright fixtures, ensuring isolation and automatic teardown.

**Predicate-based consumption.** `KafkaHelper.consume()` accepts a `filter` function so tests can target the exact messages they produced without coupling to topic offset state.

**POM with `data-testid` locators.** All UI locators use `data-testid` attributes, keeping tests resilient to style and structure changes. Each page class exposes typed `Locator` fields — tests never build selector strings directly.

**Typed everything.** Domain events (`OrderEvent`, `PaymentEvent`, etc.) and API responses are fully typed, catching contract drift at compile time rather than at runtime.

**Bulk-action as the reliable fail path.** The "fail" status for payments is triggered via the Bulk Fail button (`PUT /api/v1/payments/:id/fail`) rather than the `simulateFailure` form checkbox, avoiding React state-batching timing issues with native checkbox events.

**Tag-based execution.** `@smoke` and `@regression` tags let the pipeline choose the right depth for each stage without maintaining separate config files.

---

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

### Add a new E2E page test

1. Add `data-testid` attributes to any new UI elements.
2. If it's a new panel, create `tests/e2e/pages/<Name>Page.ts` with `Locator` fields and action helpers.
3. Register it in `tests/e2e/fixtures/pages.fixture.ts`.
4. Write a new spec in `tests/e2e/<name>.e2e.spec.ts`.

### Add a new mock server endpoint

1. Add the route handler in `mock-server.js` following the existing pattern (method + path matching, JSON response, `publishEvent()` call).
2. Add the hook call to `ui/src/hooks/use<Resource>.ts`.
3. Update the UI component to expose the action.
4. Update the API reference table in this README.

---

## Defect Investigation

When a test fails:

- **HTML report** — `npm run test:report` opens the interactive Playwright report with traces and logs.
- **E2E screenshots / video** — saved to `test-results/` on failure (configured in `playwright.ui.config.ts`).
- **Log file** — `test-results/test.log` contains timestamped JSON logs from every helper call.
- **Trace** — On first retry, Playwright records a `.zip` trace in `test-results/` viewable at `trace.playwright.dev`.
- **JSON results** — `test-results/results.json` (BE) and `test-results/ui-results.json` (E2E) are machine-readable for downstream tooling.
