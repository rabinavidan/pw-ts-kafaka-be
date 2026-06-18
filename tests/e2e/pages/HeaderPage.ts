import type { Page, Locator } from '@playwright/test';

export class HeaderPage {
  readonly nav:          Locator;
  readonly tabOrders:    Locator;
  readonly tabPayments:  Locator;
  readonly healthStatus: Locator;
  readonly versionTag:   Locator;

  constructor(private page: Page) {
    this.nav          = page.getByTestId('header-nav');
    this.tabOrders    = page.getByTestId('nav-tab-orders');
    this.tabPayments  = page.getByTestId('nav-tab-payments');
    this.healthStatus = page.getByTestId('health-status');
    this.versionTag   = page.getByTestId('version-tag');
  }

  async goToOrders()   { await this.tabOrders.click(); }
  async goToPayments() { await this.tabPayments.click(); }

  async waitForHealthy() {
    await this.healthStatus.waitFor({ state: 'visible' });
    await this.page.waitForFunction(
      () => document.querySelector('[data-testid="health-status"]')?.getAttribute('data-health') === 'healthy',
      { timeout: 10_000 },
    );
  }
}
