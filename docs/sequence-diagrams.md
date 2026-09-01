# Sequence Diagrams

These trace the three flows the [ADRs](adr/README.md) reference most: the order
saga, trace-id propagation, and the dead-letter/idempotency path. All three
describe the **microservices** runtime topology (gateway → services → Kafka →
`notification-service`); `mock-server.js` collapses the same behavior into one
process (see [ADR-0003](adr/0003-mock-server-monolith-for-local-dev-and-ci-parity.md))
so its sequence is the same story with the Kafka round-trip removed.

## 1. Order saga: create → confirm → pay → process

The path exercised by `tests/microservices/tracing.spec.ts`'s first test and, in
its individual steps, by `event-contracts.spec.ts`. `orders-service` and
`payments-service` never write to `event_log` themselves — see
[ADR-0002](adr/0002-single-kafka-consumer-owns-event-log-writes.md).

```mermaid
sequenceDiagram
    participant Caller
    participant Gateway as gateway
    participant Orders as orders-service
    participant Payments as payments-service
    participant Kafka
    participant Notif as notification-service
    participant DB as PostgreSQL

    Caller->>Gateway: POST /api/v1/orders
    Gateway->>Orders: forward (+ X-Trace-Id if absent)
    Orders->>DB: INSERT orders (status=created, trace_id)
    Orders-->>Gateway: 201 {order, traceId}
    Gateway-->>Caller: 201 {order, traceId}
    Orders->>Kafka: publish orders/order.created (header trace-id)

    Caller->>Gateway: PUT /orders/:id/confirm
    Gateway->>Orders: forward
    Orders->>DB: UPDATE orders SET status=confirmed
    Orders-->>Caller: 200 {order}
    Orders->>Kafka: publish orders/order.confirmed

    Caller->>Gateway: POST /api/v1/payments {orderId}
    Gateway->>Payments: forward
    Payments->>DB: SELECT orders.trace_id WHERE id=orderId
    Payments->>DB: INSERT payments (trace_id = order's trace_id)
    Payments-->>Caller: 201 {payment, traceId}
    Payments->>Kafka: publish payments/payment.initiated

    Caller->>Gateway: PUT /payments/:id/process
    Gateway->>Payments: forward
    Payments->>DB: UPDATE payments SET status=processed
    Payments-->>Caller: 200 {payment}
    Payments->>Kafka: publish payments/payment.processed

    par consumed asynchronously, at-least-once
        Kafka->>Notif: order.created / order.confirmed / payment.initiated / payment.processed
        Notif->>DB: INSERT event_log (dedupe_key, trace_id) ON CONFLICT DO NOTHING
    end

    Caller->>Gateway: GET /api/v1/events?traceId=...
    Gateway->>Notif: forward (events-service reads event_log)
    Notif->>DB: SELECT * FROM event_log WHERE trace_id=... ORDER BY created_at
    Notif-->>Caller: 200 {events: [created, confirmed, initiated, processed]}
```

Note: `payments-service` never mints its own trace id — it reads the parent
order's ([ADR-0007](adr/0007-one-trace-id-per-order-assigned-at-the-edge.md)), so
every event in this saga, across both topics, shares one `trace_id`.

## 2. Trace-id propagation: caller-supplied vs. edge-assigned

```mermaid
sequenceDiagram
    participant Caller
    participant Gateway as gateway
    participant Service as orders-service / payments-service
    participant Kafka
    participant Notif as notification-service

    alt caller sends X-Trace-Id
        Caller->>Gateway: request + X-Trace-Id: caller-abc
        Gateway->>Service: forward + X-Trace-Id: caller-abc
        Note over Gateway: honored as-is, never replaced
    else caller sends nothing
        Caller->>Gateway: request (no X-Trace-Id)
        Gateway->>Gateway: traceId = randomUUID()
        Gateway->>Service: forward + X-Trace-Id: <generated>
    end

    Service->>Service: store trace_id on the row
    Service-->>Caller: response + X-Trace-Id header + traceId in body
    Service->>Kafka: publish (header: trace-id)
    Kafka->>Notif: consume
    Notif->>Notif: read trace-id header
    Notif->>Notif: INSERT event_log ... trace_id
```

Verified end to end by `tracing.spec.ts`'s "a caller-supplied X-Trace-Id is
honored end to end, not replaced" test.

## 3. Dead-letter queue and idempotent consumption

Both mechanisms live entirely inside `notification-service`'s consumer loop — see
[ADR-0005](adr/0005-idempotent-consumption-and-dead-letter-queue.md). Kafka's
at-least-once delivery means both paths are exercised in normal operation, not
only under failure.

```mermaid
sequenceDiagram
    participant Producer as orders-service / payments-service
    participant Kafka
    participant Notif as notification-service
    participant DB as PostgreSQL
    participant DLQ as dead-letter-queue topic

    Producer->>Kafka: publish (valid JSON)
    Kafka->>Notif: deliver message #1

    rect rgba(255,0,0,0.06)
        Note over Kafka,Notif: redelivery (rebalance / at-least-once)
        Kafka->>Notif: deliver message #1 again
        Notif->>DB: INSERT event_log ... ON CONFLICT (dedupe_key) DO NOTHING
        Note over DB: no-op — already recorded
    end

    rect rgba(255,140,0,0.08)
        Note over Kafka,Notif: poison message
        Kafka->>Notif: deliver malformed payload
        Notif->>Notif: JSON.parse throws
        Notif->>DLQ: publish {failureReason, original-topic header}
        Note over Notif: consumer keeps running — no stall, no crash
        Kafka->>Notif: deliver next (valid) message
        Notif->>DB: INSERT event_log (processed normally)
    end
```
