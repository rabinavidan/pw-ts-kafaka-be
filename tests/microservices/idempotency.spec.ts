import { test, expect } from '../../src/fixtures';
import { endpoints } from '../../src/config/api.config';
import { kafkaTopics } from '../../src/config/kafka.config';
import { Order } from '../../src/models/api.model';
import { OrderEvent } from '../../src/models/kafka.model';
import { createOrderEvent, createOrderRequest } from '../../src/utils/data.factory';
import { assertCreatedResponse } from '../../src/utils/assertion';
import { sleep, waitUntil } from '../../src/utils/retry';

// notification-service is the only real Kafka consumer in this system — it
// dedupes on (topic, event-type, key) so a redelivered/duplicated message
// only ever lands one event_log row, however many times it's delivered.
test.describe('Kafka Consumer Idempotency @microservice @regression', () => {
  async function eventLogCount(db: import('../../src/helpers/db.helper').DbHelper, topic: string, eventType: string, key: string) {
    const { rows } = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM event_log WHERE topic = $1 AND event_type = $2 AND key = $3`,
      [topic, eventType, key]
    );
    return parseInt(rows[0].count, 10);
  }

  test('a duplicated order.created message is only recorded once', async ({ kafka, db }) => {
    const event = createOrderEvent({ status: 'created' });

    // Simulate an at-least-once redelivery: the exact same logical event,
    // published twice in a row.
    await kafka.produce<OrderEvent>(kafkaTopics.orders, {
      key: event.orderId,
      value: event,
      headers: { 'event-type': 'order.created' },
    });
    await kafka.produce<OrderEvent>(kafkaTopics.orders, {
      key: event.orderId,
      value: event,
      headers: { 'event-type': 'order.created' },
    });

    await waitUntil(
      async () => (await eventLogCount(db, kafkaTopics.orders, 'order.created', event.orderId)) >= 1,
      20000,
      500
    );
    // Give the (skipped) second delivery time to have been processed too.
    await sleep(1500);

    expect(await eventLogCount(db, kafkaTopics.orders, 'order.created', event.orderId)).toBe(1);
  });

  test('confirming the same order twice via the real API only records one order.confirmed event', async ({ api, db }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);
    const orderId = order.data.id;

    const [first, second] = await Promise.all([
      api.put(`${endpoints.orders}/${orderId}/confirm`),
      api.put(`${endpoints.orders}/${orderId}/confirm`),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);

    await waitUntil(
      async () => (await eventLogCount(db, kafkaTopics.orders, 'order.confirmed', orderId)) >= 1,
      20000,
      500
    );
    await sleep(1500);

    expect(await eventLogCount(db, kafkaTopics.orders, 'order.confirmed', orderId)).toBe(1);
  });

  test('distinct event types for the same entity are never deduped against each other', async ({ kafka, db }) => {
    const orderId = createOrderEvent().orderId;
    const created   = createOrderEvent({ orderId, status: 'created' });
    const confirmed = createOrderEvent({ orderId, status: 'confirmed' });

    await kafka.produce<OrderEvent>(kafkaTopics.orders, {
      key: orderId, value: created, headers: { 'event-type': 'order.created' },
    });
    await kafka.produce<OrderEvent>(kafkaTopics.orders, {
      key: orderId, value: confirmed, headers: { 'event-type': 'order.confirmed' },
    });

    await waitUntil(async () => {
      const createdCount   = await eventLogCount(db, kafkaTopics.orders, 'order.created', orderId);
      const confirmedCount = await eventLogCount(db, kafkaTopics.orders, 'order.confirmed', orderId);
      return createdCount >= 1 && confirmedCount >= 1;
    }, 20000, 500);

    expect(await eventLogCount(db, kafkaTopics.orders, 'order.created', orderId)).toBe(1);
    expect(await eventLogCount(db, kafkaTopics.orders, 'order.confirmed', orderId)).toBe(1);
  });
});
