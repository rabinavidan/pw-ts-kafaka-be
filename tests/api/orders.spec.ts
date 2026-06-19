import { test, expect } from '../../src/fixtures';
import { endpoints } from '../../src/config/api.config';
import { Order, PaginatedResponse } from '../../src/models/api.model';
import { createOrderRequest, randomId } from '../../src/utils/data.factory';
import {
  assertSuccessResponse,
  assertCreatedResponse,
  assertErrorResponse,
  assertResponseTime,
} from '../../src/utils/assertion';

test.describe('Orders API @regression', () => {
  test('POST /orders creates a new order', async ({ api }) => {
    const payload = createOrderRequest();
    const response = await api.post<Order>(endpoints.orders, payload);

    assertCreatedResponse(response);
    assertResponseTime(response, 3000);

    expect(response.data.id).toBeDefined();
    expect(response.data.userId).toBe(payload.userId);
    expect(response.data.status).toBe('created');
    expect(response.data.currency).toBe(payload.currency);
  });

  test('GET /orders returns paginated list', async ({ api }) => {
    const response = await api.get<PaginatedResponse<Order>>(endpoints.orders, {
      page: '1',
      pageSize: '10',
    });

    assertSuccessResponse(response);
    expect(Array.isArray(response.data.items)).toBe(true);
    expect(response.data.total).toBeGreaterThanOrEqual(0);
    expect(response.data.page).toBe(1);
    expect(response.data.pageSize).toBe(10);
  });

  test('GET /orders/:id returns order by id', async ({ api }) => {
    const created = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(created);

    const fetched = await api.get<Order>(`${endpoints.orders}/${created.data.id}`);
    assertSuccessResponse(fetched);
    expect(fetched.data.id).toBe(created.data.id);
  });

  test('GET /orders/:id returns 404 for non-existent order', async ({ api }) => {
    const response = await api.get(`${endpoints.orders}/${randomId()}`);
    assertErrorResponse(response, 404);
  });

  test('PUT /orders/:id/cancel cancels an order', async ({ api }) => {
    const created = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(created);

    const cancelled = await api.put<Order>(`${endpoints.orders}/${created.data.id}/cancel`);
    assertSuccessResponse(cancelled);
    expect(cancelled.data.status).toBe('cancelled');
  });

  test('POST /orders returns 422 for invalid payload', async ({ api }) => {
    const response = await api.post(endpoints.orders, { userId: '' });
    assertErrorResponse(response, 422);
  });

  test('POST /orders returns 422 when items are empty', async ({ api }) => {
    const response = await api.post(endpoints.orders, createOrderRequest({ items: [] }));
    assertErrorResponse(response, 422);
  });

  test('orders list supports filtering by status', async ({ api }) => {
    const response = await api.get<PaginatedResponse<Order>>(endpoints.orders, { status: 'created' });

    assertSuccessResponse(response);
    for (const order of response.data.items) {
      expect(order.status).toBe('created');
    }
  });

  test('DELETE /orders/:id deletes an existing order', async ({ api }) => {
    const created = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(created);

    const deleted = await api.delete<{ id: string; deleted: boolean }>(`${endpoints.orders}/${created.data.id}`);
    assertSuccessResponse(deleted);
    expect(deleted.data.id).toBe(created.data.id);
    expect(deleted.data.deleted).toBe(true);
  });

  test('DELETE /orders/:id returns 404 for non-existent order', async ({ api }) => {
    const response = await api.delete(`${endpoints.orders}/${randomId()}`);
    assertErrorResponse(response, 404);
  });

  test('DELETE /orders/:id removed order no longer accessible via GET', async ({ api }) => {
    const created = await api.post<Order>(endpoints.orders, createOrderRequest());
    assertCreatedResponse(created);

    await api.delete(`${endpoints.orders}/${created.data.id}`);

    const fetched = await api.get(`${endpoints.orders}/${created.data.id}`);
    assertErrorResponse(fetched, 404);
  });
});
