import { useState, useEffect } from 'react';
import { api } from '../api/client';
import type { KafkaEvent } from '../types';

export function useEvents() {
  const [events, setEvents] = useState<KafkaEvent[]>([]);
  useEffect(() => {
    const tick = () =>
      api.get<{ events: KafkaEvent[] }>('/api/v1/events?limit=30')
        .then(r => setEvents(r.events))
        .catch(() => {});
    tick();
    const iv = setInterval(tick, 2000);
    return () => clearInterval(iv);
  }, []);
  return events;
}
