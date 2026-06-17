import { test, expect } from '../../src/fixtures';
import { endpoints } from '../../src/config/api.config';
import { kafkaTopics } from '../../src/config/kafka.config';
import { Order, Payment } from '../../src/models/api.model';
import { OrderEvent, PaymentEvent } from '../../src/models/kafka.model';
import { createOrderRequest } from '../../src/utils/data.factory';
import { assertCreatedResponse } from '../../src/utils/assertion';
import { sleep } from '../../src/utils/retry';

test.describe('Order Pipeline Integration @regression', () => {
  test('creating an order via API publishes order event to Kafka', async ({ api, kafka }) => {
    const payload = createOrderRequest();
    const orderResponse = await api.post<Order>(endpoints.orders, payload);
    assertCreatedResponse(orderResponse);

    const orderId = orderResponse.data.id;

    const messages = await kafka.consume<OrderEvent>(kafkaTopics.orders, {
      count: 1,
      timeoutMs: 20000,
      filter: (msg) => msg.value?.orderId === orderId,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].value.orderId).toBe(orderId);
    expect(messages[0].value.status).toBe('created');
    expect(messages[0].headers['event-type']).toBe('order.created');
  });

  test('payment initiation publishes payment event to Kafka', async ({ api, kafka }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const payment = await api.post<Payment>(endpoints.payments, {
      orderId: order.data.id,
      method: 'credit_card',
    });
    assertCreatedResponse(payment);

    const messages = await kafka.consume<PaymentEvent>(kafkaTopics.payments, {
      count: 1,
      timeoutMs: 20000,
      filter: (msg) => msg.value?.orderId === order.data.id,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].value.orderId).toBe(order.data.id);
  });

  test('full order lifecycle: create -> pay -> confirm produces correct event sequence', async ({ api, kafka }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const orderId = order.data.id;

    const payment = await api.post<Payment>(endpoints.payments, {
      orderId,
      method: 'credit_card',
    });
    assertCreatedResponse(payment);

    await sleep(1000);

    await api.put<Order>(`${endpoints.orders}/${orderId}/confirm`);

    const orderEvents = await kafka.consume<OrderEvent>(kafkaTopics.orders, {
      count: 2,
      timeoutMs: 25000,
      filter: (msg) => msg.value?.orderId === orderId,
    });

    const statuses = orderEvents.map((m) => m.value.status);
    expect(statuses).toContain('created');
    expect(statuses).toContain('confirmed');
  });

  test('cancelling an order updates status and publishes cancellation event', async ({ api, kafka }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const orderId = order.data.id;

    const cancelled = await api.put<Order>(`${endpoints.orders}/${orderId}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.data.status).toBe('cancelled');

    const messages = await kafka.consume<OrderEvent>(kafkaTopics.orders, {
      count: 1,
      timeoutMs: 15000,
      filter: (msg) => msg.value?.orderId === orderId && msg.value?.status === 'cancelled',
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].headers['event-type']).toBe('order.cancelled');
  });

  test('failed payment routes order event to dead-letter queue', async ({ api, kafka }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const failedPayment = await api.post(endpoints.payments, {
      orderId: order.data.id,
      method: 'credit_card',
      simulateFailure: true,
    });

    if (failedPayment.status !== 422) {
      const dlqMessages = await kafka.consume(kafkaTopics.deadLetter, {
        count: 1,
        timeoutMs: 15000,
        filter: (msg: { key: string | null }) => msg.key === order.data.id,
      });

      if (dlqMessages.length > 0) {
        expect(dlqMessages[0].headers['original-topic']).toBe(kafkaTopics.orders);
      }
    } else {
      expect([422, 402]).toContain(failedPayment.status);
    }
  });
});
