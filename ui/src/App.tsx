import { useState, useCallback } from 'react';
import { Header } from './components/Header';
import { OrdersPanel } from './components/OrdersPanel';
import { PaymentsPanel } from './components/PaymentsPanel';
import { EventFeed } from './components/EventFeed';
import { InfraPanel } from './components/InfraPanel';
import { useHealth } from './hooks/useHealth';
import type { Toast } from './types';

type Tab = 'infra' | 'orders' | 'payments';

export default function App() {
  const [tab, setTab]       = useState<Tab>('infra');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const health = useHealth();

  const addToast = useCallback((type: Toast['type'], message: string) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  return (
    <>
      <Header tab={tab} onTabChange={setTab} health={health} />
      <div className="app-body" data-testid="app-body">
        <main className="main-panel" data-testid="main-panel">
          {tab === 'infra'    && <InfraPanel />}
          {tab === 'orders'   && <OrdersPanel   onToast={addToast} />}
          {tab === 'payments' && <PaymentsPanel onToast={addToast} />}
        </main>
        {tab !== 'infra' && <EventFeed />}
      </div>

      {toasts.length > 0 && (
        <div className="toasts" data-testid="toast-container">
          {toasts.map(t => (
            <div key={t.id} className={`toast ${t.type}`} data-testid="toast" data-toast-type={t.type}>
              <span className="toast-icon">{t.type === 'success' ? '✓' : '✕'}</span>
              <span className="toast-msg" data-testid="toast-message">{t.message}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
