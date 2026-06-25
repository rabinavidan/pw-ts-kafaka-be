import { test, expect } from './fixtures/pages.fixture';

test.beforeEach(async ({ page, header }) => {
  await page.goto('/');
  await header.goToPayments();
});

test.describe('Payments — layout', () => {
  test('Payments panel is visible after tab switch', async ({ paymentsPage }) => {
    await expect.soft(paymentsPage.panel).toBeVisible();
    await expect.soft(paymentsPage.btnNewPayment).toBeVisible();
    await expect.soft(paymentsPage.btnBulkCreate).toBeVisible();
    await expect.soft(paymentsPage.filterPills).toBeVisible();
  });

  test('empty state is shown when no payments exist', async ({ paymentsPage }) => {
    await expect(paymentsPage.emptyState).toBeVisible();
  });
});

test.describe('Payments — create', () => {
  test('opens New Payment modal and closes on Cancel', async ({ paymentsPage }) => {
    await paymentsPage.openNewPaymentModal();
    await expect(paymentsPage.modal).toBeVisible();
    await paymentsPage.btnCancelModal.click();
    await expect(paymentsPage.modal).not.toBeVisible();
  });

  test('shows validation error when Order ID is empty', async ({ paymentsPage }) => {
    await paymentsPage.openNewPaymentModal();
    await paymentsPage.submitPayment();
    await expect(paymentsPage.formError).toContainText('Order ID is required');
  });

  test('creates a payment and shows it in the table', async ({ paymentsPage }) => {
    await paymentsPage.createPayment(crypto.randomUUID());

    await expect(paymentsPage.toast).toBeVisible();
    await expect(paymentsPage.toastMessage).toContainText('payment.initiated');

    await expect(paymentsPage.table).toBeVisible();
    expect(await paymentsPage.rows().count()).toBeGreaterThanOrEqual(1);
  });

  test('new payment appears with status "pending"', async ({ paymentsPage }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    const pendingRows = paymentsPage.rowsWithStatus('pending');
    await expect(pendingRows.first()).toBeVisible();
  });

  test('a payment can be moved to "failed" status', async ({ paymentsPage }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    const pendingRows = paymentsPage.rowsWithStatus('pending');
    await pendingRows.first().waitFor();
    const paymentId = await pendingRows.first().getAttribute('data-testid').then(v => v?.replace('payment-row-', '') ?? '');

    await paymentsPage.paymentRowCb(paymentId).check();
    await paymentsPage.btnBulkFail.click();

    await expect(paymentsPage.toastMessage.last()).toContainText('failed');
    await expect(paymentsPage.rowsWithStatus('failed').first()).toBeVisible();
  });

  test('modal close button dismisses without creating', async ({ paymentsPage }) => {
    await paymentsPage.openNewPaymentModal();
    await paymentsPage.inputOrderId.fill(crypto.randomUUID());
    await paymentsPage.modalClose.click();
    await expect(paymentsPage.modal).not.toBeVisible();
    await expect(paymentsPage.emptyState).toBeVisible();
  });
});

test.describe('Payments — process & refund & fail (single)', () => {
  test('processing a pending payment changes status to processed', async ({ paymentsPage }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    await expect(paymentsPage.toast).toBeVisible();

    const pendingRows = paymentsPage.rowsWithStatus('pending');
    await pendingRows.first().waitFor();
    const paymentId = await pendingRows.first().getAttribute('data-testid').then(v => v?.replace('payment-row-', '') ?? '');

    // Select and process via bulk bar (single row)
    await paymentsPage.paymentRowCb(paymentId).check();
    await paymentsPage.btnBulkProcess.click();

    await expect(paymentsPage.toastMessage.last()).toContainText('processed');
    await expect(paymentsPage.paymentStatus(paymentId)).toContainText('processed');
  });

  test('refunding a pending payment changes status to refunded', async ({ paymentsPage }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    await expect(paymentsPage.toast).toBeVisible();

    const pendingRows = paymentsPage.rowsWithStatus('pending');
    await pendingRows.first().waitFor();
    const paymentId = await pendingRows.first().getAttribute('data-testid').then(v => v?.replace('payment-row-', '') ?? '');

    await paymentsPage.paymentRowCb(paymentId).check();
    await paymentsPage.btnBulkRefund.click();

    await expect(paymentsPage.toastMessage.last()).toContainText('refunded');
    await expect(paymentsPage.paymentStatus(paymentId)).toContainText('refunded');
  });

  test('failing a pending payment changes status to failed', async ({ paymentsPage }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    await expect(paymentsPage.toast).toBeVisible();

    const pendingRows = paymentsPage.rowsWithStatus('pending');
    await pendingRows.first().waitFor();
    const paymentId = await pendingRows.first().getAttribute('data-testid').then(v => v?.replace('payment-row-', '') ?? '');

    await paymentsPage.paymentRowCb(paymentId).check();
    await paymentsPage.btnBulkFail.click();

    await expect(paymentsPage.toastMessage.last()).toContainText('failed');
    await expect(paymentsPage.paymentStatus(paymentId)).toContainText('failed');
  });
});

test.describe('Payments — filter pills', () => {
  test('all filter pills are present', async ({ paymentsPage }) => {
    for (const status of ['all', 'pending', 'processed', 'refunded', 'failed'] as const) {
      await expect(paymentsPage.filterPill(status)).toBeVisible();
    }
  });

  test('"All" pill is active by default', async ({ paymentsPage }) => {
    await expect(paymentsPage.filterPill('all')).toHaveClass(/active/);
  });

  test('clicking a status pill activates it and deactivates All', async ({ paymentsPage }) => {
    await paymentsPage.filterPill('pending').click();
    await expect(paymentsPage.filterPill('pending')).toHaveClass(/active/);
    await expect(paymentsPage.filterPill('all')).not.toHaveClass(/active/);
  });

  test('switching filter clears row selection', async ({ paymentsPage }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    const pendingRows = paymentsPage.rowsWithStatus('pending');
    await pendingRows.first().waitFor();
    const paymentId = await pendingRows.first().getAttribute('data-testid').then(v => v?.replace('payment-row-', '') ?? '');

    await paymentsPage.paymentRowCb(paymentId).check();
    await expect(paymentsPage.bulkBar).toBeVisible();

    await paymentsPage.filterPill('failed').click();
    await expect(paymentsPage.bulkBar).not.toBeVisible();
  });

  test('filter to a status with no payments shows filter empty state', async ({ paymentsPage }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    await paymentsPage.filterPill('refunded').click();
    await expect(paymentsPage.filterEmpty).toBeVisible();
  });

  test('processed pill shows only processed payments', async ({ paymentsPage }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    await expect(paymentsPage.toast).toBeVisible();

    const pendingRows = paymentsPage.rowsWithStatus('pending');
    await pendingRows.first().waitFor();
    const paymentId = await pendingRows.first().getAttribute('data-testid').then(v => v?.replace('payment-row-', '') ?? '');

    await paymentsPage.paymentRowCb(paymentId).check();
    await paymentsPage.btnBulkProcess.click();
    await expect(paymentsPage.toast).toBeVisible();

    await paymentsPage.filterPill('processed').click();
    await expect(paymentsPage.rowsWithStatus('processed').first()).toBeVisible();
  });
});

test.describe('Payments — bulk selection', () => {
  test('select-all selects all pending rows', async ({ paymentsPage }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    await paymentsPage.createPayment(crypto.randomUUID());

    await paymentsPage.selectAll.check();
    await expect(paymentsPage.bulkBar).toBeVisible();
  });

  test('Deselect all hides bulk bar', async ({ paymentsPage }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    await paymentsPage.selectAll.check();
    await expect(paymentsPage.bulkBar).toBeVisible();

    await paymentsPage.btnDeselectAll.click();
    await expect(paymentsPage.bulkBar).not.toBeVisible();
  });

  test('bulk process moves all selected pending → processed', async ({ paymentsPage }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    await paymentsPage.createPayment(crypto.randomUUID());

    await paymentsPage.selectAll.check();
    await paymentsPage.btnBulkProcess.click();

    await expect(paymentsPage.toastMessage.last()).toContainText('processed');
  });

  test('bulk refund moves all selected pending → refunded', async ({ paymentsPage }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    await paymentsPage.createPayment(crypto.randomUUID());

    await paymentsPage.selectAll.check();
    await paymentsPage.btnBulkRefund.click();

    await expect(paymentsPage.toastMessage.last()).toContainText('refunded');
  });

  test('bulk fail moves all selected pending → failed', async ({ paymentsPage }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    await paymentsPage.createPayment(crypto.randomUUID());

    await paymentsPage.selectAll.check();
    await paymentsPage.btnBulkFail.click();

    await expect(paymentsPage.toastMessage.last()).toContainText('failed');
  });
});

test.describe('Payments — bulk create', () => {
  test('Bulk ×10 creates 10 payments and shows success toast', async ({ paymentsPage }) => {
    await paymentsPage.btnBulkCreate.click();

    await expect(paymentsPage.toastMessage).toContainText('10 payments created', { timeout: 30_000 });

    expect(await paymentsPage.rows().count()).toBeGreaterThanOrEqual(10);
  });
});

test.describe('Payments — delete', () => {
  test('single delete removes payment row from table', async ({ paymentsPage }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    await expect(paymentsPage.toast).toBeVisible();

    const rows = paymentsPage.rows();
    await rows.first().waitFor({ state: 'visible' });
    const paymentId = await rows.first().getAttribute('data-testid').then(v => v?.replace('payment-row-', '') ?? '');

    await paymentsPage.btnDeletePayment(paymentId).click();

    await expect(paymentsPage.toastMessage.last()).toContainText('deleted');
    await expect(paymentsPage.paymentRow(paymentId)).not.toBeVisible();
  });

  test('single delete works on processed payment', async ({ paymentsPage }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    await expect(paymentsPage.toast).toBeVisible();

    const pendingRows = paymentsPage.rowsWithStatus('pending');
    await pendingRows.first().waitFor();
    const paymentId = await pendingRows.first().getAttribute('data-testid').then(v => v?.replace('payment-row-', '') ?? '');

    await paymentsPage.paymentRowCb(paymentId).check();
    await paymentsPage.btnBulkProcess.click();
    await expect(paymentsPage.paymentStatus(paymentId)).toContainText('processed');

    await paymentsPage.btnDeletePayment(paymentId).click();

    await expect(paymentsPage.toastMessage.last()).toContainText('deleted');
    await expect(paymentsPage.paymentRow(paymentId)).not.toBeVisible();
  });

  test('bulk delete removes all selected payments', async ({ paymentsPage }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    await paymentsPage.createPayment(crypto.randomUUID());

    await paymentsPage.selectAll.check();
    await expect(paymentsPage.bulkBar).toBeVisible();

    await paymentsPage.btnBulkDelete.click();

    await expect(paymentsPage.toastMessage.last()).toContainText('deleted');
    await expect(paymentsPage.bulkBar).not.toBeVisible();
  });

  test('bulk delete hides bulk bar after completion', async ({ paymentsPage }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    await paymentsPage.selectAll.check();
    await paymentsPage.btnBulkDelete.click();

    await expect(paymentsPage.toast).toBeVisible();
    await expect(paymentsPage.bulkBar).not.toBeVisible();
  });

  test('deleting a payment emits payment.deleted event in feed', async ({ paymentsPage, eventFeed }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    await expect(paymentsPage.toast).toBeVisible();

    const rows = paymentsPage.rows();
    await rows.first().waitFor();
    const paymentId = await rows.first().getAttribute('data-testid').then(v => v?.replace('payment-row-', '') ?? '');

    await paymentsPage.btnDeletePayment(paymentId).click();

    await eventFeed.waitForEventType('payment.deleted');
    await expect(eventFeed.eventsOfType('payment.deleted').first()).toBeVisible();
  });
});

test.describe('Payments — Kafka events', () => {
  test('creating a payment emits payment.initiated in event feed', async ({ paymentsPage, eventFeed }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    await eventFeed.waitForEventType('payment.initiated');
    await expect(eventFeed.eventsOfType('payment.initiated').first()).toBeVisible();
  });

  test('processing a payment emits payment.processed event', async ({ paymentsPage, eventFeed }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    await expect(paymentsPage.toast).toBeVisible();

    const pendingRows = paymentsPage.rowsWithStatus('pending');
    await pendingRows.first().waitFor();
    const paymentId = await pendingRows.first().getAttribute('data-testid').then(v => v?.replace('payment-row-', '') ?? '');

    await paymentsPage.paymentRowCb(paymentId).check();
    await paymentsPage.btnBulkProcess.click();

    await eventFeed.waitForEventType('payment.processed');
    await expect(eventFeed.eventsOfType('payment.processed').first()).toBeVisible();
  });

  test('refunding a payment emits payment.refunded event', async ({ paymentsPage, eventFeed }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    await expect(paymentsPage.toast).toBeVisible();

    const pendingRows = paymentsPage.rowsWithStatus('pending');
    await pendingRows.first().waitFor();
    const paymentId = await pendingRows.first().getAttribute('data-testid').then(v => v?.replace('payment-row-', '') ?? '');

    await paymentsPage.paymentRowCb(paymentId).check();
    await paymentsPage.btnBulkRefund.click();

    await eventFeed.waitForEventType('payment.refunded');
    await expect(eventFeed.eventsOfType('payment.refunded').first()).toBeVisible();
  });

  test('failing a payment emits payment.failed event', async ({ paymentsPage, eventFeed }) => {
    await paymentsPage.createPayment(crypto.randomUUID());
    const pendingRows = paymentsPage.rowsWithStatus('pending');
    await pendingRows.first().waitFor();
    const paymentId = await pendingRows.first().getAttribute('data-testid').then(v => v?.replace('payment-row-', '') ?? '');

    await paymentsPage.paymentRowCb(paymentId).check();
    await paymentsPage.btnBulkFail.click();
    await expect(paymentsPage.toastMessage.last()).toContainText('failed');

    await eventFeed.waitForEventType('payment.failed');
    await expect(eventFeed.eventsOfType('payment.failed').first()).toBeVisible();
  });
});
