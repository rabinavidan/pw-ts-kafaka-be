import { test, expect } from '../../src/fixtures';
import { endpoints } from '../../src/config/api.config';
import { Order, Payment } from '../../src/models/api.model';
import { createOrderRequest } from '../../src/utils/data.factory';
import { assertCreatedResponse } from '../../src/utils/assertion';

// Note: this codebase has no inventory/stock concept to exercise an
// out-of-stock saga against, so these cover the failure paths that do
// exist end to end through the real orders/payments services.
test.describe('Negative Sagas @microservice @regression', () => {
  test('a failed payment does not corrupt or roll back its order', async ({ api }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const payment = await api.post<Payment>(endpoints.payments, { orderId: order.data.id, method: 'credit_card' });
    assertCreatedResponse(payment);

    const failRes = await api.put<Payment>(`${endpoints.payments}/${payment.data.id}/fail`);
    expect(failRes.status).toBe(200);
    expect(failRes.data.status).toBe('failed');

    // The order itself is a separate aggregate — a failed payment must not
    // silently mutate it.
    const orderAfter = await api.get<Order>(`${endpoints.orders}/${order.data.id}`);
    expect(orderAfter.status).toBe(200);
    expect(orderAfter.data.status).toBe('created');
  });

  test('simulateFailure short-circuits before a payment row ever exists', async ({ api }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const res = await api.post<{ id: string; orderId: string; status: string }>(endpoints.payments, {
      orderId: order.data.id,
      method: 'credit_card',
      simulateFailure: true,
    });
    expect(res.status).toBe(201);
    expect(res.data.status).toBe('failed');

    // No payments row was ever inserted for this synthetic failure — the
    // returned id is not a real, retrievable payment.
    const getRes = await api.get<Payment>(`${endpoints.payments}/${res.data.id}`);
    expect(getRes.status).toBe(404);

    // A real payment can still be created for the same order afterwards —
    // the simulated failure didn't consume the order's "one payment" slot.
    const realPayment = await api.post<Payment>(endpoints.payments, { orderId: order.data.id, method: 'credit_card' });
    assertCreatedResponse(realPayment);
    expect(realPayment.data.status).toBe('pending');
  });

  test('cancelling an order does not touch a payment already made against it', async ({ api }) => {
    const order = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(order);

    const payment = await api.post<Payment>(endpoints.payments, { orderId: order.data.id, method: 'credit_card' });
    assertCreatedResponse(payment);
    expect(payment.data.status).toBe('pending');

    const cancelRes = await api.put<Order>(`${endpoints.orders}/${order.data.id}/cancel`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.data.status).toBe('cancelled');

    // Documents current, real behavior: orders and payments are cancelled
    // independently — the payment is left pending on a now-cancelled order.
    // There is no automatic reconciliation between the two.
    const paymentAfter = await api.get<Payment>(`${endpoints.payments}/${payment.data.id}`);
    expect(paymentAfter.status).toBe(200);
    expect(paymentAfter.data.status).toBe('pending');
  });
});
