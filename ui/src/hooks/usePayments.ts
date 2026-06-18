import { useState, useCallback } from 'react';
import { api } from '../api/client';
import type { Payment } from '../types';

export function usePayments() {
  const [payments, setPayments] = useState<Payment[]>([]);

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

  return { payments, create, process, refund, fail };
}
