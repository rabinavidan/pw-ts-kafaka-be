import type { Page, Locator } from '@playwright/test';

export class OrdersPage {
  readonly panel:            Locator;
  readonly btnBulkCreate:    Locator;
  readonly btnNewOrder:      Locator;
  readonly filterPills:      Locator;
  readonly btnRefresh:       Locator;
  readonly table:            Locator;
  readonly emptyState:       Locator;
  readonly selectAll:        Locator;
  readonly bulkBar:          Locator;
  readonly bulkBarCount:     Locator;
  readonly btnBulkConfirm:   Locator;
  readonly btnBulkCancel:    Locator;
  readonly btnBulkDelete:    Locator;
  readonly btnDeselectAll:   Locator;
  // Modal
  readonly modal:            Locator;
  readonly modalClose:       Locator;
  readonly inputUserId:      Locator;
  readonly selectCurrency:   Locator;
  readonly itemsList:        Locator;
  readonly btnAddItem:       Locator;
  readonly formError:        Locator;
  readonly btnCancelModal:   Locator;
  readonly btnSubmitOrder:   Locator;

  constructor(private page: Page) {
    this.panel          = page.getByTestId('orders-panel');
    this.btnBulkCreate  = page.getByTestId('btn-bulk-create-orders');
    this.btnNewOrder    = page.getByTestId('btn-new-order');
    this.filterPills    = page.getByTestId('orders-filter-pills');
    this.btnRefresh     = page.getByTestId('btn-refresh-orders');
    this.table          = page.getByTestId('orders-table');
    this.emptyState     = page.getByTestId('orders-empty');
    this.selectAll      = page.getByTestId('select-all-orders');
    this.bulkBar        = page.getByTestId('orders-bulk-bar');
    this.bulkBarCount   = page.getByTestId('bulk-bar-count');
    this.btnBulkConfirm = page.getByTestId('btn-bulk-confirm');
    this.btnBulkCancel  = page.getByTestId('btn-bulk-cancel');
    this.btnBulkDelete  = page.getByTestId('btn-bulk-delete-orders');
    this.btnDeselectAll = page.getByTestId('btn-deselect-all');
    this.modal          = page.getByTestId('modal-new-order');
    this.modalClose     = page.getByTestId('btn-modal-close');
    this.inputUserId    = page.getByTestId('input-user-id');
    this.selectCurrency = page.getByTestId('select-currency');
    this.itemsList      = page.getByTestId('items-list');
    this.btnAddItem     = page.getByTestId('btn-add-item');
    this.formError      = page.getByTestId('form-error');
    this.btnCancelModal = page.getByTestId('btn-cancel-modal');
    this.btnSubmitOrder = page.getByTestId('btn-submit-order');
  }

  filterPill(status: 'all' | 'created' | 'confirmed' | 'cancelled') {
    return this.page.getByTestId(`filter-pill-${status}`);
  }

  orderRow(id: string)        { return this.page.getByTestId(`order-row-${id}`); }
  orderRowCb(id: string)      { return this.page.getByTestId(`order-row-cb-${id}`); }
  orderStatus(id: string)     { return this.page.getByTestId(`order-status-${id}`); }
  btnConfirmOrder(id: string) { return this.page.getByTestId(`btn-confirm-order-${id}`); }
  btnCancelOrder(id: string)  { return this.page.getByTestId(`btn-cancel-order-${id}`); }
  btnDeleteOrder(id: string)  { return this.page.getByTestId(`btn-delete-order-${id}`); }
  productIdInput(idx: number) { return this.page.getByTestId(`input-product-id-${idx}`); }
  quantityInput(idx: number)  { return this.page.getByTestId(`input-quantity-${idx}`); }
  btnRemoveItem(idx: number)  { return this.page.getByTestId(`btn-remove-item-${idx}`); }

  async openNewOrderModal() {
    await this.btnNewOrder.click();
    await this.modal.waitFor({ state: 'visible' });
  }

  async fillOrderForm(userId: string, productId: string, currency = 'USD') {
    await this.inputUserId.fill(userId);
    await this.selectCurrency.selectOption(currency);
    await this.productIdInput(0).fill(productId);
  }

  async submitOrder() {
    await this.btnSubmitOrder.click();
  }

  async createOrder(userId: string, productId: string, currency = 'USD') {
    await this.openNewOrderModal();
    await this.fillOrderForm(userId, productId, currency);
    await this.submitOrder();
    await this.modal.waitFor({ state: 'hidden' });
  }

  rows() {
    return this.page.locator('[data-testid^="order-row-"]');
  }

  rowsWithStatus(status: string) {
    return this.page.locator(`[data-order-status="${status}"]`);
  }
}
