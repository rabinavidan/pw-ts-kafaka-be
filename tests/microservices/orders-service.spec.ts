import { test, expect } from '@playwright/test';
import { ApiHelper } from '../../src/helpers/api.helper';
import { Order, PaginatedResponse } from '../../src/models/api.model';
import { createOrderRequest, randomId } from '../../src/utils/data.factory';
import { assertSuccessResponse, assertCreatedResponse, assertErrorResponse } from '../../src/utils/assertion';

const SVC = process.env.ORDERS_SERVICE_URL || 'http://localhost:3001';

test.describe('Orders Service (port 3001) @microservice', () => {

  test.describe('Health & Readiness', () => {
    test('GET /health returns healthy with service name', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.get<{ status: string; service: string; dependencies: unknown[] }>('/health');

      assertSuccessResponse(res);
      expect(res.data.status).toBe('healthy');
      expect(res.data.service).toBe('orders-service');
      expect(Array.isArray(res.data.dependencies)).toBe(true);
    });

    test('GET /ready returns ready status', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.get<{ status: string }>('/ready');

      assertSuccessResponse(res);
      expect(res.data.status).toBe('ready');
    });

    test('GET /health reports database dependency', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.get<{ dependencies: Array<{ name: string; status: string }> }>('/health');

      assertSuccessResponse(res);
      const db = res.data.dependencies.find(d => d.name === 'database');
      expect(db).toBeDefined();
      expect(db!.status).toBe('up');
    });
  });

  test.describe('POST /api/v1/orders', () => {
    test('creates order and returns 201 with correct fields', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const payload = createOrderRequest();
      const res = await api.post<Order>('/api/v1/orders', payload);

      assertCreatedResponse(res);
      expect(res.data.id).toBeDefined();
      expect(res.data.userId).toBe(payload.userId);
      expect(res.data.status).toBe('created');
      expect(res.data.currency).toBe(payload.currency);
      expect(res.data.amount).toBeGreaterThan(0);
    });

    test('returns 422 when userId is missing', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.post('/api/v1/orders', { items: [{ productId: 'p1', quantity: 1 }] });
      assertErrorResponse(res, 422);
    });

    test('returns 422 when items array is empty', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.post('/api/v1/orders', createOrderRequest({ items: [] }));
      assertErrorResponse(res, 422);
    });
  });

  test.describe('GET /api/v1/orders', () => {
    test('returns paginated list with correct shape', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.get<PaginatedResponse<Order>>('/api/v1/orders', { page: '1', pageSize: '5' });

      assertSuccessResponse(res);
      expect(Array.isArray(res.data.items)).toBe(true);
      expect(typeof res.data.total).toBe('number');
      expect(res.data.page).toBe(1);
      expect(res.data.pageSize).toBe(5);
    });

    test('filters by status=created', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      await api.post<Order>('/api/v1/orders', createOrderRequest());

      const res = await api.get<PaginatedResponse<Order>>('/api/v1/orders', { status: 'created' });
      assertSuccessResponse(res);
      for (const order of res.data.items) {
        expect(order.status).toBe('created');
      }
    });
  });

  test.describe('GET /api/v1/orders/:id', () => {
    test('returns order by id', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const created = await api.post<Order>('/api/v1/orders', createOrderRequest());
      assertCreatedResponse(created);

      const res = await api.get<Order>(`/api/v1/orders/${created.data.id}`);
      assertSuccessResponse(res);
      expect(res.data.id).toBe(created.data.id);
      expect(res.data.userId).toBe(created.data.userId);
    });

    test('returns 404 for unknown id', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.get(`/api/v1/orders/${randomId()}`);
      assertErrorResponse(res, 404);
    });
  });

  test.describe('PUT /api/v1/orders/:id/confirm', () => {
    test('confirms a created order', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const created = await api.post<Order>('/api/v1/orders', createOrderRequest());
      assertCreatedResponse(created);

      const res = await api.put<Order>(`/api/v1/orders/${created.data.id}/confirm`);
      assertSuccessResponse(res);
      expect(res.data.status).toBe('confirmed');
    });

    test('returns 404 for unknown id', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.put(`/api/v1/orders/${randomId()}/confirm`);
      assertErrorResponse(res, 404);
    });
  });

  test.describe('PUT /api/v1/orders/:id/cancel', () => {
    test('cancels a created order', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const created = await api.post<Order>('/api/v1/orders', createOrderRequest());
      assertCreatedResponse(created);

      const res = await api.put<Order>(`/api/v1/orders/${created.data.id}/cancel`);
      assertSuccessResponse(res);
      expect(res.data.status).toBe('cancelled');
    });

    test('returns 404 for unknown id', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.put(`/api/v1/orders/${randomId()}/cancel`);
      assertErrorResponse(res, 404);
    });
  });

  test.describe('DELETE /api/v1/orders/:id', () => {
    test('deletes an existing order and returns deleted:true', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const created = await api.post<Order>('/api/v1/orders', createOrderRequest());
      assertCreatedResponse(created);

      const res = await api.delete<{ id: string; deleted: boolean }>(`/api/v1/orders/${created.data.id}`);
      assertSuccessResponse(res);
      expect(res.data.id).toBe(created.data.id);
      expect(res.data.deleted).toBe(true);
    });

    test('deleted order is no longer retrievable', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const created = await api.post<Order>('/api/v1/orders', createOrderRequest());
      assertCreatedResponse(created);

      await api.delete(`/api/v1/orders/${created.data.id}`);

      const res = await api.get(`/api/v1/orders/${created.data.id}`);
      assertErrorResponse(res, 404);
    });

    test('returns 404 for unknown id', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.delete(`/api/v1/orders/${randomId()}`);
      assertErrorResponse(res, 404);
    });
  });
});
