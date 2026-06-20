import { useState, useCallback } from 'react';
import { Header } from './components/Header';
import { OrdersPanel } from './components/OrdersPanel';
import { PaymentsPanel } from './components/PaymentsPanel';
import { EventFeed } from './components/EventFeed';
import { InfraPanel } from './components/InfraPanel';
import { HtmlViewer } from './components/HtmlViewer';
import { MicroservicesTestPanel } from './components/MicroservicesTestPanel';
import { LogsPanel } from './components/LogsPanel';
import { useHealth } from './hooks/useHealth';
import type { Toast } from './types';

type Tab = 'infra' | 'orders' | 'payments' | 'dataflow' | 'lifecycle' | 'testreport' | 'svctest' | 'logs';

export default function App() {
  const [tab, setTab]       = useState<Tab>('orders');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const health = useHealth();

  const addToast = useCallback((type: Toast['type'], message: string) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const isHtmlTab  = tab === 'dataflow' || tab === 'lifecycle' || tab === 'testreport';
  const isSvcTest  = tab === 'svctest';
  const isLogsTab  = tab === 'logs';

  return (
    <>
      <Header tab={tab} onTabChange={setTab} health={health} />

      {isHtmlTab ? (
        <div className="html-tab-body" data-testid="app-body">
          {tab === 'dataflow'   && <HtmlViewer src="/dataflow.html"    title="Data Flow" />}
          {tab === 'lifecycle'  && <HtmlViewer src="/lifecycle.html"   title="Lifecycle" />}
          {tab === 'testreport' && <HtmlViewer src="/test-report.html" title="Test Report" />}
        </div>
      ) : isSvcTest ? (
        <div className="app-body" data-testid="app-body" style={{ display: 'block', overflowY: 'auto' }}>
          <MicroservicesTestPanel onToast={addToast} />
        </div>
      ) : isLogsTab ? (
        <div className="app-body" data-testid="app-body" style={{ display: 'block', overflowY: 'auto' }}>
          <LogsPanel />
        </div>
      ) : (
        <div className="app-body" data-testid="app-body">
          <main className="main-panel" data-testid="main-panel">
            {tab === 'infra'    && <InfraPanel />}
            {tab === 'orders'   && <OrdersPanel   onToast={addToast} />}
            {tab === 'payments' && <PaymentsPanel onToast={addToast} />}
          </main>
          {(tab === 'orders' || tab === 'payments') && <EventFeed />}
        </div>
      )}

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
