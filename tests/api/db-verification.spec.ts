import { test, expect } from '../../src/fixtures';
import { endpoints } from '../../src/config/api.config';
import { Order, Payment } from '../../src/models/api.model';
import { createOrderRequest } from '../../src/utils/data.factory';
import { assertCreatedResponse } from '../../src/utils/assertion';

test.describe('DB Verification — Orders @regression', () => {
  test('creating an order persists a row in the orders table', async ({ api, db }) => {
    const payload = createOrderRequest();
    const response = await api.post<Order>(endpoints.orders, payload);
    assertCreatedResponse(response);

    const row = await db.findOrderById(response.data.id);

    expect(row).not.toBeNull();
    expect(row!.id).toBe(response.data.id);
    expect(row!.user_id).toBe(payload.userId);
    expect(row!.status).toBe('created');
    expect(row!.currency).toBe(payload.currency ?? 'USD');
    expect(parseFloat(row!.amount as unknown as string)).toBeGreaterThan(0);
    expect(row!.created_at).toBeInstanceOf(Date);
  });

  test('cancelling an order updates status to cancelled in the DB', async ({ api, db }) => {
    const created = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(created);

    await api.put(`${endpoints.orders}/${created.data.id}/cancel`);

    const row = await db.findOrderById(created.data.id);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('cancelled');
    expect(row!.updated_at).toBeInstanceOf(Date);
  });

  test('confirming an order updates status to confirmed in the DB', async ({ api, db }) => {
    const created = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(created);

    await api.put(`${endpoints.orders}/${created.data.id}/confirm`);

    const row = await db.findOrderById(created.data.id);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('confirmed');
    expect(row!.updated_at).toBeInstanceOf(Date);
  });

  test('deleting an order removes the row from the DB', async ({ api, db }) => {
    const created = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(created);

    const rowBefore = await db.findOrderById(created.data.id);
    expect(rowBefore).not.toBeNull();

    await api.delete(`${endpoints.orders}/${created.data.id}`);

    const rowAfter = await db.findOrderById(created.data.id);
    expect(rowAfter).toBeNull();
  });

  test('orders table count increases after bulk create', async ({ api, db }) => {
    const countBefore = await db.countOrders();

    await Promise.all([
      api.post<Order>(endpoints.orders, createOrderRequest()),
      api.post<Order>(endpoints.orders, createOrderRequest()),
      api.post<Order>(endpoints.orders, createOrderRequest()),
    ]);

    const countAfter = await db.countOrders();
    expect(countAfter).toBe(countBefore + 3);
  });
});

test.describe('DB Verification — Payments @regression', () => {
  test('creating a payment persists a row in the payments table', async ({ api, db }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const response = await api.post<Payment>(endpoints.payments, {
      orderId: order.data.id,
      method: 'credit_card',
    });
    assertCreatedResponse(response);

    const row = await db.findPaymentById(response.data.id);

    expect(row).not.toBeNull();
    expect(row!.id).toBe(response.data.id);
    expect(row!.order_id).toBe(order.data.id);
    expect(row!.status).toBe('pending');
    expect(row!.method).toBe('credit_card');
    expect(row!.currency).toBe('USD');
    expect(parseFloat(row!.amount as unknown as string)).toBeGreaterThan(0);
    expect(row!.created_at).toBeInstanceOf(Date);
  });

  test('processing a payment updates status to processed in the DB', async ({ api, db }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const payment = await api.post<Payment>(endpoints.payments, {
      orderId: order.data.id,
      method: 'bank_transfer',
    });
    assertCreatedResponse(payment);

    await api.put(`${endpoints.payments}/${payment.data.id}/process`);

    const row = await db.findPaymentById(payment.data.id);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('processed');
    expect(row!.updated_at).toBeInstanceOf(Date);
  });

  test('refunding a payment updates status to refunded in the DB', async ({ api, db }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const payment = await api.post<Payment>(endpoints.payments, {
      orderId: order.data.id,
      method: 'debit_card',
    });
    assertCreatedResponse(payment);

    await api.put(`${endpoints.payments}/${payment.data.id}/refund`);

    const row = await db.findPaymentById(payment.data.id);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('refunded');
    expect(row!.updated_at).toBeInstanceOf(Date);
  });

  test('failing a payment updates status to failed in the DB', async ({ api, db }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const payment = await api.post<Payment>(endpoints.payments, {
      orderId: order.data.id,
      method: 'credit_card',
    });
    assertCreatedResponse(payment);

    await api.put(`${endpoints.payments}/${payment.data.id}/fail`);

    const row = await db.findPaymentById(payment.data.id);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('failed');
    expect(row!.updated_at).toBeInstanceOf(Date);
  });

  test('deleting a payment removes the row from the DB', async ({ api, db }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const payment = await api.post<Payment>(endpoints.payments, {
      orderId: order.data.id,
      method: 'credit_card',
    });
    assertCreatedResponse(payment);

    const rowBefore = await db.findPaymentById(payment.data.id);
    expect(rowBefore).not.toBeNull();

    await api.delete(`${endpoints.payments}/${payment.data.id}`);

    const rowAfter = await db.findPaymentById(payment.data.id);
    expect(rowAfter).toBeNull();
  });

  test('payments table count increases after creating a payment', async ({ api, db }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const countBefore = await db.countPayments();

    await api.post<Payment>(endpoints.payments, {
      orderId: order.data.id,
      method: 'bank_transfer',
    });

    const countAfter = await db.countPayments();
    expect(countAfter).toBe(countBefore + 1);
  });
});
