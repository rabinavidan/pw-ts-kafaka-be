import { useState, useEffect } from 'react';
import { api } from '../api/client';
import type { HealthStatus } from '../types';

export function useHealth() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  useEffect(() => {
    const tick = () => api.get<HealthStatus>('/health').then(setHealth).catch(() => setHealth(null));
    tick();
    const iv = setInterval(tick, 5000);
    return () => clearInterval(iv);
  }, []);
  return health;
}
