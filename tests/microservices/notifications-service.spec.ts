import { test, expect } from '@playwright/test';
import { ApiHelper } from '../../src/helpers/api.helper';

const SVC = process.env.NOTIFICATIONS_SERVICE_URL || 'http://localhost:3004';

test.describe('Notifications Service (port 3004) @microservice', () => {

  test.describe('Health & Readiness', () => {
    test('GET /health returns healthy with service name', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.get<{ status: string; service: string }>('/health');

      expect(res.status).toBe(200);
      expect(res.data.status).toBe('healthy');
      expect(res.data.service).toBe('notification-service');
    });

    test('GET /health includes uptime', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.get<{ uptime: number }>('/health');

      expect(res.status).toBe(200);
      expect(typeof res.data.uptime).toBe('number');
      expect(res.data.uptime).toBeGreaterThanOrEqual(0);
    });

    test('GET /ready returns 200', async ({ request }) => {
      const api = new ApiHelper(request, SVC);
      const res = await api.get<{ status: string }>('/ready');

      // notifications service exposes health body on /ready (K8s liveness probe target)
      expect(res.status).toBe(200);
      expect(res.data.status).toBe('healthy');
    });
  });
});
