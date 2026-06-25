import { test as base, APIRequestContext } from '@playwright/test';
import { KafkaHelper } from '../helpers/kafka.helper';
import { ApiHelper } from '../helpers/api.helper';
import { DbHelper } from '../helpers/db.helper';
import { logger } from '../utils/logger';

interface TestFixtures {
  kafka: KafkaHelper;
  api: ApiHelper;
  db: DbHelper;
}

export const test = base.extend<TestFixtures>({
  // eslint-disable-next-line no-empty-pattern
  kafka: async ({}: object, use) => {
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

  // eslint-disable-next-line no-empty-pattern
  db: async ({}: object, use) => {
    const dbHelper = new DbHelper();
    await dbHelper.connect();
    logger.info('DB fixture: connected');

    await use(dbHelper);

    await dbHelper.disconnect();
    logger.info('DB fixture: disconnected');
  },
});

export { expect } from '@playwright/test';
