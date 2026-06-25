import { useState, useCallback, useEffect } from 'react';
import { usePayments } from '../hooks/usePayments';
import { ApiError } from '../api/client';
import type { Toast } from '../types';

interface Props {
  onToast: (type: Toast['type'], message: string) => void;
}

type Filter = 'all' | 'pending' | 'failed' | 'processed' | 'refunded';
const FILTERS: Filter[] = ['all', 'pending', 'processed', 'refunded', 'failed'];
const METHODS = ['credit_card', 'debit_card', 'bank_transfer'];

function randomPaymentPayload() {
  return {
    orderId: crypto.randomUUID(),
    method:  METHODS[Math.floor(Math.random() * METHODS.length)],
  };
}

export function PaymentsPanel({ onToast }: Props) {
  const { payments, loading, page, total, totalPages, refresh, create, process, refund, fail, remove, removeMany } = usePayments();
  const [showModal, setShowModal]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [bulking, setBulking]           = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [filter, setFilter]             = useState<Filter>('all');
  const [formError, setFormError]   = useState('');
  const [form, setForm] = useState({ orderId: '', method: 'credit_card', simulateFailure: false });

  // ── Selection state ───────────────────────────────────────
  const [selected, setSelected]           = useState<Set<string>>(new Set());
  const [bulkActionLabel, setBulkLabel]   = useState('');
  const [bulkActionRunning, setBulkRunning] = useState(false);

  const currentFilter = filter === 'all' ? undefined : filter;

  useEffect(() => { refresh(currentFilter, 1); }, [filter, refresh]);
  useEffect(() => { setSelected(new Set()); }, [filter, page]);

  function goToPage(p: number) { refresh(currentFilter, p); setSelected(new Set()); }

  const visible         = payments;
  const allSelected     = visible.length > 0 && visible.every(p => selected.has(p.id));
  const someSelected    = visible.some(p => selected.has(p.id));
  const selectedPending = visible.filter(p => selected.has(p.id) && p.status === 'pending');
  const selectedAny     = visible.filter(p => selected.has(p.id));
  const selCount        = selected.size;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visible.map(p => p.id)));
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
  async function runBulkAction(action: 'process' | 'refund' | 'fail') {
    const targets = selectedPending;
    if (targets.length === 0) return;
    setBulkRunning(true);
    let done = 0;
    const labels = { process: 'Processing', refund: 'Refunding', fail: 'Failing' };
    const past   = { process: 'processed', refund: 'refunded', fail: 'failed' };
    for (const p of targets) {
      try {
        if (action === 'process') await process(p.id);
        else if (action === 'refund') await refund(p.id);
        else await fail(p.id);
        done++;
      } catch { /* skip */ }
      setBulkLabel(`${labels[action]} ${done}/${targets.length}…`);
    }
    setBulkRunning(false);
    setBulkLabel('');
    clearSelection();
    onToast('success', `${done}/${targets.length} payments ${past[action]}`);
  }

  // ── Bulk create ───────────────────────────────────────────
  async function handleBulkCreate() {
    setBulking(true);
    setBulkProgress(0);
    let created = 0;
    for (let i = 0; i < 10; i++) {
      try { await create(randomPaymentPayload()); created++; } catch { /* skip */ }
      setBulkProgress(i + 1);
    }
    setBulking(false);
    onToast('success', `${created}/10 payments created`);
  }

  // ── Delete ───────────────────────────────────────────
  async function handleDelete(id: string) {
    try { await remove(id); onToast('success', 'Payment deleted'); }
    catch { onToast('error', 'Failed to delete payment'); }
  }

  async function handleBulkDelete() {
    const targets = selectedAny;
    if (targets.length === 0) return;
    setBulkRunning(true);
    setBulkLabel(`Deleting 0/${targets.length}…`);
    const count = await removeMany(targets.map(p => p.id));
    setBulkRunning(false);
    setBulkLabel('');
    clearSelection();
    onToast('success', `${count}/${targets.length} payments deleted`);
  }

  // ── Single create ─────────────────────────────────────────
  function resetModal() {
    setForm({ orderId: '', method: 'credit_card', simulateFailure: false });
    setFormError('');
    setShowModal(false);
  }

  async function handleCreate() {
    if (!form.orderId.trim()) { setFormError('Order ID is required'); return; }
    setSubmitting(true); setFormError('');
    try {
      await create(form);
      resetModal();
      onToast('success', form.simulateFailure
        ? 'Failure simulated → DLQ event published'
        : 'Payment initiated → payment.initiated event published');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        onToast('error', 'Payment already exists for this order (409)');
      } else {
        onToast('error', e instanceof ApiError ? e.message : 'Failed');
      }
    } finally { setSubmitting(false); }
  }

  return (
    <div data-testid="payments-panel">
      {/* ── Top bar ── */}
      <div className="panel-top">
        <h2 className="panel-title">Payments</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-ghost"
            onClick={handleBulkCreate}
            disabled={bulking}
            title="Create 10 random payments"
            data-testid="btn-bulk-create-payments"
          >
            {bulking
              ? <><span style={{ fontSize: 12, color: 'var(--amber)' }}>●</span> {bulkProgress}/10</>
              : '⚡ Bulk ×10'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)} data-testid="btn-new-payment">
            + New Payment
          </button>
        </div>
      </div>

      {/* ── Filter pills ── */}
      <div className="filter-pills" data-testid="payments-filter-pills">
        {FILTERS.map(f => (
          <button
            key={f}
            className={`pill ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
            data-testid={`filter-pill-${f}`}
          >
            {f === 'all' ? `All (${total})` : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Bulk action bar ── */}
      {someSelected && (
        <div className="bulk-bar" data-testid="payments-bulk-bar">
          <span className="bulk-bar-count" data-testid="bulk-bar-count">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M5 8l2.5 2.5L11 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {selCount} selected
          </span>
          {selCount !== selectedPending.length && (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>({selectedPending.length} actionable)</span>
          )}
          <div className="bulk-bar-actions">
            {bulkActionRunning ? (
              <span style={{ fontSize: 12, color: 'var(--amber)' }} data-testid="bulk-action-progress">● {bulkActionLabel}</span>
            ) : (
              <>
                <button
                  className="btn btn-success btn-sm"
                  disabled={selectedPending.length === 0}
                  onClick={() => runBulkAction('process')}
                  data-testid="btn-bulk-process"
                >
                  ✓ Processed {selectedPending.length > 0 && `(${selectedPending.length})`}
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  disabled={selectedPending.length === 0}
                  onClick={() => runBulkAction('refund')}
                  data-testid="btn-bulk-refund"
                >
                  ↩ Refunded {selectedPending.length > 0 && `(${selectedPending.length})`}
                </button>
                <button
                  className="btn btn-sm"
                  style={{ background: 'rgba(239,68,68,.15)', color: '#f87171', border: '1px solid rgba(239,68,68,.3)' }}
                  disabled={selectedPending.length === 0}
                  onClick={() => runBulkAction('fail')}
                  data-testid="btn-bulk-fail"
                >
                  ✕ Failed {selectedPending.length > 0 && `(${selectedPending.length})`}
                </button>
                <button
                  className="btn btn-sm"
                  style={{ background: 'rgba(239,68,68,.12)', color: '#f87171', border: '1px solid rgba(239,68,68,.25)' }}
                  disabled={selectedAny.length === 0}
                  onClick={handleBulkDelete}
                  data-testid="btn-bulk-delete-payments"
                >
                  🗑 Delete {selectedAny.length > 0 && `(${selectedAny.length})`}
                </button>
              </>
            )}
          </div>
          <button className="bulk-bar-clear" onClick={clearSelection} data-testid="btn-deselect-all">✕ Deselect all</button>
        </div>
      )}

      {/* ── Table / empty state ── */}
      {visible.length === 0 && filter !== 'all' ? (
        <div className="empty-state" data-testid="payments-filter-empty">
          <div className="empty-icon">🔍</div>
          <div className="empty-title">No {filter} payments</div>
          <div className="empty-sub">Try a different filter or create a new payment</div>
        </div>
      ) : loading && visible.length === 0 ? (
        <div className="empty-state" data-testid="payments-loading">
          <div className="empty-icon">⏳</div>
          <div className="empty-title">Loading payments…</div>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state" data-testid="payments-empty">
          <div className="empty-icon">💳</div>
          <div className="empty-title">No payments yet</div>
          <div className="empty-sub">Initiate a payment for an existing order ID</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table data-testid="payments-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    className="row-cb"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll}
                    title="Select all pending"
                    data-testid="select-all-payments"
                  />
                </th>
                <th>Payment ID</th>
                <th>Order ID</th>
                <th>Method</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(p => {
                const isSelected = selected.has(p.id);
                return (
                  <tr
                    key={p.id}
                    className={isSelected ? 'row-selected' : ''}
                    onClick={() => toggleRow(p.id)}
                    style={{ cursor: 'pointer' }}
                    data-testid={`payment-row-${p.id}`}
                    data-payment-status={p.status}
                  >
                    <td onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="row-cb"
                        checked={isSelected}
                        onChange={() => toggleRow(p.id)}
                        data-testid={`payment-row-cb-${p.id}`}
                      />
                    </td>
                    <td><span className="mono" title={p.id}>{p.id.slice(0, 8)}…</span></td>
                    <td><span className="mono" title={p.orderId}>{p.orderId.slice(0, 8)}…</span></td>
                    <td style={{ fontSize: 12, color: 'var(--dim)' }}>{p.method.replace(/_/g, ' ')}</td>
                    <td className="fw600">${p.amount} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{p.currency}</span></td>
                    <td><span className={`badge badge-${p.status}`} data-testid={`payment-status-${p.id}`}>{p.status}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(p.createdAt).toLocaleTimeString()}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <button
                        className="btn btn-sm"
                        style={{ background: 'rgba(239,68,68,.08)', color: '#f87171', border: '1px solid rgba(239,68,68,.2)' }}
                        title="Delete"
                        onClick={() => handleDelete(p.id)}
                        data-testid={`btn-delete-payment-${p.id}`}
                      >🗑</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="pagination">
              <span className="pagination-info">
                {total} payment{total !== 1 ? 's' : ''}
                <span style={{ color: 'var(--border)', margin: '0 2px' }}>·</span>
                page {page} of {totalPages}
              </span>
              <div className="pagination-pages">
                <button className="page-btn" onClick={() => goToPage(1)} disabled={page === 1}>«</button>
                <button className="page-btn" onClick={() => goToPage(page - 1)} disabled={page === 1}>‹</button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                  const p = start + i;
                  return p <= totalPages ? (
                    <button key={p} className={`page-btn ${p === page ? 'active' : ''}`} onClick={() => goToPage(p)}>{p}</button>
                  ) : null;
                })}
                <button className="page-btn" onClick={() => goToPage(page + 1)} disabled={page === totalPages}>›</button>
                <button className="page-btn" onClick={() => goToPage(totalPages)} disabled={page === totalPages}>»</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Create modal ── */}
      {showModal && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && resetModal()} data-testid="modal-overlay">
          <div className="modal" data-testid="modal-new-payment">
            <div className="modal-head">
              <span className="modal-title">New Payment</span>
              <button className="modal-x" onClick={resetModal} data-testid="btn-modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>Order ID</label>
                <input
                  className="input"
                  placeholder="paste order UUID"
                  value={form.orderId}
                  onChange={e => setForm(f => ({ ...f, orderId: e.target.value }))}
                  data-testid="input-order-id"
                />
              </div>
              <div className="field">
                <label>Payment Method</label>
                <select
                  className="select"
                  value={form.method}
                  onChange={e => setForm(f => ({ ...f, method: e.target.value }))}
                  data-testid="select-payment-method"
                >
                  <option value="credit_card">Credit Card</option>
                  <option value="debit_card">Debit Card</option>
                  <option value="bank_transfer">Bank Transfer</option>
                </select>
              </div>
              <div className="field">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.simulateFailure}
                    onChange={e => setForm(f => ({ ...f, simulateFailure: e.target.checked }))}
                    data-testid="cb-simulate-failure"
                  />
                  <span>Simulate failure (publishes to dead-letter queue)</span>
                </label>
              </div>
              {formError && <div className="field-err" data-testid="form-error">{formError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={resetModal} data-testid="btn-cancel-modal">Cancel</button>
              <button
                className={`btn ${form.simulateFailure ? 'btn-danger' : 'btn-primary'}`}
                onClick={handleCreate}
                disabled={submitting}
                data-testid="btn-submit-payment"
              >
                {submitting ? 'Processing…' : form.simulateFailure ? 'Simulate Failure' : 'Initiate Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
