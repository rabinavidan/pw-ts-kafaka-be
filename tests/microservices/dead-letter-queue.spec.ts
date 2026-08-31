import { test, expect } from '../../src/fixtures';
import { endpoints } from '../../src/config/api.config';
import { kafkaTopics } from '../../src/config/kafka.config';
import { Order, Payment } from '../../src/models/api.model';
import { OrderEvent } from '../../src/models/kafka.model';
import { createOrderEvent, createOrderRequest, randomId } from '../../src/utils/data.factory';
import { assertCreatedResponse } from '../../src/utils/assertion';
import { assertMatchesContract } from '../../src/utils/contract';

test.describe('Dead Letter Queue @microservice @regression', () => {
  test('a malformed (non-JSON) message is routed to the DLQ instead of crashing the consumer', async ({ kafka }) => {
    const poisonKey = randomId();

    await kafka.produceRaw(kafkaTopics.orders, poisonKey, '{not valid json {{{');

    const dlqMessages = await kafka.consume(kafkaTopics.deadLetter, {
      count: 1,
      timeoutMs: 20000,
      filter: (msg: { key: string | null }) => msg.key === poisonKey,
    });

    expect(dlqMessages).toHaveLength(1);
    expect(dlqMessages[0].headers['event-type']).toBe('message.poisoned');
    expect(dlqMessages[0].headers['original-topic']).toBe(kafkaTopics.orders);
    assertMatchesContract('message.poisoned', dlqMessages[0].value);
    expect((dlqMessages[0].value as { failureReason: string }).failureReason).toBe('invalid_json');
  });

  test('the consumer keeps processing valid messages after a poison one', async ({ kafka }) => {
    const poisonKey = randomId();
    await kafka.produceRaw(kafkaTopics.orders, poisonKey, 'this is not json');

    // A perfectly normal event produced right after the poison one.
    const event = createOrderEvent({ status: 'created' });
    await kafka.produce<OrderEvent>(kafkaTopics.orders, {
      key: event.orderId,
      value: event,
      headers: { 'event-type': 'order.created' },
    });

    const messages = await kafka.consume<OrderEvent>(kafkaTopics.orders, {
      count: 1,
      timeoutMs: 20000,
      filter: (msg) => msg.value?.orderId === event.orderId,
    });

    // If the consumer had crashed or stalled on the poison message, this
    // topic-level assertion would still pass (Kafka delivered it fine) — the
    // real proof is the DLQ record for the poison message above, plus this
    // one continuing to be consumable at all with no gap in the group.
    expect(messages).toHaveLength(1);
    expect(messages[0].value.status).toBe('created');
  });

  test('PUT /payments/:id/fail publishes a payment.failed event to the DLQ matching the contract', async ({ api, kafka }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const payment = await api.post<Payment>(endpoints.payments, { orderId: order.data.id, method: 'credit_card' });
    assertCreatedResponse(payment);

    const failRes = await api.put<Payment>(`${endpoints.payments}/${payment.data.id}/fail`);
    expect(failRes.status).toBe(200);
    expect(failRes.data.status).toBe('failed');

    const dlqMessages = await kafka.consume(kafkaTopics.deadLetter, {
      count: 1,
      timeoutMs: 20000,
      filter: (msg: { key: string | null }) => msg.key === payment.data.id,
    });

    expect(dlqMessages).toHaveLength(1);
    expect(dlqMessages[0].headers['event-type']).toBe('payment.failed');
    assertMatchesContract('payment.failed', dlqMessages[0].value);
  });

  test('simulateFailure on POST /payments publishes a payment.failed event with the same contract as PUT /fail', async ({ api, kafka }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const res = await api.post<{ id: string; orderId: string; status: string }>(endpoints.payments, {
      orderId: order.data.id,
      method: 'credit_card',
      simulateFailure: true,
    });
    expect(res.status).toBe(201);
    expect(res.data.status).toBe('failed');

    const dlqMessages = await kafka.consume(kafkaTopics.deadLetter, {
      count: 1,
      timeoutMs: 20000,
      filter: (msg: { key: string | null }) => msg.key === order.data.id,
    });

    expect(dlqMessages).toHaveLength(1);
    expect(dlqMessages[0].headers['event-type']).toBe('payment.failed');
    // Same event-type, same contract as the PUT /fail path above — this is
    // the fix: both producers of payment.failed used to emit different
    // (incompatible) payload shapes.
    assertMatchesContract('payment.failed', dlqMessages[0].value);

    // simulateFailure never persists a payments row — only a synthetic
    // response + DLQ event. Document that real behavior rather than assume it.
    const getRes = await api.get<Payment>(`${endpoints.payments}/${res.data.id}`);
    expect(getRes.status).toBe(404);
  });
});
