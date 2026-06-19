import type { HealthStatus } from '../types';

type Tab = 'infra' | 'orders' | 'payments' | 'dataflow' | 'lifecycle' | 'testreport';

interface Props {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  health: HealthStatus | null;
}

export function Header({ tab, onTabChange, health }: Props) {
  const isHealthy = health?.status === 'healthy';

  return (
    <header className="header" data-testid="header">
      <div className="header-logo" data-testid="header-logo">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
        pw-kafka-be
        <span className="slash">/ dashboard</span>
      </div>

      <nav className="header-nav" data-testid="header-nav">
        <button
          className={`nav-tab ${tab === 'infra' ? 'active' : ''}`}
          onClick={() => onTabChange('infra')}
          data-testid="nav-tab-infra"
        >
          Infrastructure
        </button>
        <button
          className={`nav-tab ${tab === 'orders' ? 'active' : ''}`}
          onClick={() => onTabChange('orders')}
          data-testid="nav-tab-orders"
        >
          Orders
        </button>
        <button
          className={`nav-tab ${tab === 'payments' ? 'active' : ''}`}
          onClick={() => onTabChange('payments')}
          data-testid="nav-tab-payments"
        >
          Payments
        </button>

        <span style={{ width: 1, height: 18, background: 'var(--border)', flexShrink: 0 }} />

        <button
          className={`nav-tab ${tab === 'dataflow' ? 'active' : ''}`}
          onClick={() => onTabChange('dataflow')}
          data-testid="nav-tab-dataflow"
        >
          Data Flow
        </button>
        <button
          className={`nav-tab ${tab === 'lifecycle' ? 'active' : ''}`}
          onClick={() => onTabChange('lifecycle')}
          data-testid="nav-tab-lifecycle"
        >
          Lifecycle
        </button>
        <button
          className={`nav-tab ${tab === 'testreport' ? 'active' : ''}`}
          onClick={() => onTabChange('testreport')}
          data-testid="nav-tab-testreport"
        >
          Test Report
        </button>
      </nav>

      <div className="header-right">
        <div className="health-dot" data-testid="health-status" data-health={health?.status ?? 'connecting'}>
          {!health ? (
            <><div className="dot dot-amber" />Connecting…</>
          ) : isHealthy ? (
            <><div className="dot dot-green" />Healthy
              {health.uptime > 0 && <span style={{ marginLeft: 6, fontSize: 11, opacity: .6 }}>{health.uptime}s uptime</span>}
            </>
          ) : (
            <><div className="dot dot-red" />Unhealthy</>
          )}
        </div>
        <span className="version-tag" data-testid="version-tag">v{health?.version ?? '—'}</span>
      </div>
    </header>
  );
}
