import { useState, useCallback } from 'react';
import { api } from '../api/client';
import type { Order } from '../types';

const PAGE_SIZE = 15;

export function useOrders() {
  const [orders, setOrders]   = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage]       = useState(1);
  const [total, setTotal]     = useState(0);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const refresh = useCallback(async (status?: string, targetPage = 1) => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE) });
      if (status) q.set('status', status);
      const res = await api.get<{ items: Order[]; total: number; page: number }>(`/api/v1/orders?${q}`);
      setOrders(res.items);
      setTotal(res.total);
      setPage(res.page);
    } finally {
      setLoading(false);
    }
  }, []);

  const create = useCallback(async (payload: { userId: string; items: { productId: string; quantity: number }[]; currency: string }) => {
    const order = await api.post<Order>('/api/v1/orders', payload);
    setOrders(prev => [order, ...prev].slice(0, PAGE_SIZE));
    setTotal(prev => prev + 1);
    return order;
  }, []);

  const cancel = useCallback(async (id: string) => {
    const order = await api.put<Order>(`/api/v1/orders/${id}/cancel`);
    setOrders(prev => prev.map(o => (o.id === id ? order : o)));
    return order;
  }, []);

  const confirm = useCallback(async (id: string) => {
    const order = await api.put<Order>(`/api/v1/orders/${id}/confirm`);
    setOrders(prev => prev.map(o => (o.id === id ? order : o)));
    return order;
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.del<{ id: string; deleted: boolean }>(`/api/v1/orders/${id}`);
    setOrders(prev => prev.filter(o => o.id !== id));
    setTotal(prev => Math.max(0, prev - 1));
  }, []);

  const removeMany = useCallback(async (ids: string[]) => {
    const results = await Promise.allSettled(ids.map(id => api.del(`/api/v1/orders/${id}`)));
    const count = results.filter(r => r.status === 'fulfilled').length;
    setOrders(prev => prev.filter(o => !ids.includes(o.id)));
    setTotal(prev => Math.max(0, prev - count));
    return count;
  }, []);

  return { orders, loading, page, total, totalPages, PAGE_SIZE, refresh, create, cancel, confirm, remove, removeMany };
}
