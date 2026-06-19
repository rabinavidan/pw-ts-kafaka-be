import { useState, useEffect, useCallback } from 'react';
import { useOrders } from '../hooks/useOrders';
import { ApiError } from '../api/client';
import type { Toast } from '../types';

type Filter = 'all' | 'created' | 'confirmed' | 'cancelled';

interface Props {
  onToast: (type: Toast['type'], message: string) => void;
}

const FILTERS: Filter[] = ['all', 'created', 'confirmed', 'cancelled'];
const PRODUCTS   = ['laptop', 'keyboard', 'monitor', 'headset', 'mouse', 'webcam', 'desk-lamp', 'usb-hub', 'ssd-drive', 'charger'];
const CURRENCIES = ['USD', 'EUR', 'GBP'];
const USERS      = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank', 'grace', 'hank'];

function randomOrderPayload() {
  const userId = `${USERS[Math.floor(Math.random() * USERS.length)]}-${Math.random().toString(36).slice(2, 6)}`;
  const items = Array.from({ length: Math.floor(Math.random() * 3) + 1 }, () => ({
    productId: `${PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)]}-${Math.random().toString(36).slice(2, 5)}`,
    quantity:  Math.floor(Math.random() * 4) + 1,
  }));
  return { userId, items, currency: CURRENCIES[Math.floor(Math.random() * CURRENCIES.length)] };
}

export function OrdersPanel({ onToast }: Props) {
  const { orders, loading, refresh, create, cancel, confirm, remove, removeMany } = useOrders();
  const [filter, setFilter]         = useState<Filter>('all');
  const [showModal, setShowModal]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [bulking, setBulking]       = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [formError, setFormError]   = useState('');
  const [form, setForm] = useState({ userId: '', currency: 'USD', items: [{ productId: '', quantity: 1 }] });

  // ── Selection state ───────────────────────────────────────
  const [selected, setSelected]           = useState<Set<string>>(new Set());
  const [bulkActionLabel, setBulkLabel]   = useState('');
  const [bulkActionRunning, setBulkRunning] = useState(false);

  useEffect(() => { refresh(filter === 'all' ? undefined : filter); }, [filter, refresh]);
  useEffect(() => { setSelected(new Set()); }, [filter]);

  const visible         = filter === 'all' ? orders : orders.filter(o => o.status === filter);
  const allSelected     = visible.length > 0 && visible.every(o => selected.has(o.id));
  const someSelected    = visible.some(o => selected.has(o.id));
  const selectedCreated = visible.filter(o => selected.has(o.id) && o.status === 'created');
  const selectedAny     = visible.filter(o => selected.has(o.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visible.map(o => o.id)));
  }

  function toggleRow(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // ── Bulk actions ──────────────────────────────────────────
  async function runBulkAction(action: 'confirm' | 'cancel') {
    const targets = selectedCreated;
    if (targets.length === 0) return;
    setBulkRunning(true);
    setBulkLabel('');
    let done = 0;
    for (const o of targets) {
      try {
        action === 'confirm' ? await confirm(o.id) : await cancel(o.id);
        done++;
      } catch { /* skip */ }
      setBulkLabel(`${action === 'confirm' ? 'Confirming' : 'Cancelling'} ${done}/${targets.length}…`);
    }
    setBulkRunning(false);
    setBulkLabel('');
    clearSelection();
    onToast('success', `${done}/${targets.length} orders ${action === 'confirm' ? 'confirmed' : 'cancelled'}`);
  }

  // ── Bulk create ───────────────────────────────────────────
  async function handleBulkCreate() {
    setBulking(true);
    setBulkProgress(0);
    let created = 0;
    for (let i = 0; i < 15; i++) {
      try { await create(randomOrderPayload()); created++; } catch { /* skip */ }
      setBulkProgress(i + 1);
    }
    setBulking(false);
    onToast('success', `${created}/15 orders created`);
  }

  // ── Single actions ────────────────────────────────────────
  function addItem() { setForm(f => ({ ...f, items: [...f.items, { productId: '', quantity: 1 }] })); }

  function setItem(idx: number, field: 'productId' | 'quantity', val: string | number) {
    setForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, [field]: val } : it) }));
  }

  function removeItem(idx: number) {
    setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }

  function resetModal() {
    setForm({ userId: '', currency: 'USD', items: [{ productId: '', quantity: 1 }] });
    setFormError('');
    setShowModal(false);
  }

  async function handleCreate() {
    if (!form.userId.trim())                        { setFormError('User ID is required'); return; }
    if (form.items.some(i => !i.productId.trim())) { setFormError('All product IDs are required'); return; }
    setSubmitting(true); setFormError('');
    try {
      await create(form);
      resetModal();
      onToast('success', 'Order created — order.created event published to Kafka');
    } catch (e) {
      onToast('error', e instanceof ApiError ? e.message : 'Failed to create order');
    } finally { setSubmitting(false); }
  }

  async function handleConfirm(id: string) {
    try { await confirm(id); onToast('success', 'Order confirmed'); }
    catch { onToast('error', 'Failed to confirm order'); }
  }

  async function handleCancel(id: string) {
    try { await cancel(id); onToast('success', 'Order cancelled'); }
    catch { onToast('error', 'Failed to cancel order'); }
  }

  async function handleDelete(id: string) {
    try { await remove(id); onToast('success', 'Order deleted'); }
    catch { onToast('error', 'Failed to delete order'); }
  }

  async function handleBulkDelete() {
    const targets = selectedAny;
    if (targets.length === 0) return;
    setBulkRunning(true);
    setBulkLabel(`Deleting 0/${targets.length}…`);
    const count = await removeMany(targets.map(o => o.id));
    setBulkRunning(false);
    setBulkLabel('');
    clearSelection();
    onToast('success', `${count}/${targets.length} orders deleted`);
  }

  const selCount = selected.size;

  return (
    <div data-testid="orders-panel">
      {/* ── Top bar ── */}
      <div className="panel-top">
        <h2 className="panel-title">Orders</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-ghost"
            onClick={handleBulkCreate}
            disabled={bulking}
            title="Create 15 random orders"
            data-testid="btn-bulk-create-orders"
          >
            {bulking ? <><span style={{ fontSize: 12, color: 'var(--amber)' }}>●</span> {bulkProgress}/15</> : '⚡ Bulk ×15'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)} data-testid="btn-new-order">
            + New Order
          </button>
        </div>
      </div>

      {/* ── Filter pills ── */}
      <div className="filter-pills" data-testid="orders-filter-pills">
        {FILTERS.map(f => (
          <button
            key={f}
            className={`pill ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
            data-testid={`filter-pill-${f}`}
          >
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            {f !== 'all' && <span style={{ opacity: .65, marginLeft: 4 }}>({orders.filter(o => o.status === f).length})</span>}
          </button>
        ))}
        <button
          className="pill pill-refresh"
          onClick={() => refresh(filter === 'all' ? undefined : filter)}
          data-testid="btn-refresh-orders"
        >
          ↻
        </button>
      </div>

      {/* ── Bulk action bar ── */}
      {someSelected && (
        <div className="bulk-bar" data-testid="orders-bulk-bar">
          <span className="bulk-bar-count" data-testid="bulk-bar-count">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M5 8l2.5 2.5L11 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {selCount} selected
          </span>
          {selCount !== selectedCreated.length && (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>({selectedCreated.length} actionable)</span>
          )}
          <div className="bulk-bar-actions">
            {bulkActionRunning ? (
              <span style={{ fontSize: 12, color: 'var(--amber)' }} data-testid="bulk-action-progress">● {bulkActionLabel}</span>
            ) : (
              <>
                <button
                  className="btn btn-success btn-sm"
                  disabled={selectedCreated.length === 0}
                  onClick={() => runBulkAction('confirm')}
                  data-testid="btn-bulk-confirm"
                >
                  ✓ Confirm {selectedCreated.length > 0 && `(${selectedCreated.length})`}
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  disabled={selectedCreated.length === 0}
                  onClick={() => runBulkAction('cancel')}
                  data-testid="btn-bulk-cancel"
                >
                  ✕ Cancel {selectedCreated.length > 0 && `(${selectedCreated.length})`}
                </button>
                <button
                  className="btn btn-sm"
                  style={{ background: 'rgba(239,68,68,.12)', color: '#f87171', border: '1px solid rgba(239,68,68,.3)' }}
                  disabled={selectedAny.length === 0}
                  onClick={handleBulkDelete}
                  data-testid="btn-bulk-delete-orders"
                >
                  🗑 Delete {selectedAny.length > 0 && `(${selectedAny.length})`}
                </button>
              </>
            )}
          </div>
          <button className="bulk-bar-clear" onClick={clearSelection} title="Clear selection" data-testid="btn-deselect-all">
            ✕ Deselect all
          </button>
        </div>
      )}

      {/* ── Table / empty state ── */}
      {loading && visible.length === 0 ? (
        <div className="empty-state" data-testid="orders-loading">
          <div className="empty-icon">⏳</div>
          <div className="empty-title">Loading orders…</div>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state" data-testid="orders-empty">
          <div className="empty-icon">📦</div>
          <div className="empty-title">No orders yet</div>
          <div className="empty-sub">Click "+ New Order" to create the first one</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table data-testid="orders-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    className="row-cb"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll}
                    title="Select all actionable"
                    data-testid="select-all-orders"
                  />
                </th>
                <th>Order ID</th>
                <th>User</th>
                <th>Items</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(o => {
                const isSelected = selected.has(o.id);
                return (
                  <tr
                    key={o.id}
                    className={isSelected ? 'row-selected' : ''}
                    onClick={() => toggleRow(o.id)}
                    style={{ cursor: 'pointer' }}
                    data-testid={`order-row-${o.id}`}
                    data-order-status={o.status}
                  >
                    <td onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="row-cb"
                        checked={isSelected}
                        onChange={() => toggleRow(o.id)}
                        data-testid={`order-row-cb-${o.id}`}
                      />
                    </td>
                    <td><span className="mono" title={o.id}>{o.id.slice(0, 8)}…</span></td>
                    <td><span className="mono" title={o.userId}>{o.userId.slice(0, 12)}…</span></td>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>{o.items.length} item{o.items.length !== 1 ? 's' : ''}</td>
                    <td className="fw600">${o.amount} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{o.currency}</span></td>
                    <td><span className={`badge badge-${o.status}`} data-testid={`order-status-${o.id}`}>{o.status}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(o.createdAt).toLocaleTimeString()}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="actions">
                        {o.status === 'created' && (
                          <>
                            <button
                              className="btn btn-success btn-sm"
                              title="Confirm"
                              onClick={() => handleConfirm(o.id)}
                              data-testid={`btn-confirm-order-${o.id}`}
                            >✓</button>
                            <button
                              className="btn btn-danger btn-sm"
                              title="Cancel"
                              onClick={() => handleCancel(o.id)}
                              data-testid={`btn-cancel-order-${o.id}`}
                            >✕</button>
                          </>
                        )}
                        <button
                          className="btn btn-sm"
                          style={{ background: 'rgba(239,68,68,.08)', color: '#f87171', border: '1px solid rgba(239,68,68,.2)' }}
                          title="Delete"
                          onClick={() => handleDelete(o.id)}
                          data-testid={`btn-delete-order-${o.id}`}
                        >🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Create modal ── */}
      {showModal && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && resetModal()} data-testid="modal-overlay">
          <div className="modal" data-testid="modal-new-order">
            <div className="modal-head">
              <span className="modal-title">New Order</span>
              <button className="modal-x" onClick={resetModal} data-testid="btn-modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>User ID</label>
                <input
                  className="input"
                  placeholder="e.g. user-001"
                  value={form.userId}
                  onChange={e => setForm(f => ({ ...f, userId: e.target.value }))}
                  data-testid="input-user-id"
                />
              </div>
              <div className="field">
                <label>Currency</label>
                <select
                  className="select"
                  value={form.currency}
                  onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                  data-testid="select-currency"
                >
                  <option>USD</option><option>EUR</option><option>GBP</option>
                </select>
              </div>
              <div className="field">
                <label>Items</label>
                <div className="items-list" data-testid="items-list">
                  {form.items.map((item, idx) => (
                    <div key={idx} className="item-row" data-testid={`item-row-${idx}`}>
                      <input
                        className="input"
                        placeholder="Product ID"
                        value={item.productId}
                        onChange={e => setItem(idx, 'productId', e.target.value)}
                        data-testid={`input-product-id-${idx}`}
                      />
                      <input
                        type="number"
                        min={1}
                        className="input qty"
                        value={item.quantity}
                        onChange={e => setItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                        data-testid={`input-quantity-${idx}`}
                      />
                      {form.items.length > 1 && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => removeItem(idx)}
                          data-testid={`btn-remove-item-${idx}`}
                        >×</button>
                      )}
                    </div>
                  ))}
                  <button className="add-item" onClick={addItem} data-testid="btn-add-item">+ Add item</button>
                </div>
              </div>
              {formError && <div className="field-err" data-testid="form-error">{formError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={resetModal} data-testid="btn-cancel-modal">Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={submitting}
                data-testid="btn-submit-order"
              >
                {submitting ? 'Creating…' : 'Create Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
