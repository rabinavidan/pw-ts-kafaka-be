import { useState, useCallback, useEffect } from 'react';
import { api } from '../api/client';
import type { Payment } from '../types';

export function usePayments() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (status?: string) => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ pageSize: '200' });
      if (status) q.set('status', status);
      const res = await api.get<{ items: Payment[] }>(`/api/v1/payments?${q}`);
      setPayments(res.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = useCallback(async (payload: { orderId: string; method: string; simulateFailure?: boolean }) => {
    const payment = await api.post<Payment>('/api/v1/payments', payload);
    setPayments(prev => [payment, ...prev]);
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
  }, []);

  const removeMany = useCallback(async (ids: string[]) => {
    const results = await Promise.allSettled(ids.map(id => api.del(`/api/v1/payments/${id}`)));
    const count = results.filter(r => r.status === 'fulfilled').length;
    setPayments(prev => prev.filter(p => !ids.includes(p.id)));
    return count;
  }, []);

  return { payments, loading, refresh, create, process, refund, fail, remove, removeMany };
}
