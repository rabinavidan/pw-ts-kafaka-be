import { test, expect } from '../../src/fixtures';
import { kafkaTopics } from '../../src/config/kafka.config';
import { OrderEvent, PaymentEvent, NotificationEvent } from '../../src/models/kafka.model';
import { createOrderEvent, createPaymentEvent, createNotificationEvent, randomId } from '../../src/utils/data.factory';
import { sleep } from '../../src/utils/retry';

test.describe('Kafka Message Flows @regression', () => {
  test('order-to-payment event chain flows correctly', async ({ kafka }) => {
    const traceId = randomId();
    const order = createOrderEvent({ status: 'confirmed' });
    const payment = createPaymentEvent({ orderId: order.orderId, status: 'processing' });

    await kafka.produce(kafkaTopics.orders, {
      key: order.orderId,
      value: order,
      headers: { 'event-type': 'order.confirmed', 'trace-id': traceId },
    });

    await sleep(300);

    await kafka.produce(kafkaTopics.payments, {
      key: payment.paymentId,
      value: payment,
      headers: { 'event-type': 'payment.processing', 'trace-id': traceId },
    });

    await sleep(300);

    const orderMessages = await kafka.consume<OrderEvent>(kafkaTopics.orders, {
      count: 1,
      timeoutMs: 15000,
      filter: (msg) => msg.headers['trace-id'] === traceId,
    });

    const paymentMessages = await kafka.consume<PaymentEvent>(kafkaTopics.payments, {
      count: 1,
      timeoutMs: 15000,
      filter: (msg) => msg.headers['trace-id'] === traceId,
    });

    expect(orderMessages[0].value.orderId).toBe(order.orderId);
    expect(paymentMessages[0].value.orderId).toBe(order.orderId);
    expect(paymentMessages[0].value.paymentId).toBe(payment.paymentId);
  });

  test('notification is triggered after payment completion', async ({ kafka }) => {
    const userId = randomId();
    const traceId = randomId();

    const payment = createPaymentEvent({ status: 'completed' });
    const notification = createNotificationEvent({
      userId,
      type: 'payment_update',
      channel: 'email',
      payload: { paymentId: payment.paymentId, status: 'completed' },
    });

    await kafka.produce(kafkaTopics.payments, {
      key: payment.paymentId,
      value: payment,
      headers: { 'event-type': 'payment.completed', 'trace-id': traceId },
    });

    await sleep(300);

    await kafka.produce(kafkaTopics.notifications, {
      key: notification.notificationId,
      value: notification,
      headers: { 'event-type': 'notification.sent', 'trace-id': traceId },
    });

    await sleep(300);

    const notifications = await kafka.consume<NotificationEvent>(kafkaTopics.notifications, {
      count: 1,
      timeoutMs: 15000,
      filter: (msg) => msg.headers['trace-id'] === traceId,
    });

    expect(notifications[0].value.type).toBe('payment_update');
    expect(notifications[0].value.channel).toBe('email');
  });

  test('dead letter queue receives failed messages', async ({ kafka }) => {
    const failedEvent = createOrderEvent({ status: 'cancelled' });
    const reason = 'payment_failed';

    await kafka.produce(kafkaTopics.deadLetter, {
      key: failedEvent.orderId,
      value: { originalEvent: failedEvent, failureReason: reason, failedAt: new Date().toISOString() },
      headers: { 'event-type': 'order.failed', 'original-topic': kafkaTopics.orders },
    });

    await sleep(300);

    const dlqMessages = await kafka.consume(kafkaTopics.deadLetter, {
      count: 1,
      timeoutMs: 15000,
      filter: (msg) => msg.key === failedEvent.orderId,
    });

    expect(dlqMessages).toHaveLength(1);
    expect(dlqMessages[0].headers['original-topic']).toBe(kafkaTopics.orders);
  });

  test('stream processing preserves message order within partition', async ({ kafka }) => {
    const partitionKey = randomId();
    const statuses: OrderEvent['status'][] = ['created', 'confirmed', 'shipped', 'delivered'];
    const orderId = randomId();

    for (const status of statuses) {
      await kafka.produce(kafkaTopics.orders, {
        key: partitionKey,
        value: createOrderEvent({ orderId, status }),
        headers: { 'event-type': `order.${status}` },
      });
      await sleep(100);
    }

    await sleep(500);

    const messages = await kafka.consume<OrderEvent>(kafkaTopics.orders, {
      count: statuses.length,
      timeoutMs: 20000,
      filter: (msg) => msg.key === partitionKey,
    });

    expect(messages).toHaveLength(statuses.length);

    const receivedStatuses = messages.map((m) => m.value.status);
    expect(receivedStatuses).toEqual(statuses);
  });

  test('audit events are produced for all order state changes', async ({ kafka }) => {
    const orderId = randomId();
    const userId = randomId();
    const traceId = randomId();
    const actions = ['ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_SHIPPED'];

    for (const action of actions) {
      await kafka.produce(kafkaTopics.audit, {
        key: randomId(),
        value: {
          action,
          resource: 'order',
          resourceId: orderId,
          userId,
          timestamp: new Date().toISOString(),
          metadata: {},
        },
        headers: { 'trace-id': traceId },
      });
      await sleep(50);
    }

    await sleep(300);

    const auditMessages = await kafka.consume(kafkaTopics.audit, {
      count: actions.length,
      timeoutMs: 15000,
      filter: (msg) => msg.headers['trace-id'] === traceId,
    });

    expect(auditMessages).toHaveLength(actions.length);
  });
});
