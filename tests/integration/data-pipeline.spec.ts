import { test, expect } from '../../src/fixtures';
import { kafkaTopics } from '../../src/config/kafka.config';
import { OrderEvent, AuditEvent, PaymentEvent } from '../../src/models/kafka.model';
import { createOrderEvent, createAuditEvent, randomId } from '../../src/utils/data.factory';
import { createPaymentEvent } from '../../src/utils/data.factory';
import { sleep } from '../../src/utils/retry';

test.describe('Data Pipeline Integration @regression', () => {
  test('high-throughput batch produces and consumes without message loss', async ({ kafka }) => {
    const batchId = randomId();
    const batchSize = 20;
    const events = Array.from({ length: batchSize }, () => createOrderEvent());

    await kafka.produceMany(
      kafkaTopics.orders,
      events.map((e) => ({
        key: e.orderId,
        value: e,
        headers: { 'batch-id': batchId, 'event-type': 'order.created' },
      })),
    );

    await sleep(500);

    const messages = await kafka.consume<OrderEvent>(kafkaTopics.orders, {
      count: batchSize,
      timeoutMs: 30000,
      filter: (msg) => msg.headers['batch-id'] === batchId,
    });

    expect(messages.length).toBe(batchSize);
    const receivedIds = new Set(messages.map((m) => m.value.orderId));
    expect(receivedIds.size).toBe(batchSize);
  });

  test('audit trail captures all events across topics', async ({ kafka }) => {
    const sessionId = randomId();
    const orderId = randomId();
    const userId = randomId();

    const auditEvents: AuditEvent[] = [
      createAuditEvent({ action: 'ORDER_CREATED', resource: 'order', resourceId: orderId, userId }),
      createAuditEvent({ action: 'PAYMENT_INITIATED', resource: 'payment', resourceId: randomId(), userId }),
      createAuditEvent({ action: 'ORDER_CONFIRMED', resource: 'order', resourceId: orderId, userId }),
    ];

    for (const event of auditEvents) {
      await kafka.produce(kafkaTopics.audit, {
        key: event.auditId,
        value: event,
        headers: { 'session-id': sessionId },
      });
      await sleep(50);
    }

    await sleep(300);

    const auditMessages = await kafka.consume<AuditEvent>(kafkaTopics.audit, {
      count: auditEvents.length,
      timeoutMs: 20000,
      filter: (msg) => msg.headers['session-id'] === sessionId,
    });

    expect(auditMessages.length).toBe(3);
    const actions = auditMessages.map((m) => m.value.action);
    expect(actions).toContain('ORDER_CREATED');
    expect(actions).toContain('PAYMENT_INITIATED');
    expect(actions).toContain('ORDER_CONFIRMED');
  });

  test('cross-topic correlation via trace-id is maintained', async ({ kafka }) => {
    const traceId = randomId();

    const order = createOrderEvent();
    const payment = createPaymentEvent({ orderId: order.orderId });

    await kafka.produce(kafkaTopics.orders, {
      key: order.orderId,
      value: order,
      headers: { 'trace-id': traceId, 'event-type': 'order.created' },
    });

    await kafka.produce(kafkaTopics.payments, {
      key: payment.paymentId,
      value: payment,
      headers: { 'trace-id': traceId, 'event-type': 'payment.initiated' },
    });

    await sleep(400);

    // Sequential consumers to avoid simultaneous group joins triggering rebalancing
    const orderMsgs = await kafka.consume<OrderEvent>(kafkaTopics.orders, {
      count: 1,
      timeoutMs: 20000,
      filter: (msg) => msg.headers['trace-id'] === traceId,
    });
    const paymentMsgs = await kafka.consume<PaymentEvent>(kafkaTopics.payments, {
      count: 1,
      timeoutMs: 20000,
      filter: (msg) => msg.headers['trace-id'] === traceId,
    });

    expect(orderMsgs[0].headers['trace-id']).toBe(traceId);
    expect(paymentMsgs[0].headers['trace-id']).toBe(traceId);
    expect(paymentMsgs[0].value.orderId).toBe(order.orderId);
  });

  test('consumer lag does not exceed threshold under load', async ({ kafka }) => {
    const batchId = randomId();
    const messageCount = 10;
    const events = Array.from({ length: messageCount }, () => createOrderEvent());

    const produceStart = Date.now();

    await kafka.produceMany(
      kafkaTopics.orders,
      events.map((e) => ({
        key: e.orderId,
        value: e,
        headers: { 'load-test-id': batchId },
      })),
    );

    const produceEnd = Date.now();

    await sleep(200);

    const consumeStart = Date.now();

    const messages = await kafka.consume<OrderEvent>(kafkaTopics.orders, {
      count: messageCount,
      timeoutMs: 20000,
      filter: (msg) => msg.headers['load-test-id'] === batchId,
    });

    const consumeEnd = Date.now();

    expect(messages.length).toBe(messageCount);

    const produceDuration = produceEnd - produceStart;
    const consumeDuration = consumeEnd - consumeStart;

    expect(produceDuration).toBeLessThan(10000);
    expect(consumeDuration).toBeLessThan(15000);
  });
});
