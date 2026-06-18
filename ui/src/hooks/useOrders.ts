import { useState, useCallback } from 'react';
import { api } from '../api/client';
import type { Order } from '../types';

export function useOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (status?: string) => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ pageSize: '100' });
      if (status) q.set('status', status);
      const res = await api.get<{ items: Order[] }>(`/api/v1/orders?${q}`);
      setOrders(res.items);
    } finally {
      setLoading(false);
    }
  }, []);

  const create = useCallback(async (payload: { userId: string; items: { productId: string; quantity: number }[]; currency: string }) => {
    const order = await api.post<Order>('/api/v1/orders', payload);
    setOrders(prev => [order, ...prev]);
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

  return { orders, loading, refresh, create, cancel, confirm };
}
