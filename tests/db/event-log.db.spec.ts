import { test, expect } from '../../src/fixtures';
import { v4 as uuidv4 } from 'uuid';

test.describe('DB Layer — event_log table @db', () => {
  test('inserts an event and reads it back by topic', async ({ db }) => {
    const key = uuidv4();
    const payload = { orderId: key, amount: 99.99 };

    const row = await db.insertEventLog({ topic: 'orders', key, event_type: 'order.created', payload });

    expect(row.id).toBeTruthy();
    expect(row.topic).toBe('orders');
    expect(row.key).toBe(key);
    expect(row.event_type).toBe('order.created');
    expect(row.payload).toMatchObject(payload);
    expect(row.created_at).toBeInstanceOf(Date);
  });

  test('findEventsByTopic returns only events for that topic', async ({ db }) => {
    const key = uuidv4();
    const e1 = await db.insertEventLog({ topic: 'orders', key, event_type: 'order.created', payload: {} });
    const e2 = await db.insertEventLog({ topic: 'payments', key, event_type: 'payment.initiated', payload: {} });

    const orderEvents = await db.findEventsByTopic('orders');
    const ids = orderEvents.map(r => r.id);

    expect(ids).toContain(e1.id);
    expect(ids).not.toContain(e2.id);
  });

  test('findEventsByType filters by event_type', async ({ db }) => {
    const key = uuidv4();
    const e1 = await db.insertEventLog({ topic: 'orders', key, event_type: 'order.created', payload: {} });
    const e2 = await db.insertEventLog({ topic: 'orders', key, event_type: 'order.cancelled', payload: {} });

    const created = await db.findEventsByType('order.created');
    const ids = created.map(r => r.id);

    expect(ids).toContain(e1.id);
    expect(ids).not.toContain(e2.id);
  });

  test('findEventsByKey returns all events for a resource key', async ({ db }) => {
    const key = uuidv4();
    const e1 = await db.insertEventLog({ topic: 'orders', key, event_type: 'order.created', payload: {} });
    const e2 = await db.insertEventLog({ topic: 'orders', key, event_type: 'order.confirmed', payload: {} });
    const other = await db.insertEventLog({ topic: 'orders', key: uuidv4(), event_type: 'order.created', payload: {} });

    const rows = await db.findEventsByKey(key);
    const ids = rows.map(r => r.id);

    expect(ids).toContain(e1.id);
    expect(ids).toContain(e2.id);
    expect(ids).not.toContain(other.id);
  });

  test('payload is stored and retrieved as JSON', async ({ db }) => {
    const payload = { orderId: uuidv4(), items: [{ name: 'Widget', qty: 3 }], meta: { source: 'test' } };
    const row = await db.insertEventLog({ topic: 'orders', event_type: 'order.created', payload });

    const found = await db.findEventsByType('order.created');
    const match = found.find(r => r.id === row.id);

    expect(match).toBeDefined();
    expect(match!.payload).toMatchObject(payload);
  });

  test('key is nullable', async ({ db }) => {
    const row = await db.insertEventLog({ topic: 'orders', event_type: 'order.created', payload: {} });
    expect(row.key).toBeNull();
  });

  test('countEvents returns total across all topics', async ({ db }) => {
    const before = await db.countEvents();
    await db.insertEventLog({ topic: 'orders', event_type: 'order.created', payload: {} });
    await db.insertEventLog({ topic: 'payments', event_type: 'payment.initiated', payload: {} });

    expect(await db.countEvents()).toBe(before + 2);
  });

  test('countEvents with topic filter counts only that topic', async ({ db }) => {
    const before = await db.countEvents('orders');
    await db.insertEventLog({ topic: 'orders', event_type: 'order.created', payload: {} });
    await db.insertEventLog({ topic: 'payments', event_type: 'payment.initiated', payload: {} });

    expect(await db.countEvents('orders')).toBe(before + 1);
  });

  test('primary key constraint rejects duplicate event id', async ({ db }) => {
    const id = uuidv4();
    await db.insertEventLog({ id, topic: 'orders', event_type: 'order.created', payload: {} });

    await expect(
      db.insertEventLog({ id, topic: 'orders', event_type: 'order.created', payload: {} })
    ).rejects.toThrow();
  });

  test('events are ordered by created_at ascending', async ({ db }) => {
    const key = uuidv4();
    await db.insertEventLog({ topic: 'orders', key, event_type: 'order.created', payload: {} });
    await db.insertEventLog({ topic: 'orders', key, event_type: 'order.confirmed', payload: {} });
    await db.insertEventLog({ topic: 'orders', key, event_type: 'order.cancelled', payload: {} });

    const rows = await db.findEventsByKey(key);

    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].created_at.getTime()).toBeGreaterThanOrEqual(rows[i - 1].created_at.getTime());
    }
  });
});
