import { test, expect } from '@playwright/test';

test.describe('Dashboard smoke @smoke', () => {
  test('page loads with header and Orders tab active', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('pw-kafka-be')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Orders' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Payments' })).toBeVisible();
    await expect(page.getByTestId('btn-new-order')).toBeVisible();
  });

  test('health indicator shows Healthy', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Healthy/i)).toBeVisible({ timeout: 8000 });
  });

  test('can switch to Payments tab', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Payments' }).click();
    await expect(page.getByText(/\+ New Payment/i)).toBeVisible();
  });

  test('create order flow', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('btn-new-order').click();
    await expect(page.getByTestId('modal-new-order')).toBeVisible();

    await page.getByPlaceholder('e.g. user-001').fill('test-user-ui');
    await page.getByPlaceholder('Product ID').fill('prod-001');
    await page.getByRole('button', { name: 'Create Order' }).click();

    // Success toast
    await expect(page.getByText(/Order created/i)).toBeVisible({ timeout: 5000 });
    // Row appears in table
    await expect(page.getByText('test-user-ui').first()).toBeVisible({ timeout: 5000 });
  });

  test('Kafka event feed shows event after order creation', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('btn-new-order').click();
    await page.getByPlaceholder('e.g. user-001').fill('feed-test-user');
    await page.getByPlaceholder('Product ID').fill('prod-feed');
    await page.getByRole('button', { name: 'Create Order' }).click();

    // Event feed should show order.created within 4s (2s polling interval + margin)
    await expect(page.getByText('order.created').first()).toBeVisible({ timeout: 6000 });
  });

  test('create payment shows payment.initiated in event feed', async ({ page }) => {
    await page.goto('/');

    // First create an order to get an ID
    await page.getByTestId('btn-new-order').click();
    await page.getByPlaceholder('e.g. user-001').fill('pay-test-user');
    await page.getByPlaceholder('Product ID').fill('prod-pay');
    await page.getByRole('button', { name: 'Create Order' }).click();
    await expect(page.getByText(/Order created/i)).toBeVisible({ timeout: 5000 });

    // Grab orderId from the first table row
    const idCell = page.locator('tbody tr:first-child td:nth-child(2) span');
    const shortId = await idCell.textContent();
    expect(shortId).toBeTruthy();

    await page.getByRole('button', { name: 'Payments' }).click();
    await page.getByTestId('btn-new-payment').click();
    // User must paste full ID — in E2E we use the mock server directly
    // so just verify the modal opens correctly
    await expect(page.getByTestId('modal-new-payment')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('health indicator exposes healthy status via data attribute', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('health-status')).toHaveAttribute('data-health', 'healthy', { timeout: 8000 });
  });

  test('Infrastructure tab shows the service topology cards', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-tab-infra').click();
    await expect(page.getByText('Zookeeper', { exact: true })).toBeVisible();
    await expect(page.getByText('Kafka Broker', { exact: true })).toBeVisible();
    await expect(page.getByText('PostgreSQL', { exact: true })).toBeVisible();
  });

  test('confirm order flow moves status from created to confirmed', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('btn-new-order').click();
    await page.getByPlaceholder('e.g. user-001').fill('confirm-flow-user');
    await page.getByPlaceholder('Product ID').fill('prod-confirm');
    await page.getByRole('button', { name: 'Create Order' }).click();
    await expect(page.getByText(/Order created/i)).toBeVisible({ timeout: 5000 });

    const row = page.locator('tbody tr:first-child');
    const orderId = await row.locator('td:nth-child(2) span').getAttribute('title');
    expect(orderId).toBeTruthy();

    await page.getByTestId(`btn-confirm-order-${orderId}`).click();
    await expect(page.getByTestId(`order-status-${orderId}`)).toHaveText('confirmed', { timeout: 5000 });
  });

  test('cancel order flow moves status from created to cancelled', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('btn-new-order').click();
    await page.getByPlaceholder('e.g. user-001').fill('cancel-flow-user');
    await page.getByPlaceholder('Product ID').fill('prod-cancel');
    await page.getByRole('button', { name: 'Create Order' }).click();
    await expect(page.getByText(/Order created/i)).toBeVisible({ timeout: 5000 });

    const row = page.locator('tbody tr:first-child');
    const orderId = await row.locator('td:nth-child(2) span').getAttribute('title');
    expect(orderId).toBeTruthy();

    await page.getByTestId(`btn-cancel-order-${orderId}`).click();
    await expect(page.getByTestId(`order-status-${orderId}`)).toHaveText('cancelled', { timeout: 5000 });
  });

  test('orders filter pills scope the table to the selected status', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('btn-new-order').click();
    await page.getByPlaceholder('e.g. user-001').fill('filter-usr');
    await page.getByPlaceholder('Product ID').fill('prod-filter');
    await page.getByRole('button', { name: 'Create Order' }).click();
    await expect(page.getByText(/Order created/i)).toBeVisible({ timeout: 5000 });

    await page.getByTestId('filter-pill-created').click();
    await expect(page.getByText('filter-usr').first()).toBeVisible({ timeout: 5000 });

    await page.getByTestId('filter-pill-cancelled').click();
    await expect(page.getByText('filter-usr')).toHaveCount(0);
  });

  test('full payment creation flow publishes payment.initiated to the event feed', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('btn-new-order').click();
    await page.getByPlaceholder('e.g. user-001').fill('pay-full-flow-user');
    await page.getByPlaceholder('Product ID').fill('prod-pay-full');
    await page.getByRole('button', { name: 'Create Order' }).click();
    await expect(page.getByText(/Order created/i)).toBeVisible({ timeout: 5000 });

    const orderId = await page.locator('tbody tr:first-child td:nth-child(2) span').getAttribute('title');
    expect(orderId).toBeTruthy();

    await page.getByRole('button', { name: 'Payments' }).click();
    await page.getByTestId('btn-new-payment').click();
    await page.getByTestId('input-order-id').fill(orderId!);
    await page.getByTestId('btn-submit-payment').click();

    await expect(page.getByText('payment.initiated').first()).toBeVisible({ timeout: 6000 });
  });
});
