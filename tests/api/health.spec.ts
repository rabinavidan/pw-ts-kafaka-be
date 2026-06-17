import { test, expect } from '../../src/fixtures';
import { endpoints } from '../../src/config/api.config';
import { HealthResponse } from '../../src/models/api.model';
import { assertSuccessResponse, assertResponseTime } from '../../src/utils/assertion';

test.describe('Health & Readiness Checks @smoke', () => {
  test('GET /health returns healthy status', async ({ api }) => {
    const response = await api.get<HealthResponse>(endpoints.health);

    assertSuccessResponse(response);
    assertResponseTime(response, 2000);

    expect(response.data.status).toMatch(/^(healthy|degraded)$/);
    expect(response.data.version).toBeDefined();
    expect(response.data.uptime).toBeGreaterThan(0);
  });

  test('GET /health includes dependency statuses', async ({ api }) => {
    const response = await api.get<HealthResponse>(endpoints.health);

    assertSuccessResponse(response);
    expect(Array.isArray(response.data.dependencies)).toBe(true);

    for (const dep of response.data.dependencies) {
      expect(dep.name).toBeDefined();
      expect(dep.status).toMatch(/^(up|down|degraded)$/);
    }
  });

  test('GET /ready returns 200 when service is ready @smoke', async ({ api }) => {
    const response = await api.get(endpoints.readiness);
    assertSuccessResponse(response);
  });

  test('health endpoint responds within SLA @regression', async ({ api }) => {
    const iterations = 5;
    const durations: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const response = await api.get(endpoints.health);
      durations.push(response.duration);
    }

    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const p95 = durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.95)];

    expect(avg, `Average response time ${avg}ms exceeded 500ms`).toBeLessThan(500);
    expect(p95, `P95 response time ${p95}ms exceeded 1000ms`).toBeLessThan(1000);
  });
});
