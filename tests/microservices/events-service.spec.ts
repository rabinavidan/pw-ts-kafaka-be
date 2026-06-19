import { test, expect } from '@playwright/test';
import { ApiHelper } from '../../src/helpers/api.helper';

const SVC = process.env.EVENTS_SERVICE_URL || 'http://localhost:3003';

test.describe('Events Service (port 3003) @microservice', () => {

  test.describe('Health & Readiness', () => {
    test('GET /health returns healthy with service name', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.get<{ status: string; service: string; dependencies: unknown[] }>('/health');

      expect(res.status).toBe(200);
      expect(res.data.status).toBe('healthy');
      expect(res.data.service).toBe('events-service');
      expect(Array.isArray(res.data.dependencies)).toBe(true);
    });

    test('GET /ready returns ready status', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.get<{ status: string }>('/ready');

      expect(res.status).toBe(200);
      expect(res.data.status).toBe('ready');
    });

    test('GET /health reports database dependency as up', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.get<{ dependencies: Array<{ name: string; status: string }> }>('/health');

      expect(res.status).toBe(200);
      const db = res.data.dependencies.find(d => d.name === 'database');
      expect(db).toBeDefined();
      expect(db!.status).toBe('up');
    });
  });

  test.describe('GET /api/v1/events', () => {
    test('returns list of events', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.get<{ events: unknown[] }>('/api/v1/events');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.data.events)).toBe(true);
    });

    test('supports limit query parameter', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.get<{ events: unknown[] }>('/api/v1/events', { limit: '5' });

      expect(res.status).toBe(200);
      expect(res.data.events.length).toBeLessThanOrEqual(5);
    });

    test('supports topic query parameter', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.get<{ events: Array<{ topic: string }> }>('/api/v1/events', { topic: 'orders' });

      expect(res.status).toBe(200);
      for (const event of res.data.events) {
        expect(event.topic).toBe('orders');
      }
    });
  });
});
