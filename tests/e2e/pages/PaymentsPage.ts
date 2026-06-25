import type { Page, Locator } from '@playwright/test';

export class PaymentsPage {
  readonly panel:            Locator;
  readonly btnBulkCreate:    Locator;
  readonly btnNewPayment:    Locator;
  readonly filterPills:      Locator;
  readonly table:            Locator;
  readonly emptyState:       Locator;
  readonly filterEmpty:      Locator;
  readonly selectAll:        Locator;
  readonly bulkBar:          Locator;
  readonly bulkBarCount:     Locator;
  readonly btnBulkProcess:   Locator;
  readonly btnBulkRefund:    Locator;
  readonly btnBulkFail:      Locator;
  readonly btnBulkDelete:    Locator;
  readonly btnDeselectAll:   Locator;
  // Toast notifications
  readonly toast:            Locator;
  readonly toastMessage:     Locator;
  // Modal
  readonly modal:            Locator;
  readonly modalClose:       Locator;
  readonly inputOrderId:     Locator;
  readonly selectMethod:     Locator;
  readonly cbSimulateFailure: Locator;
  readonly formError:        Locator;
  readonly btnCancelModal:   Locator;
  readonly btnSubmitPayment: Locator;

  constructor(private page: Page) {
    this.panel             = page.getByTestId('payments-panel');
    this.btnBulkCreate     = page.getByTestId('btn-bulk-create-payments');
    this.btnNewPayment     = page.getByTestId('btn-new-payment');
    this.filterPills       = page.getByTestId('payments-filter-pills');
    this.table             = page.getByTestId('payments-table');
    this.emptyState        = page.getByTestId('payments-empty');
    this.filterEmpty       = page.getByTestId('payments-filter-empty');
    this.selectAll         = page.getByTestId('select-all-payments');
    this.bulkBar           = page.getByTestId('payments-bulk-bar');
    this.bulkBarCount      = page.getByTestId('bulk-bar-count');
    this.btnBulkProcess    = page.getByTestId('btn-bulk-process');
    this.btnBulkRefund     = page.getByTestId('btn-bulk-refund');
    this.btnBulkFail       = page.getByTestId('btn-bulk-fail');
    this.btnBulkDelete     = page.getByTestId('btn-bulk-delete-payments');
    this.btnDeselectAll    = page.getByTestId('btn-deselect-all');
    this.modal             = page.getByTestId('modal-new-payment');
    this.modalClose        = page.getByTestId('btn-modal-close');
    this.inputOrderId      = page.getByTestId('input-order-id');
    this.selectMethod      = page.getByTestId('select-payment-method');
    this.cbSimulateFailure = page.getByTestId('cb-simulate-failure');
    this.formError         = page.getByTestId('form-error');
    this.toast             = page.getByTestId('toast');
    this.toastMessage      = page.getByTestId('toast-message');
    this.btnCancelModal    = page.getByTestId('btn-cancel-modal');
    this.btnSubmitPayment  = page.getByTestId('btn-submit-payment');
  }

  filterPill(status: 'all' | 'pending' | 'processed' | 'refunded' | 'failed') {
    return this.page.getByTestId(`filter-pill-${status}`);
  }

  paymentRow(id: string)    { return this.page.getByTestId(`payment-row-${id}`); }
  paymentRowCb(id: string)  { return this.page.getByTestId(`payment-row-cb-${id}`); }
  paymentStatus(id: string) { return this.page.getByTestId(`payment-status-${id}`); }
  btnDeletePayment(id: string) { return this.page.getByTestId(`btn-delete-payment-${id}`); }

  async openNewPaymentModal() {
    await this.btnNewPayment.click();
    await this.modal.waitFor({ state: 'visible' });
  }

  async fillPaymentForm(orderId: string, method = 'credit_card', simulateFailure = false) {
    await this.inputOrderId.fill(orderId);
    await this.selectMethod.selectOption(method);
    if (simulateFailure) await this.cbSimulateFailure.check();
  }

  async submitPayment() {
    await this.btnSubmitPayment.click();
  }

  async createPayment(orderId: string, method = 'credit_card', simulateFailure = false) {
    await this.openNewPaymentModal();
    await this.fillPaymentForm(orderId, method, simulateFailure);
    if (simulateFailure) {
      // Wait for React to re-render the button after checkbox state update
      await this.btnSubmitPayment.filter({ hasText: 'Simulate Failure' }).waitFor();
    }
    await this.submitPayment();
    await this.modal.waitFor({ state: 'hidden' });
  }

  rows() {
    return this.page.locator('[data-testid^="payment-row-"]');
  }

  rowsWithStatus(status: string) {
    return this.page.locator(`[data-payment-status="${status}"]`);
  }
}
