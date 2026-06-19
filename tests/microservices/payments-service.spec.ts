import { test, expect } from '@playwright/test';
import { ApiHelper } from '../../src/helpers/api.helper';
import { Order, Payment } from '../../src/models/api.model';
import { createOrderRequest, randomId } from '../../src/utils/data.factory';
import { assertSuccessResponse, assertCreatedResponse, assertErrorResponse } from '../../src/utils/assertion';

const SVC       = process.env.PAYMENTS_SERVICE_URL || 'http://localhost:3002';
const ORDERS_SVC = process.env.ORDERS_SERVICE_URL  || 'http://localhost:3001';

async function createOrder(request: Parameters<typeof ApiHelper>[0]): Promise<Order> {
  const ordersApi = new ApiHelper(request, ORDERS_SVC);
  const res = await ordersApi.post<Order>('/api/v1/orders', createOrderRequest());
  return res.data;
}

test.describe('Payments Service (port 3002) @microservice', () => {

  test.describe('Health & Readiness', () => {
    test('GET /health returns healthy with service name', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.get<{ status: string; service: string; dependencies: unknown[] }>('/health');

      assertSuccessResponse(res);
      expect(res.data.status).toBe('healthy');
      expect(res.data.service).toBe('payments-service');
      expect(Array.isArray(res.data.dependencies)).toBe(true);
    });

    test('GET /ready returns ready status', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.get<{ status: string }>('/ready');

      assertSuccessResponse(res);
      expect(res.data.status).toBe('ready');
    });

    test('GET /health reports database dependency as up', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.get<{ dependencies: Array<{ name: string; status: string }> }>('/health');

      assertSuccessResponse(res);
      const db = res.data.dependencies.find(d => d.name === 'database');
      expect(db).toBeDefined();
      expect(db!.status).toBe('up');
    });
  });

  test.describe('POST /api/v1/payments', () => {
    test('creates payment for a valid order and returns 201', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const order = await createOrder(request);

      const res = await api.post<Payment>('/api/v1/payments', {
        orderId: order.id,
        method: 'credit_card',
      });

      assertCreatedResponse(res);
      expect(res.data.id).toBeDefined();
      expect(res.data.orderId).toBe(order.id);
      expect(res.data.status).toBe('pending');
      expect(res.data.method).toBe('credit_card');
      expect(res.data.amount).toBeGreaterThan(0);
    });

    test('returns 422 when orderId is missing', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.post('/api/v1/payments', { method: 'credit_card' });
      assertErrorResponse(res, 422);
    });

    test('returns 409 when payment already exists for order', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const order = await createOrder(request);

      await api.post<Payment>('/api/v1/payments', { orderId: order.id, method: 'credit_card' });
      const duplicate = await api.post('/api/v1/payments', { orderId: order.id, method: 'bank_transfer' });

      assertErrorResponse(duplicate, 409);
    });
  });

  test.describe('GET /api/v1/payments/:id', () => {
    test('retrieves payment by id', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const order = await createOrder(request);
      const created = await api.post<Payment>('/api/v1/payments', { orderId: order.id, method: 'bank_transfer' });
      assertCreatedResponse(created);

      const res = await api.get<Payment>(`/api/v1/payments/${created.data.id}`);
      assertSuccessResponse(res);
      expect(res.data.id).toBe(created.data.id);
      expect(res.data.orderId).toBe(order.id);
    });

    test('returns 404 for unknown id', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.get(`/api/v1/payments/${randomId()}`);
      assertErrorResponse(res, 404);
    });
  });

  test.describe('PUT /api/v1/payments/:id/process', () => {
    test('moves payment status to processed', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const order = await createOrder(request);
      const payment = await api.post<Payment>('/api/v1/payments', { orderId: order.id, method: 'credit_card' });
      assertCreatedResponse(payment);

      const res = await api.put<Payment>(`/api/v1/payments/${payment.data.id}/process`);
      assertSuccessResponse(res);
      expect(res.data.status).toBe('processed');
    });

    test('returns 404 for unknown id', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.put(`/api/v1/payments/${randomId()}/process`);
      assertErrorResponse(res, 404);
    });
  });

  test.describe('PUT /api/v1/payments/:id/refund', () => {
    test('moves payment status to refunded', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const order = await createOrder(request);
      const payment = await api.post<Payment>('/api/v1/payments', { orderId: order.id, method: 'debit_card' });
      assertCreatedResponse(payment);

      const res = await api.put<Payment>(`/api/v1/payments/${payment.data.id}/refund`);
      assertSuccessResponse(res);
      expect(res.data.status).toBe('refunded');
    });

    test('returns 404 for unknown id', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.put(`/api/v1/payments/${randomId()}/refund`);
      assertErrorResponse(res, 404);
    });
  });

  test.describe('PUT /api/v1/payments/:id/fail', () => {
    test('moves payment status to failed', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const order = await createOrder(request);
      const payment = await api.post<Payment>('/api/v1/payments', { orderId: order.id, method: 'bank_transfer' });
      assertCreatedResponse(payment);

      const res = await api.put<Payment>(`/api/v1/payments/${payment.data.id}/fail`);
      assertSuccessResponse(res);
      expect(res.data.status).toBe('failed');
    });

    test('returns 404 for unknown id', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.put(`/api/v1/payments/${randomId()}/fail`);
      assertErrorResponse(res, 404);
    });
  });

  test.describe('DELETE /api/v1/payments/:id', () => {
    test('deletes an existing payment and returns deleted:true', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const order = await createOrder(request);
      const payment = await api.post<Payment>('/api/v1/payments', { orderId: order.id, method: 'credit_card' });
      assertCreatedResponse(payment);

      const res = await api.delete<{ id: string; deleted: boolean }>(`/api/v1/payments/${payment.data.id}`);
      assertSuccessResponse(res);
      expect(res.data.id).toBe(payment.data.id);
      expect(res.data.deleted).toBe(true);
    });

    test('deleted payment is no longer retrievable', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const order = await createOrder(request);
      const payment = await api.post<Payment>('/api/v1/payments', { orderId: order.id, method: 'credit_card' });
      assertCreatedResponse(payment);

      await api.delete(`/api/v1/payments/${payment.data.id}`);

      const res = await api.get(`/api/v1/payments/${payment.data.id}`);
      assertErrorResponse(res, 404);
    });

    test('returns 404 for unknown id', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.delete(`/api/v1/payments/${randomId()}`);
      assertErrorResponse(res, 404);
    });
  });
});
