import { test as base, APIRequestContext } from '@playwright/test';
import { KafkaHelper } from '../helpers/kafka.helper';
import { ApiHelper } from '../helpers/api.helper';
import { logger } from '../utils/logger';

interface TestFixtures {
  kafka: KafkaHelper;
  api: ApiHelper;
}

export const test = base.extend<TestFixtures>({
  kafka: async ({}, use) => {
    const kafkaHelper = new KafkaHelper();
    await kafkaHelper.connect();
    logger.info('Kafka fixture: connected');

    await use(kafkaHelper);

    await kafkaHelper.disconnect();
    logger.info('Kafka fixture: disconnected');
  },

  api: async ({ request }: { request: APIRequestContext }, use: (api: ApiHelper) => Promise<void>) => {
    const apiHelper = new ApiHelper(request);
    await use(apiHelper);
  },
});

export { expect } from '@playwright/test';
