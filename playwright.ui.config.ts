import { defineConfig } from '@playwright/test';

export default defineConfig({
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },

  webServer: [
    {
      command: 'node mock-server.js',
      port: 3000,
      reuseExistingServer: true,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev',
      cwd: './ui',
      port: 5173,
      reuseExistingServer: true,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    },
  ],

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'ui-smoke',
      testDir: './tests/ui',
    },
    {
      name: 'e2e-orders',
      testDir: './tests/e2e',
      testMatch: 'orders.e2e.spec.ts',
    },
    {
      name: 'e2e-payments',
      testDir: './tests/e2e',
      testMatch: 'payments.e2e.spec.ts',
    },
  ],

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-ui', open: 'never' }],
    ['json', { outputFile: 'test-results/ui-results.json' }],
  ],
});
