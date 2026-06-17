import dotenv from 'dotenv';

dotenv.config();

export const apiConfig = {
  baseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
  apiKey: process.env.API_KEY || '',
  timeout: Number(process.env.TEST_TIMEOUT) || 30000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
};

export const endpoints = {
  health: '/health',
  readiness: '/ready',
  orders: '/api/v1/orders',
  payments: '/api/v1/payments',
  users: '/api/v1/users',
  events: '/api/v1/events',
  metrics: '/metrics',
} as const;

export type Endpoint = (typeof endpoints)[keyof typeof endpoints];
