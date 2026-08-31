import { test, expect } from '../../src/fixtures';
import { endpoints } from '../../src/config/api.config';
import { kafkaTopics } from '../../src/config/kafka.config';
import { Order, Payment } from '../../src/models/api.model';
import { createOrderRequest } from '../../src/utils/data.factory';
import { assertCreatedResponse } from '../../src/utils/assertion';
import { assertMatchesContract } from '../../src/utils/contract';

// Each event-type has exactly one required shape (src/utils/contract.ts),
// checked here against messages the real services actually publish — not
// hand-built fixtures. This is what catches drift between what a producer
// emits and what every consumer (notification-service, the UI event feed,
// other services) is written to expect.
test.describe('Event Contracts @microservice @regression', () => {
  test('order.created matches its contract', async ({ api, kafka }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const [message] = await kafka.consume(kafkaTopics.orders, {
      count: 1, timeoutMs: 20000,
      filter: (msg: { key: string | null }) => msg.key === order.data.id,
    });

    expect(message).toBeDefined();
    assertMatchesContract('order.created', message.value);
  });

  test('order.confirmed matches its contract', async ({ api, kafka }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);
    await api.put(`${endpoints.orders}/${order.data.id}/confirm`);

    const [message] = await kafka.consume(kafkaTopics.orders, {
      count: 1, timeoutMs: 20000,
      filter: (msg: { key: string | null; value: { status?: string } }) =>
        msg.key === order.data.id && msg.value?.status === 'confirmed',
    });

    expect(message).toBeDefined();
    assertMatchesContract('order.confirmed', message.value);
  });

  test('order.cancelled matches its contract', async ({ api, kafka }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);
    await api.put(`${endpoints.orders}/${order.data.id}/cancel`);

    const [message] = await kafka.consume(kafkaTopics.orders, {
      count: 1, timeoutMs: 20000,
      filter: (msg: { key: string | null; value: { status?: string } }) =>
        msg.key === order.data.id && msg.value?.status === 'cancelled',
    });

    expect(message).toBeDefined();
    assertMatchesContract('order.cancelled', message.value);
  });

  test('payment.initiated matches its contract', async ({ api, kafka }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);
    const payment = await api.post<Payment>(endpoints.payments, { orderId: order.data.id, method: 'credit_card' });
    assertCreatedResponse(payment);

    const [message] = await kafka.consume(kafkaTopics.payments, {
      count: 1, timeoutMs: 20000,
      filter: (msg: { key: string | null }) => msg.key === payment.data.id,
    });

    expect(message).toBeDefined();
    assertMatchesContract('payment.initiated', message.value);
  });

  test('payment.processed matches its contract', async ({ api, kafka }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);
    const payment = await api.post<Payment>(endpoints.payments, { orderId: order.data.id, method: 'credit_card' });
    assertCreatedResponse(payment);
    await api.put(`${endpoints.payments}/${payment.data.id}/process`);

    const [message] = await kafka.consume(kafkaTopics.payments, {
      count: 1, timeoutMs: 20000,
      filter: (msg: { key: string | null; value: { status?: string } }) =>
        msg.key === payment.data.id && msg.value?.status === 'processed',
    });

    expect(message).toBeDefined();
    assertMatchesContract('payment.processed', message.value);
  });

  test('payment.refunded matches its contract', async ({ api, kafka }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);
    const payment = await api.post<Payment>(endpoints.payments, { orderId: order.data.id, method: 'credit_card' });
    assertCreatedResponse(payment);
    await api.put(`${endpoints.payments}/${payment.data.id}/refund`);

    const [message] = await kafka.consume(kafkaTopics.payments, {
      count: 1, timeoutMs: 20000,
      filter: (msg: { key: string | null; value: { status?: string } }) =>
        msg.key === payment.data.id && msg.value?.status === 'refunded',
    });

    expect(message).toBeDefined();
    assertMatchesContract('payment.refunded', message.value);
  });
});
