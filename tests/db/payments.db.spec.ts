import { test, expect } from '../../src/fixtures';
import { v4 as uuidv4 } from 'uuid';

test.describe('DB Layer — payments table @db', () => {
  test('inserts a payment and reads it back by id', async ({ db }) => {
    const order = await db.insertOrder({ user_id: uuidv4(), amount: 100 });
    const id = uuidv4();

    const row = await db.insertPayment({ id, order_id: order.id, amount: 100, currency: 'USD', method: 'credit_card' });

    expect(row.id).toBe(id);
    expect(row.order_id).toBe(order.id);
    expect(row.status).toBe('pending');
    expect(row.method).toBe('credit_card');
    expect(parseFloat(row.amount as unknown as string)).toBe(100);
    expect(row.currency).toBe('USD');
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.updated_at).toBeNull();

    await db.deletePayment(row.id);
    await db.deleteOrder(order.id);
  });

  test('findPaymentById returns null for unknown id', async ({ db }) => {
    const result = await db.findPaymentById(uuidv4());
    expect(result).toBeNull();
  });

  test('updatePaymentStatus changes status and sets updated_at', async ({ db }) => {
    const order = await db.insertOrder({ user_id: uuidv4(), amount: 100 });
    const payment = await db.insertPayment({ order_id: order.id, amount: 100 });

    const updated = await db.updatePaymentStatus(payment.id, 'processed');

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('processed');
    expect(updated!.updated_at).toBeInstanceOf(Date);

    await db.deletePayment(payment.id);
    await db.deleteOrder(order.id);
  });

  test('updatePaymentStatus returns null for non-existent id', async ({ db }) => {
    const result = await db.updatePaymentStatus(uuidv4(), 'processed');
    expect(result).toBeNull();
  });

  test('deletePayment removes the row and returns true', async ({ db }) => {
    const order = await db.insertOrder({ user_id: uuidv4(), amount: 100 });
    const payment = await db.insertPayment({ order_id: order.id, amount: 100 });

    expect(await db.deletePayment(payment.id)).toBe(true);
    expect(await db.findPaymentById(payment.id)).toBeNull();

    await db.deleteOrder(order.id);
  });

  test('deletePayment returns false for non-existent id', async ({ db }) => {
    expect(await db.deletePayment(uuidv4())).toBe(false);
  });

  test('findPaymentsByOrderId returns all payments for an order', async ({ db }) => {
    const order = await db.insertOrder({ user_id: uuidv4(), amount: 200 });
    const p1 = await db.insertPayment({ order_id: order.id, amount: 100, method: 'credit_card' });
    const p2 = await db.insertPayment({ order_id: order.id, amount: 100, method: 'paypal' });

    const rows = await db.findPaymentsByOrderId(order.id);
    const ids = rows.map(r => r.id);

    expect(ids).toContain(p1.id);
    expect(ids).toContain(p2.id);
    expect(rows.length).toBe(2);

    await db.deletePayment(p1.id);
    await db.deletePayment(p2.id);
    await db.deleteOrder(order.id);
  });

  test('findPaymentsByOrderId returns empty array for unknown order', async ({ db }) => {
    const rows = await db.findPaymentsByOrderId(uuidv4());
    expect(rows).toEqual([]);
  });

  test('findPaymentsByStatus filters correctly', async ({ db }) => {
    const order = await db.insertOrder({ user_id: uuidv4(), amount: 300 });
    const pending = await db.insertPayment({ order_id: order.id, amount: 100, status: 'pending' });
    const refunded = await db.insertPayment({ order_id: order.id, amount: 100, status: 'refunded' });

    const pendingRows = await db.findPaymentsByStatus('pending');
    const ids = pendingRows.map(r => r.id);

    expect(ids).toContain(pending.id);
    expect(ids).not.toContain(refunded.id);

    await db.deletePayment(pending.id);
    await db.deletePayment(refunded.id);
    await db.deleteOrder(order.id);
  });

  test('countPayments increases after insert', async ({ db }) => {
    const order = await db.insertOrder({ user_id: uuidv4(), amount: 100 });
    const before = await db.countPayments();

    const payment = await db.insertPayment({ order_id: order.id, amount: 100 });
    expect(await db.countPayments()).toBe(before + 1);

    await db.deletePayment(payment.id);
    await db.deleteOrder(order.id);
  });

  test('countPayments with status filter counts only matching rows', async ({ db }) => {
    const order = await db.insertOrder({ user_id: uuidv4(), amount: 100 });
    const failedBefore = await db.countPayments('failed');

    const payment = await db.insertPayment({ order_id: order.id, amount: 100, status: 'failed' });
    expect(await db.countPayments('failed')).toBe(failedBefore + 1);

    await db.deletePayment(payment.id);
    await db.deleteOrder(order.id);
  });

  test('primary key constraint rejects duplicate payment id', async ({ db }) => {
    const order = await db.insertOrder({ user_id: uuidv4(), amount: 100 });
    const id = uuidv4();
    await db.insertPayment({ id, order_id: order.id, amount: 100 });

    await expect(
      db.insertPayment({ id, order_id: order.id, amount: 50 })
    ).rejects.toThrow();

    await db.deletePayment(id);
    await db.deleteOrder(order.id);
  });

  test('default status is pending when not specified', async ({ db }) => {
    const order = await db.insertOrder({ user_id: uuidv4(), amount: 100 });
    const payment = await db.insertPayment({ order_id: order.id, amount: 100 });

    expect(payment.status).toBe('pending');

    await db.deletePayment(payment.id);
    await db.deleteOrder(order.id);
  });

  test('default method is credit_card when not specified', async ({ db }) => {
    const order = await db.insertOrder({ user_id: uuidv4(), amount: 100 });
    const payment = await db.insertPayment({ order_id: order.id, amount: 100 });

    expect(payment.method).toBe('credit_card');

    await db.deletePayment(payment.id);
    await db.deleteOrder(order.id);
  });

  test('all payment lifecycle statuses can be stored', async ({ db }) => {
    const order = await db.insertOrder({ user_id: uuidv4(), amount: 400 });
    const statuses = ['pending', 'processed', 'refunded', 'failed'];
    const ids: string[] = [];

    for (const status of statuses) {
      const p = await db.insertPayment({ order_id: order.id, amount: 100, status });
      expect(p.status).toBe(status);
      ids.push(p.id);
    }

    for (const id of ids) await db.deletePayment(id);
    await db.deleteOrder(order.id);
  });
});
