import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 60_000,
  expect: { timeout: 15_000 },

  webServer: {
    command: 'node mock-server.js',
    port: 3000,
    reuseExistingServer: true,
    stdout: 'pipe',
    stderr: 'pipe',
  },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ...(process.env.CI ? [['github'] as ['github']] : []),
  ],

  use: {
    baseURL: process.env.API_BASE_URL || 'http://localhost:3000',
    extraHTTPHeaders: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(process.env.API_KEY ? { 'X-API-Key': process.env.API_KEY } : {}),
    },
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'api',
      testDir: './tests/api',
      use: { baseURL: process.env.API_BASE_URL || 'http://localhost:3000' },
    },
    {
      name: 'kafka',
      testDir: './tests/kafka',
      timeout: 90_000,
      workers: 1,   // serialise Kafka tests to avoid rebalance timeouts with concurrent consumer groups
    },
    {
      name: 'integration',
      testDir: './tests/integration',
      timeout: 120_000,
      workers: 1,   // serialise to prevent partition rebalancing under concurrent load
    },
  ],

  outputDir: 'test-results',
});
