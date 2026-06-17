import { expect } from '@playwright/test';
import { ApiResponse } from '../models/api.model';
import { ConsumedMessage } from '../models/kafka.model';

export function assertSuccessResponse<T>(response: ApiResponse<T>, expectedStatus = 200): void {
  expect(response.status, `Expected status ${expectedStatus}`).toBe(expectedStatus);
  expect(response.data).toBeDefined();
}

export function assertCreatedResponse<T>(response: ApiResponse<T>): void {
  expect(response.status, 'Expected 201 Created').toBe(201);
  expect(response.data).toBeDefined();
}

export function assertErrorResponse(response: ApiResponse, expectedStatus: number): void {
  expect(response.status, `Expected error status ${expectedStatus}`).toBe(expectedStatus);
}

export function assertResponseTime(response: ApiResponse, maxMs: number): void {
  expect(response.duration, `Response time ${response.duration}ms exceeded ${maxMs}ms`).toBeLessThan(maxMs);
}

export function assertKafkaMessage<T>(message: ConsumedMessage<T>, expected: Partial<Record<string, unknown>>): void {
  expect(message.value).toBeDefined();
  const valueAsRecord = message.value as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected)) {
    expect(valueAsRecord[key], `Kafka message field "${key}"`).toEqual(value);
  }
}

export function assertMessageReceived<T>(messages: ConsumedMessage<T>[], minCount = 1): void {
  expect(messages.length, `Expected at least ${minCount} message(s)`).toBeGreaterThanOrEqual(minCount);
}
