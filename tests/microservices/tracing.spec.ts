import { test, expect } from '../../src/fixtures';
import { endpoints, apiConfig } from '../../src/config/api.config';
import { Order, Payment } from '../../src/models/api.model';
import { createOrderRequest } from '../../src/utils/data.factory';
import { assertCreatedResponse } from '../../src/utils/assertion';
import { waitUntil } from '../../src/utils/retry';

interface EventLogRow {
  id: string;
  topic: string;
  key: string | null;
  event_type: string;
  trace_id: string | null;
}

// A trace id is assigned once, at the gateway, and carried through every
// Kafka event an order's saga produces — including its payments. This is
// what lets one order be followed end to end across topics and services.
test.describe('Distributed Tracing @microservice @regression', () => {
  test("an order's whole saga shares one trace id across every event it produces", async ({ api, db }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);
    const traceId = order.data.traceId;
    expect(traceId).toBeTruthy();

    await api.put(`${endpoints.orders}/${order.data.id}/confirm`);

    const payment = await api.post<Payment>(endpoints.payments, { orderId: order.data.id, method: 'credit_card' });
    assertCreatedResponse(payment);
    expect(payment.data.traceId).toBe(traceId);

    await api.put(`${endpoints.payments}/${payment.data.id}/process`);

    async function findEvents() {
      const { rows } = await db.query<EventLogRow>(
        `SELECT id, topic, key, event_type, trace_id FROM event_log WHERE trace_id = $1 ORDER BY created_at ASC`,
        [traceId]
      );
      return rows;
    }

    await waitUntil(async () => (await findEvents()).length >= 4, 20000, 500);
    const rows = await findEvents();

    const eventTypes = rows.map(r => r.event_type);
    expect(eventTypes).toEqual(
      expect.arrayContaining(['order.created', 'order.confirmed', 'payment.initiated', 'payment.processed'])
    );
    for (const row of rows) expect(row.trace_id).toBe(traceId);
  });

  test('a caller-supplied X-Trace-Id is honored end to end, not replaced', async ({ request, db }) => {
    const callerTraceId = `caller-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const res = await request.post(`${apiConfig.baseUrl}${endpoints.orders}`, {
      headers: { ...apiConfig.headers, 'X-Trace-Id': callerTraceId },
      data: createOrderRequest(),
    });
    expect(res.status()).toBe(201);
    const order = (await res.json()) as Order;

    expect(order.traceId).toBe(callerTraceId);
    expect(res.headers()['x-trace-id']).toBe(callerTraceId);

    async function findEvents() {
      const { rows } = await db.query<EventLogRow>(
        `SELECT id, topic, key, event_type, trace_id FROM event_log WHERE trace_id = $1`,
        [callerTraceId]
      );
      return rows;
    }

    await waitUntil(async () => (await findEvents()).length >= 1, 20000, 500);
    const rows = await findEvents();

    expect(rows[0].event_type).toBe('order.created');
  });

  test('GET /api/v1/events?traceId= returns only that order\'s events, chronologically', async ({ api }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);
    const traceId = order.data.traceId!;

    await api.put(`${endpoints.orders}/${order.data.id}/confirm`);
    await api.put(`${endpoints.orders}/${order.data.id}/cancel`);

    interface FeedEvent { eventType: string; traceId: string; timestamp: string }

    async function fetchEvents() {
      const res = await api.get<{ events: FeedEvent[] }>(endpoints.events, { traceId });
      return res.data.events;
    }

    await waitUntil(async () => (await fetchEvents()).length >= 3, 20000, 500);
    const events = await fetchEvents();

    for (const event of events) expect(event.traceId).toBe(traceId);

    const timestamps = events.map(e => new Date(e.timestamp).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }

    const eventTypes = events.map(e => e.eventType);
    expect(eventTypes).toEqual(['order.created', 'order.confirmed', 'order.cancelled']);
  });
});
