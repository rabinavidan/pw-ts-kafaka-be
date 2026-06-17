import dotenv from 'dotenv';
import { KafkaConfig, SASLOptions } from 'kafkajs';

dotenv.config();

function buildSasl(): SASLOptions | undefined {
  const mechanism = process.env.KAFKA_SASL_MECHANISM;
  const username = process.env.KAFKA_SASL_USERNAME;
  const password = process.env.KAFKA_SASL_PASSWORD;
  if (!mechanism || !username || !password) return undefined;
  if (mechanism !== 'plain' && mechanism !== 'scram-sha-256' && mechanism !== 'scram-sha-512') {
    throw new Error(`Unsupported SASL mechanism: ${mechanism}`);
  }
  return { mechanism, username, password } as SASLOptions;
}

export const kafkaConfig: KafkaConfig = {
  clientId: process.env.KAFKA_CLIENT_ID || 'playwright-test-client',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',').map((b) => b.trim()),
  connectionTimeout: Number(process.env.KAFKA_CONNECTION_TIMEOUT) || 3000,
  requestTimeout: Number(process.env.KAFKA_REQUEST_TIMEOUT) || 30000,
  ssl: process.env.KAFKA_SSL === 'true',
  sasl: buildSasl(),
  retry: {
    initialRetryTime: 300,
    retries: 5,
  },
};

export const kafkaTopics = {
  orders: process.env.KAFKA_TOPIC_ORDERS || 'orders',
  payments: process.env.KAFKA_TOPIC_PAYMENTS || 'payments',
  notifications: process.env.KAFKA_TOPIC_NOTIFICATIONS || 'notifications',
  deadLetter: process.env.KAFKA_TOPIC_DLQ || 'dead-letter-queue',
  audit: process.env.KAFKA_TOPIC_AUDIT || 'audit-events',
} as const;

export const consumerConfig = {
  groupId: process.env.KAFKA_GROUP_ID || 'playwright-test-group',
  sessionTimeout: 30000,
  heartbeatInterval: 3000,
  maxWaitTimeInMs: 5000,
};
