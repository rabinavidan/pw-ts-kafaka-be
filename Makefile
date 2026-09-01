.DEFAULT_GOAL := help
.PHONY: help install dev dev-services dev-all ui-build \
	test test-api test-kafka test-integration test-microservices test-db \
	test-smoke test-regression test-e2e test-ui-smoke test-report \
	lint lint-fix type-check coverage report clean \
	compose-up compose-down compose-logs \
	docker-build kind-load k8s-lint k8s-deploy k8s-status k8s-teardown

# Namespace used by every k8s/*.yaml manifest — keep in sync with k8s/00-namespace.yaml.
K8S_NAMESPACE := pw-kafka-test

help: ## Show this help
	@echo "Usage: make <target>"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9_-]+:.*##/ { printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST) | sort

## ── Local development ────────────────────────────────────────────────

install: ## Install root + UI dependencies
	npm ci
	npm run ui:install

dev: ## Run mock-server.js + UI dev server (monolith mode)
	npm run dev

dev-services: ## Run gateway + orders/payments/events/notifications services (microservices mode, no UI)
	npm run dev:services

dev-all: ## Run gateway + all services + UI dev server (microservices mode, with UI)
	npm run dev:all

ui-build: ## Build the React UI for production
	npm run ui:build

## ── Tests ─────────────────────────────────────────────────────────────

test: ## Run the full backend suite (api + kafka + integration)
	npm test

test-api: ## Run API tests only
	npm run test:api

test-kafka: ## Run Kafka producer/consumer tests only
	npm run test:kafka

test-integration: ## Run end-to-end pipeline tests only
	npm run test:integration

test-microservices: ## Run the microservices-mode test project (requires: make dev-services)
	npm run test:microservices

test-db: ## Run pure DB-layer tests (requires: PostgreSQL only, no Kafka)
	npm run test:db

test-smoke: ## Run @smoke tagged tests — fast pre-deploy check
	npm run test:smoke

test-regression: ## Run @regression tagged tests — full coverage
	npm run test:regression

test-e2e: ## Run UI E2E tests (starts mock-server + Vite automatically)
	npm run test:e2e

test-ui-smoke: ## Run dashboard-level UI smoke tests
	npm run test:ui-smoke

test-report: ## Open the last Playwright HTML report
	npm run test:report

## ── Quality gates ────────────────────────────────────────────────────

lint: ## Lint src/ and tests/
	npm run lint

lint-fix: ## Lint src/ and tests/, auto-fixing what it can
	npm run lint:fix

type-check: ## Type-check with tsc --noEmit
	npm run type-check

coverage: ## Aggregate pass-rate coverage from Playwright JSON results
	npm run coverage

k8s-lint: ## Validate every k8s/*.yaml against upstream Kubernetes schemas (mirrors CI's Manifest Lint job)
	@command -v kubeconform >/dev/null 2>&1 || { \
		echo "kubeconform not found — install it: https://github.com/yannh/kubeconform#installation"; \
		exit 1; \
	}
	kubeconform -strict -summary -ignore-missing-schemas k8s/*.yaml

## ── Reports & cleanup ────────────────────────────────────────────────

report: ## Generate the pretty HTML report and open it
	npm run report

clean: ## Remove test results, reports, badges, and build output
	npm run clean

## ── docker-compose (local Kafka + Postgres, no Kubernetes) ───────────

compose-up: ## Start Zookeeper, Kafka, Kafka UI, Postgres, pgAdmin via docker-compose
	docker compose up -d

compose-down: ## Tear down the docker-compose stack (keeps the postgres_data volume)
	docker compose down

compose-logs: ## Tail docker-compose service logs
	docker compose logs -f

## ── Kubernetes (kind cluster — see README "Option B · Kubernetes") ───

docker-build: ## Build all service + UI images, tagged :latest for kind load
	docker build -t pw-kafka-ui:latest ./ui
	docker build -f gateway/Dockerfile                -t gateway:latest              .
	docker build -f services/orders/Dockerfile        -t orders-service:latest       .
	docker build -f services/payments/Dockerfile      -t payments-service:latest     .
	docker build -f services/events/Dockerfile        -t events-service:latest       .
	docker build -f services/notifications/Dockerfile -t notification-service:latest .

kind-load: ## Load all :latest images built by `make docker-build` into the kind cluster
	kind load docker-image pw-kafka-ui:latest
	kind load docker-image gateway:latest
	kind load docker-image orders-service:latest
	kind load docker-image payments-service:latest
	kind load docker-image events-service:latest
	kind load docker-image notification-service:latest

k8s-deploy: ## Apply every manifest in k8s/ to the kind cluster
	kubectl apply -f k8s/

k8s-status: ## Watch pod rollout in the pw-kafka-test namespace
	kubectl get pods -n $(K8S_NAMESPACE) -w

k8s-teardown: ## Delete the pw-kafka-test namespace (tears down the whole stack)
	kubectl delete namespace $(K8S_NAMESPACE)
