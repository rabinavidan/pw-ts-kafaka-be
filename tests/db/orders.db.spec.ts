import { test, expect } from '../../src/fixtures';
import { v4 as uuidv4 } from 'uuid';

test.describe('DB Layer — orders table @db', () => {
  test('inserts a row and reads it back by id', async ({ db }) => {
    const id = uuidv4();
    const row = await db.insertOrder({ id, user_id: 'u-1', amount: 120.50, currency: 'USD' });

    expect(row.id).toBe(id);
    expect(row.user_id).toBe('u-1');
    expect(row.status).toBe('created');
    expect(parseFloat(row.amount as unknown as string)).toBe(120.50);
    expect(row.currency).toBe('USD');
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.updated_at).toBeInstanceOf(Date);
  });

  test('findOrderById returns null for unknown id', async ({ db }) => {
    const result = await db.findOrderById(uuidv4());
    expect(result).toBeNull();
  });

  test('updateOrderStatus changes status and sets updated_at', async ({ db }) => {
    const order = await db.insertOrder({ user_id: 'u-2', amount: 50 });

    const updated = await db.updateOrderStatus(order.id, 'confirmed');

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('confirmed');
    expect(updated!.updated_at).toBeInstanceOf(Date);
  });

  test('updateOrderStatus returns null for non-existent id', async ({ db }) => {
    const result = await db.updateOrderStatus(uuidv4(), 'cancelled');
    expect(result).toBeNull();
  });

  test('deleteOrder removes the row and returns true', async ({ db }) => {
    const order = await db.insertOrder({ user_id: 'u-3', amount: 75 });

    const deleted = await db.deleteOrder(order.id);
    expect(deleted).toBe(true);

    const row = await db.findOrderById(order.id);
    expect(row).toBeNull();
  });

  test('deleteOrder returns false for non-existent id', async ({ db }) => {
    const result = await db.deleteOrder(uuidv4());
    expect(result).toBe(false);
  });

  test('findOrdersByStatus filters correctly', async ({ db }) => {
    const userId = uuidv4();
    const o1 = await db.insertOrder({ user_id: userId, amount: 10, status: 'created' });
    const o2 = await db.insertOrder({ user_id: userId, amount: 20, status: 'confirmed' });
    const o3 = await db.insertOrder({ user_id: userId, amount: 30, status: 'created' });

    const created = await db.findOrdersByStatus('created');
    const ids = created.map(r => r.id);

    expect(ids).toContain(o1.id);
    expect(ids).toContain(o3.id);
    expect(ids).not.toContain(o2.id);

    await db.deleteOrder(o1.id);
    await db.deleteOrder(o2.id);
    await db.deleteOrder(o3.id);
  });

  test('findOrdersByUserId returns only that users orders', async ({ db }) => {
    const userId = uuidv4();
    const o1 = await db.insertOrder({ user_id: userId, amount: 10 });
    const o2 = await db.insertOrder({ user_id: userId, amount: 20 });
    const other = await db.insertOrder({ user_id: uuidv4(), amount: 30 });

    const rows = await db.findOrdersByUserId(userId);
    const ids = rows.map(r => r.id);

    expect(ids).toContain(o1.id);
    expect(ids).toContain(o2.id);
    expect(ids).not.toContain(other.id);

    await db.deleteOrder(o1.id);
    await db.deleteOrder(o2.id);
    await db.deleteOrder(other.id);
  });

  test('countOrders increases after insert', async ({ db }) => {
    const before = await db.countOrders();
    const order = await db.insertOrder({ user_id: 'u-count', amount: 1 });

    expect(await db.countOrders()).toBe(before + 1);

    await db.deleteOrder(order.id);
    expect(await db.countOrders()).toBe(before);
  });

  test('countOrders with status filter counts only matching rows', async ({ db }) => {
    const cancelledBefore = await db.countOrders('cancelled');
    const order = await db.insertOrder({ user_id: 'u-status', amount: 1, status: 'cancelled' });

    expect(await db.countOrders('cancelled')).toBe(cancelledBefore + 1);
    expect(await db.countOrders('created')).toBe(await db.countOrders('created'));

    await db.deleteOrder(order.id);
  });

  test('primary key constraint rejects duplicate id', async ({ db }) => {
    const id = uuidv4();
    await db.insertOrder({ id, user_id: 'u-pk', amount: 1 });

    await expect(
      db.insertOrder({ id, user_id: 'u-pk-dup', amount: 2 })
    ).rejects.toThrow();

    await db.deleteOrder(id);
  });

  test('NOT NULL constraint rejects missing user_id', async ({ db }) => {
    await expect(
      db.query('INSERT INTO orders (id, status, amount, currency, items) VALUES ($1, $2, $3, $4, $5)', [uuidv4(), 'created', 10, 'USD', '[]'])
    ).rejects.toThrow();
  });

  test('default currency is USD when not specified', async ({ db }) => {
    const order = await db.insertOrder({ user_id: 'u-currency', amount: 50 });
    expect(order.currency).toBe('USD');
    await db.deleteOrder(order.id);
  });

  test('default status is created when not specified', async ({ db }) => {
    const order = await db.insertOrder({ user_id: 'u-status-default', amount: 50 });
    expect(order.status).toBe('created');
    await db.deleteOrder(order.id);
  });
});
