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
    port: parseInt(process.env.PORT || '3001'),
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
      name: 'microservices',
      testDir: './tests/microservices',
      // Targets each service directly on its own port — requires `npm run dev:services` to be running
      // 190s to comfortably exceed KafkaHelper.consume()'s worst-case internal budget
      // (20s caller timeout + 120s rebalance buffer = 140s) with margin to spare.
      timeout: 190_000,
      retries: 2,   // retry on rebalancing-induced timeouts under parallel project load
      workers: 1,   // serialise — idempotency/DLQ/contract/tracing tests each spin up their
                     // own throwaway Kafka consumer group; running them in parallel triggers
                     // the same rebalance timeouts the kafka/integration projects avoid this way
    },
    {
      name: 'kafka',
      testDir: './tests/kafka',
      // 190s: worst-case caller timeoutMs here is 30s, + KafkaHelper.consume()'s 120s buffer = 150s.
      timeout: 190_000,
      retries: 2,   // retry on rebalancing-induced timeouts under parallel project load
      workers: 1,   // serialise Kafka tests to avoid rebalance timeouts with concurrent consumer groups
    },
    {
      name: 'integration',
      testDir: './tests/integration',
      // 190s: worst-case caller timeoutMs here is 30s, + KafkaHelper.consume()'s 120s buffer = 150s.
      timeout: 190_000,
      retries: 2,   // retry on rebalancing-induced timeouts under parallel project load
      workers: 1,   // serialise to prevent partition rebalancing under concurrent load
    },
    {
      name: 'db',
      testDir: './tests/db',
      use: { baseURL: process.env.API_BASE_URL || 'http://localhost:3001' },
    },
  ],

  outputDir: 'test-results',
});
