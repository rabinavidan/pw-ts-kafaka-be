import { useState, useCallback, useEffect } from 'react';
import { api } from '../api/client';
import type { Payment } from '../types';

const PAGE_SIZE = 15;

export function usePayments() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading]   = useState(false);
  const [page, setPage]         = useState(1);
  const [total, setTotal]       = useState(0);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const refresh = useCallback(async (status?: string, targetPage = 1) => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE) });
      if (status) q.set('status', status);
      const res = await api.get<{ items: Payment[]; total: number; page: number }>(`/api/v1/payments?${q}`);
      setPayments(res.items);
      setTotal(res.total);
      setPage(res.page);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = useCallback(async (payload: { orderId: string; method: string; simulateFailure?: boolean }) => {
    const payment = await api.post<Payment>('/api/v1/payments', payload);
    setPayments(prev => [payment, ...prev].slice(0, PAGE_SIZE));
    setTotal(prev => prev + 1);
    return payment;
  }, []);

  const process = useCallback(async (id: string) => {
    const payment = await api.put<Payment>(`/api/v1/payments/${id}/process`);
    setPayments(prev => prev.map(p => (p.id === id ? payment : p)));
    return payment;
  }, []);

  const refund = useCallback(async (id: string) => {
    const payment = await api.put<Payment>(`/api/v1/payments/${id}/refund`);
    setPayments(prev => prev.map(p => (p.id === id ? payment : p)));
    return payment;
  }, []);

  const fail = useCallback(async (id: string) => {
    const payment = await api.put<Payment>(`/api/v1/payments/${id}/fail`);
    setPayments(prev => prev.map(p => (p.id === id ? payment : p)));
    return payment;
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.del<{ id: string; deleted: boolean }>(`/api/v1/payments/${id}`);
    setPayments(prev => prev.filter(p => p.id !== id));
    setTotal(prev => Math.max(0, prev - 1));
  }, []);

  const removeMany = useCallback(async (ids: string[]) => {
    const results = await Promise.allSettled(ids.map(id => api.del(`/api/v1/payments/${id}`)));
    const count = results.filter(r => r.status === 'fulfilled').length;
    setPayments(prev => prev.filter(p => !ids.includes(p.id)));
    setTotal(prev => Math.max(0, prev - count));
    return count;
  }, []);

  return { payments, loading, page, total, totalPages, PAGE_SIZE, refresh, create, process, refund, fail, remove, removeMany };
}
