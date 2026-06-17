import { test, expect } from '../../src/fixtures';
import { kafkaTopics } from '../../src/config/kafka.config';
import { OrderEvent, PaymentEvent } from '../../src/models/kafka.model';
import { createOrderEvent, createPaymentEvent, randomId } from '../../src/utils/data.factory';
import { assertMessageReceived, assertKafkaMessage } from '../../src/utils/assertion';
import { sleep } from '../../src/utils/retry';

test.describe('Kafka Consumer @regression', () => {
  test('consumes a produced order event', async ({ kafka }) => {
    const event = createOrderEvent({ status: 'created' });

    await kafka.produce(kafkaTopics.orders, {
      key: event.orderId,
      value: event,
      headers: { 'event-type': 'order.created' },
    });

    await sleep(500);

    const messages = await kafka.consume<OrderEvent>(kafkaTopics.orders, {
      count: 1,
      timeoutMs: 15000,
      filter: (msg) => msg.value?.orderId === event.orderId,
    });

    assertMessageReceived(messages);
    assertKafkaMessage(messages[0], { orderId: event.orderId, status: 'created' });
    expect(messages[0].headers['event-type']).toBe('order.created');
  });

  test('consumes a payment event with correct fields', async ({ kafka }) => {
    const event = createPaymentEvent({ status: 'pending', method: 'credit_card' });

    await kafka.produce(kafkaTopics.payments, {
      key: event.paymentId,
      value: event,
      headers: { 'event-type': 'payment.initiated' },
    });

    await sleep(500);

    const messages = await kafka.consume<PaymentEvent>(kafkaTopics.payments, {
      count: 1,
      timeoutMs: 15000,
      filter: (msg) => msg.value?.paymentId === event.paymentId,
    });

    assertMessageReceived(messages);
    assertKafkaMessage(messages[0], {
      paymentId: event.paymentId,
      status: 'pending',
      method: 'credit_card',
    });
  });

  test('consumes multiple messages in order', async ({ kafka }) => {
    const events = Array.from({ length: 3 }, () => createOrderEvent());
    const batchId = randomId();

    for (const event of events) {
      await kafka.produce(kafkaTopics.orders, {
        key: event.orderId,
        value: event,
        headers: { 'batch-id': batchId },
      });
    }

    await sleep(500);

    const messages = await kafka.consume<OrderEvent>(kafkaTopics.orders, {
      count: 3,
      timeoutMs: 20000,
      filter: (msg) => msg.headers['batch-id'] === batchId,
    });

    expect(messages.length).toBe(3);
    const receivedIds = messages.map((m) => m.value.orderId);
    for (const event of events) {
      expect(receivedIds).toContain(event.orderId);
    }
  });

  test('waitForMessage resolves when predicate matches', async ({ kafka }) => {
    const event = createOrderEvent({ status: 'shipped' });

    await sleep(200);

    const producePromise = kafka.produce(kafkaTopics.orders, {
      key: event.orderId,
      value: event,
      headers: { 'event-type': 'order.shipped' },
    });

    const [message] = await Promise.all([
      kafka.waitForMessage<OrderEvent>(
        kafkaTopics.orders,
        (msg) => msg.value?.orderId === event.orderId && msg.value?.status === 'shipped',
        15000,
      ),
      producePromise,
    ]);

    expect(message.value.orderId).toBe(event.orderId);
    expect(message.value.status).toBe('shipped');
  });
});
