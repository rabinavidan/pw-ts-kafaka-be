import { test as base } from '@playwright/test';
import { HeaderPage }   from '../pages/HeaderPage';
import { OrdersPage }   from '../pages/OrdersPage';
import { PaymentsPage } from '../pages/PaymentsPage';
import { EventFeedPage } from '../pages/EventFeedPage';

type PageFixtures = {
  header:     HeaderPage;
  ordersPage: OrdersPage;
  paymentsPage: PaymentsPage;
  eventFeed:  EventFeedPage;
};

export const test = base.extend<PageFixtures>({
  header: async ({ page }, use) => {
    await use(new HeaderPage(page));
  },
  ordersPage: async ({ page }, use) => {
    await use(new OrdersPage(page));
  },
  paymentsPage: async ({ page }, use) => {
    await use(new PaymentsPage(page));
  },
  eventFeed: async ({ page }, use) => {
    await use(new EventFeedPage(page));
  },
});

export { expect } from '@playwright/test';
