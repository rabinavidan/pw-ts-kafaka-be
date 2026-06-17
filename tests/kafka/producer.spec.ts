import { test, expect } from '../../src/fixtures';
import { kafkaTopics } from '../../src/config/kafka.config';
import { createOrderEvent, createPaymentEvent, randomId } from '../../src/utils/data.factory';

test.describe('Kafka Producer @regression', () => {
  test('produces a single order event to orders topic', async ({ kafka }) => {
    const event = createOrderEvent();
    const results = await kafka.produce(kafkaTopics.orders, {
      key: event.orderId,
      value: event,
      headers: { 'event-type': 'order.created', 'content-type': 'application/json' },
    });

    expect(results).toHaveLength(1);
    expect(results[0].partition).toBeGreaterThanOrEqual(0);
    expect(results[0].offset).toBeDefined();
  });

  test('produces a payment event to payments topic', async ({ kafka }) => {
    const event = createPaymentEvent();
    const results = await kafka.produce(kafkaTopics.payments, {
      key: event.paymentId,
      value: event,
      headers: { 'event-type': 'payment.initiated' },
    });

    expect(results).toHaveLength(1);
    expect(Number(results[0].offset)).toBeGreaterThanOrEqual(0);
  });

  test('produces a batch of messages to same topic', async ({ kafka }) => {
    const events = Array.from({ length: 5 }, () => createOrderEvent());
    const messages = events.map((e) => ({
      key: e.orderId,
      value: e,
      headers: { 'event-type': 'order.created' },
    }));

    const results = await kafka.produceMany(kafkaTopics.orders, messages);
    expect(results).toHaveLength(1);
  });

  test('produces event with correlation id in headers', async ({ kafka }) => {
    const correlationId = randomId();
    const event = createOrderEvent();

    const results = await kafka.produce(kafkaTopics.orders, {
      key: event.orderId,
      value: event,
      headers: {
        'event-type': 'order.created',
        'correlation-id': correlationId,
        'trace-id': randomId(),
      },
    });

    expect(results[0].partition).toBeGreaterThanOrEqual(0);
  });

  test('produces events to audit topic', async ({ kafka }) => {
    const event = createOrderEvent();
    const results = await kafka.produce(kafkaTopics.audit, {
      key: randomId(),
      value: {
        action: 'ORDER_CREATED',
        resource: 'order',
        resourceId: event.orderId,
        userId: event.userId,
        timestamp: new Date().toISOString(),
      },
    });

    expect(results[0].partition).toBeGreaterThanOrEqual(0);
  });
});
