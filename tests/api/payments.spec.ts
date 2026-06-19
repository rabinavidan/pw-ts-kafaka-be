import { test, expect } from '../../src/fixtures';
import { endpoints } from '../../src/config/api.config';
import { Order, Payment } from '../../src/models/api.model';
import { createOrderRequest, randomId } from '../../src/utils/data.factory';
import { assertSuccessResponse, assertCreatedResponse, assertErrorResponse } from '../../src/utils/assertion';

test.describe('Payments API @regression', () => {
  test('POST /payments initiates payment for an order', async ({ api }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const response = await api.post<Payment>(endpoints.payments, {
      orderId: order.data.id,
      method: 'credit_card',
      amount: order.data.amount,
      currency: order.data.currency,
    });

    assertCreatedResponse(response);
    expect(response.data.orderId).toBe(order.data.id);
    expect(response.data.status).toMatch(/^(pending|processing)$/);
    expect(response.data.method).toBe('credit_card');
  });

  test('GET /payments/:id retrieves payment details', async ({ api }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const payment = await api.post<Payment>(endpoints.payments, {
      orderId: order.data.id,
      method: 'bank_transfer',
    });
    assertCreatedResponse(payment);

    const fetched = await api.get<Payment>(`${endpoints.payments}/${payment.data.id}`);
    assertSuccessResponse(fetched);
    expect(fetched.data.id).toBe(payment.data.id);
  });

  test('GET /payments/:id returns 404 for unknown payment', async ({ api }) => {
    const response = await api.get(`${endpoints.payments}/${randomId()}`);
    assertErrorResponse(response, 404);
  });

  test('POST /payments returns 422 for missing orderId', async ({ api }) => {
    const response = await api.post(endpoints.payments, { method: 'credit_card', amount: 100 });
    assertErrorResponse(response, 422);
  });

  test('POST /payments returns 409 when payment already exists for order', async ({ api }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    await api.post<Payment>(endpoints.payments, { orderId: order.data.id, method: 'credit_card' });
    const duplicate = await api.post(endpoints.payments, { orderId: order.data.id, method: 'debit_card' });

    assertErrorResponse(duplicate, 409);
  });

  test('DELETE /payments/:id deletes an existing payment', async ({ api }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const payment = await api.post<Payment>(endpoints.payments, {
      orderId: order.data.id,
      method: 'credit_card',
    });
    assertCreatedResponse(payment);

    const deleted = await api.delete<{ id: string; deleted: boolean }>(`${endpoints.payments}/${payment.data.id}`);
    assertSuccessResponse(deleted);
    expect(deleted.data.id).toBe(payment.data.id);
    expect(deleted.data.deleted).toBe(true);
  });

  test('DELETE /payments/:id returns 404 for non-existent payment', async ({ api }) => {
    const response = await api.delete(`${endpoints.payments}/${randomId()}`);
    assertErrorResponse(response, 404);
  });

  test('DELETE /payments/:id removed payment no longer accessible via GET', async ({ api }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const payment = await api.post<Payment>(endpoints.payments, {
      orderId: order.data.id,
      method: 'bank_transfer',
    });
    assertCreatedResponse(payment);

    await api.delete(`${endpoints.payments}/${payment.data.id}`);

    const fetched = await api.get(`${endpoints.payments}/${payment.data.id}`);
    assertErrorResponse(fetched, 404);
  });
});
