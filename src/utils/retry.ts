import { logger } from './logger';

export interface RetryOptions {
  attempts?: number;
  delay?: number;
  backoff?: number;
  onRetry?: (error: Error, attempt: number) => void;
}

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 3, delay = 1000, backoff = 2, onRetry } = options;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === attempts) throw error;

      const waitMs = delay * Math.pow(backoff, attempt - 1);
      const err = error instanceof Error ? error : new Error(String(error));

      logger.warn(`Attempt ${attempt}/${attempts} failed: ${err.message}. Retrying in ${waitMs}ms`);
      onRetry?.(err, attempt);

      await sleep(waitMs);
    }
  }

  throw new Error('Retry exhausted without throwing');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitUntil(
  condition: () => Promise<boolean>,
  timeoutMs = 30000,
  intervalMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) return;
    await sleep(intervalMs);
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
}
