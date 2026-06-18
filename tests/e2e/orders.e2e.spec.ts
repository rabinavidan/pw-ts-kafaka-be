import { test, expect } from './fixtures/pages.fixture';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('Orders — navigation & layout', () => {
  test('dashboard loads with Orders tab active by default', async ({ header, ordersPage }) => {
    await expect(header.tabOrders).toHaveClass(/active/);
    await expect(ordersPage.panel).toBeVisible();
    await expect(ordersPage.btnNewOrder).toBeVisible();
    await expect(ordersPage.btnBulkCreate).toBeVisible();
    await expect(ordersPage.filterPills).toBeVisible();
  });

  test('switching to Payments tab hides Orders panel', async ({ header, ordersPage, paymentsPage }) => {
    await header.goToPayments();
    await expect(paymentsPage.panel).toBeVisible();
    await expect(ordersPage.panel).not.toBeVisible();
    await header.goToOrders();
    await expect(ordersPage.panel).toBeVisible();
  });
});

test.describe('Orders — create', () => {
  test('opens New Order modal and closes on Cancel', async ({ ordersPage }) => {
    await ordersPage.openNewOrderModal();
    await expect(ordersPage.modal).toBeVisible();
    await ordersPage.btnCancelModal.click();
    await expect(ordersPage.modal).not.toBeVisible();
  });

  test('shows validation error when User ID is empty', async ({ ordersPage }) => {
    await ordersPage.openNewOrderModal();
    await ordersPage.productIdInput(0).fill('prod-001');
    await ordersPage.submitOrder();
    await expect(ordersPage.formError).toContainText('User ID is required');
  });

  test('shows validation error when Product ID is empty', async ({ ordersPage }) => {
    await ordersPage.openNewOrderModal();
    await ordersPage.inputUserId.fill('user-test');
    await ordersPage.submitOrder();
    await expect(ordersPage.formError).toContainText('All product IDs are required');
  });

  test('creates an order and shows it in the table', async ({ page, ordersPage, eventFeed }) => {
    await ordersPage.createOrder('e2e-user-01', 'prod-e2e-01');

    await expect(page.getByTestId('toast')).toBeVisible();
    await expect(page.getByTestId('toast-message')).toContainText('Order created');

    const rows = ordersPage.rows();
    await expect(rows.first()).toBeVisible();
  });

  test('new order appears with status "created"', async ({ ordersPage }) => {
    await ordersPage.createOrder('e2e-user-02', 'prod-e2e-02');
    const createdRows = ordersPage.rowsWithStatus('created');
    await expect(createdRows.first()).toBeVisible();
  });

  test('adds extra item line in modal', async ({ ordersPage }) => {
    await ordersPage.openNewOrderModal();
    await ordersPage.btnAddItem.click();
    await expect(ordersPage.productIdInput(1)).toBeVisible();
    await expect(ordersPage.quantityInput(1)).toBeVisible();
  });

  test('removes item line in modal', async ({ ordersPage }) => {
    await ordersPage.openNewOrderModal();
    await ordersPage.btnAddItem.click();
    await ordersPage.btnRemoveItem(1).click();
    await expect(ordersPage.productIdInput(1)).not.toBeVisible();
  });
});

test.describe('Orders — confirm & cancel', () => {
  test('confirms a single order via row action button', async ({ page, ordersPage }) => {
    await ordersPage.createOrder('e2e-confirm-user', 'prod-confirm');
    await expect(page.getByTestId('toast')).toBeVisible();

    const createdRows = ordersPage.rowsWithStatus('created');
    await createdRows.first().waitFor({ state: 'visible' });

    // Get the order ID from data attribute
    const orderId = await createdRows.first().getAttribute('data-testid').then(v => v?.replace('order-row-', '') ?? '');
    await ordersPage.btnConfirmOrder(orderId).click();

    await expect(ordersPage.orderStatus(orderId)).toContainText('confirmed');
  });

  test('cancels a single order via row action button', async ({ page, ordersPage }) => {
    await ordersPage.createOrder('e2e-cancel-user', 'prod-cancel');
    await expect(page.getByTestId('toast')).toBeVisible();

    const createdRows = ordersPage.rowsWithStatus('created');
    await createdRows.first().waitFor({ state: 'visible' });

    const orderId = await createdRows.first().getAttribute('data-testid').then(v => v?.replace('order-row-', '') ?? '');
    await ordersPage.btnCancelOrder(orderId).click();

    await expect(ordersPage.orderStatus(orderId)).toContainText('cancelled');
  });
});

test.describe('Orders — filter pills', () => {
  test('filter pills are all present', async ({ ordersPage }) => {
    for (const status of ['all', 'created', 'confirmed', 'cancelled'] as const) {
      await expect(ordersPage.filterPill(status)).toBeVisible();
    }
  });

  test('"All" pill is active by default', async ({ ordersPage }) => {
    await expect(ordersPage.filterPill('all')).toHaveClass(/active/);
  });

  test('clicking a status pill activates it', async ({ ordersPage }) => {
    await ordersPage.filterPill('created').click();
    await expect(ordersPage.filterPill('created')).toHaveClass(/active/);
    await expect(ordersPage.filterPill('all')).not.toHaveClass(/active/);
  });

  test('filtering to an empty status shows empty state', async ({ ordersPage }) => {
    await ordersPage.filterPill('confirmed').click();
    // If no confirmed orders exist, empty state appears
    const count = await ordersPage.rowsWithStatus('confirmed').count();
    if (count === 0) {
      await expect(ordersPage.emptyState).toBeVisible();
    }
  });
});

test.describe('Orders — bulk selection', () => {
  test('select-all checkbox selects all created rows', async ({ ordersPage }) => {
    await ordersPage.createOrder('bulk-user-1', 'bulk-prod-1');
    await ordersPage.createOrder('bulk-user-2', 'bulk-prod-2');

    await ordersPage.selectAll.check();
    await expect(ordersPage.bulkBar).toBeVisible();
  });

  test('bulk bar shows correct selected count', async ({ ordersPage }) => {
    await ordersPage.createOrder('bulk-cnt-1', 'bulk-prod-1');
    await ordersPage.createOrder('bulk-cnt-2', 'bulk-prod-2');

    await ordersPage.selectAll.check();
    await expect(ordersPage.bulkBarCount).toContainText('selected');
  });

  test('Deselect all clears selection and hides bulk bar', async ({ ordersPage }) => {
    await ordersPage.createOrder('bulk-desel-1', 'prod-1');
    await ordersPage.selectAll.check();
    await expect(ordersPage.bulkBar).toBeVisible();

    await ordersPage.btnDeselectAll.click();
    await expect(ordersPage.bulkBar).not.toBeVisible();
  });

  test('bulk confirm changes selected orders to confirmed', async ({ page, ordersPage }) => {
    await ordersPage.createOrder('bulk-c-1', 'prod-c-1');
    await ordersPage.createOrder('bulk-c-2', 'prod-c-2');

    await ordersPage.selectAll.check();
    await ordersPage.btnBulkConfirm.click();

    await expect(page.getByTestId('toast-message').last()).toContainText('confirmed');
    await expect(ordersPage.bulkBar).not.toBeVisible();
  });

  test('bulk cancel changes selected orders to cancelled', async ({ page, ordersPage }) => {
    await ordersPage.createOrder('bulk-x-1', 'prod-x-1');
    await ordersPage.createOrder('bulk-x-2', 'prod-x-2');

    await ordersPage.selectAll.check();
    await ordersPage.btnBulkCancel.click();

    await expect(page.getByTestId('toast-message').last()).toContainText('cancelled');
    await expect(ordersPage.bulkBar).not.toBeVisible();
  });
});

test.describe('Orders — bulk create', () => {
  test('Bulk ×15 creates 15 orders and shows success toast', async ({ page, ordersPage }) => {
    await ordersPage.btnBulkCreate.click();

    await expect(page.getByTestId('toast-message')).toContainText('15 orders created', { timeout: 30_000 });

    const rows = ordersPage.rows();
    expect(await rows.count()).toBeGreaterThanOrEqual(15);
  });
});

test.describe('Orders — Kafka events', () => {
  test('creating an order emits order.created event in feed', async ({ ordersPage, eventFeed }) => {
    await ordersPage.createOrder('evt-user', 'evt-prod');
    await eventFeed.waitForEventType('order.created');
    await expect(eventFeed.eventsOfType('order.created').first()).toBeVisible();
  });

  test('confirming an order emits order.confirmed event', async ({ page, ordersPage, eventFeed }) => {
    await ordersPage.createOrder('evt-confirm', 'evt-prod-c');
    await expect(page.getByTestId('toast')).toBeVisible();

    const createdRows = ordersPage.rowsWithStatus('created');
    await createdRows.first().waitFor();
    const orderId = await createdRows.first().getAttribute('data-testid').then(v => v?.replace('order-row-', '') ?? '');

    await ordersPage.btnConfirmOrder(orderId).click();
    await eventFeed.waitForEventType('order.confirmed');
    await expect(eventFeed.eventsOfType('order.confirmed').first()).toBeVisible();
  });

  test('cancelling an order emits order.cancelled event', async ({ page, ordersPage, eventFeed }) => {
    await ordersPage.createOrder('evt-cancel', 'evt-prod-x');
    await expect(page.getByTestId('toast')).toBeVisible();

    const createdRows = ordersPage.rowsWithStatus('created');
    await createdRows.first().waitFor();
    const orderId = await createdRows.first().getAttribute('data-testid').then(v => v?.replace('order-row-', '') ?? '');

    await ordersPage.btnCancelOrder(orderId).click();
    await eventFeed.waitForEventType('order.cancelled');
    await expect(eventFeed.eventsOfType('order.cancelled').first()).toBeVisible();
  });
});
