import type { Page, Locator } from '@playwright/test';

export class EventFeedPage {
  readonly sidebar:   Locator;
  readonly feedList:  Locator;
  readonly feedEmpty: Locator;
  readonly eventCount: Locator;

  constructor(private page: Page) {
    this.sidebar    = page.getByTestId('event-sidebar');
    this.feedList   = page.getByTestId('event-feed-list');
    this.feedEmpty  = page.getByTestId('event-feed-empty');
    this.eventCount = page.getByTestId('event-count');
  }

  eventItem(id: string) { return this.page.getByTestId(`event-item-${id}`); }

  events() {
    return this.page.locator('[data-testid^="event-item-"]');
  }

  eventsOfType(eventType: string) {
    return this.page.locator(`[data-event-type="${eventType}"]`);
  }

  async waitForEventType(eventType: string, timeout = 10_000) {
    await this.page.waitForSelector(`[data-event-type="${eventType}"]`, { timeout });
  }

  async waitForEventCount(min: number, timeout = 10_000) {
    await this.page.waitForFunction(
      (n) => document.querySelectorAll('[data-testid^="event-item-"]').length >= n,
      min,
      { timeout },
    );
  }
}
