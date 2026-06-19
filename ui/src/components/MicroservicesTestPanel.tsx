import { useState, useEffect, useCallback } from 'react';

type RunStatus = 'idle' | 'running' | 'done';

interface TestResult {
  title: string;
  group: string;
  status: 'passed' | 'failed';
  duration: number;
  error?: string | null;
}

interface ServiceTestResult {
  name: string;
  tests: TestResult[];
  passed: number;
  failed: number;
}

interface RunResult {
  services: ServiceTestResult[];
  stats: { expected?: number; unexpected?: number; duration?: number };
}

interface ServiceHealth {
  name: string;
  port: number;
  status: 'up' | 'down';
  latency: number;
  detail?: { uptime?: number; version?: string } | null;
}

interface ProjectResult {
  name: string;
  passed: number;
  failed: number;
}

interface AllRunResult {
  projects: ProjectResult[];
  stats: { expected?: number; unexpected?: number; duration?: number };
}

interface Props {
  onToast: (type: 'success' | 'error', message: string) => void;
}

const SVC_DEFS = [
  { suite: 'Orders Service (port 3001) @microservice',       port: 3001, label: 'Orders Service' },
  { suite: 'Payments Service (port 3002) @microservice',     port: 3002, label: 'Payments Service' },
  { suite: 'Events Service (port 3003) @microservice',       port: 3003, label: 'Events Service' },
  { suite: 'Notifications Service (port 3004) @microservice',port: 3004, label: 'Notification Service' },
];

function groupBy<T>(items: T[], key: (i: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(item);
  }
  return m;
}

export function MicroservicesTestPanel({ onToast }: Props) {
  const [runStatus, setRunStatus]       = useState<RunStatus>('idle');
  const [result, setResult]             = useState<RunResult | null>(null);
  const [elapsed, setElapsed]           = useState(0);
  const [healths, setHealths]           = useState<Record<number, ServiceHealth>>({});

  const [allRunStatus, setAllRunStatus] = useState<RunStatus>('idle');
  const [allResult, setAllResult]       = useState<AllRunResult | null>(null);
  const [allElapsed, setAllElapsed]     = useState(0);

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch('/api/v1/services/health');
        if (!r.ok) return;
        const data: { services: ServiceHealth[] } = await r.json();
        const map: Record<number, ServiceHealth> = {};
        for (const s of data.services) map[s.port] = s;
        setHealths(map);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 10_000);
    return () => clearInterval(id);
  }, []);

  const run = useCallback(async () => {
    setRunStatus('running');
    setResult(null);
    setElapsed(0);
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    try {
      const r = await fetch('/api/v1/run-tests/microservices', { method: 'POST' });
      const data: RunResult = await r.json();
      setResult(data);
      setRunStatus('done');
      const failed = data.services.reduce((n, s) => n + s.failed, 0);
      const passed = data.services.reduce((n, s) => n + s.passed, 0);
      if (failed === 0) onToast('success', `All ${passed} microservice tests passed`);
      else              onToast('error',   `${failed} microservice test(s) failed`);
    } catch {
      setRunStatus('idle');
      onToast('error', 'Failed to connect to test runner');
    } finally {
      clearInterval(timer);
    }
  }, [onToast]);

  const runAll = useCallback(async () => {
    setAllRunStatus('running');
    setAllResult(null);
    setAllElapsed(0);
    const start = Date.now();
    const timer = setInterval(() => setAllElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    try {
      const r = await fetch('/api/v1/run-tests/all', { method: 'POST' });
      const data: AllRunResult = await r.json();
      setAllResult(data);
      setAllRunStatus('done');
      const failed = data.projects.reduce((n, p) => n + p.failed, 0);
      const passed = data.projects.reduce((n, p) => n + p.passed, 0);
      if (failed === 0) onToast('success', `All ${passed} tests passed`);
      else              onToast('error',   `${failed} test(s) failed across all projects`);
    } catch {
      setAllRunStatus('idle');
      onToast('error', 'Failed to connect to test runner');
    } finally {
      clearInterval(timer);
    }
  }, [onToast]);

  const totalPassed = result?.services.reduce((n, s) => n + s.passed, 0) ?? 0;
  const totalFailed = result?.services.reduce((n, s) => n + s.failed, 0) ?? 0;

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto', height: '100%' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 2 }}>Microservice Test Dashboard</h2>
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>
            Run Playwright tests targeting each service on its own port (3001–3004)
          </p>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          {result && (
            <div style={{ fontSize: 12, display: 'flex', gap: 10 }}>
              <span style={{ color: 'var(--green)', fontWeight: 600 }}>{totalPassed} passed</span>
              {totalFailed > 0 && <span style={{ color: 'var(--red)', fontWeight: 600 }}>{totalFailed} failed</span>}
              {result.stats.duration !== undefined && (
                <span style={{ color: 'var(--muted)' }}>{(result.stats.duration / 1000).toFixed(1)}s</span>
              )}
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={run}
            disabled={runStatus === 'running'}
            data-testid="btn-run-microservice-tests"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {runStatus === 'running' && (
              <span style={{
                display: 'inline-block', width: 12, height: 12, flexShrink: 0,
                border: '2px solid rgba(255,255,255,.25)', borderTopColor: '#fff',
                borderRadius: '50%', animation: 'spin .7s linear infinite',
              }} />
            )}
            {runStatus === 'running' ? `Running… ${elapsed}s` : 'Run Tests'}
          </button>
        </div>
      </div>

      {/* 2-column grid of service cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(440px, 1fr))', gap: 16 }}>
        {SVC_DEFS.map(svc => {
          const health  = healths[svc.port];
          const svcRes  = result?.services.find(s => s.name === svc.suite);
          const grouped = svcRes ? groupBy(svcRes.tests, t => t.group) : null;
          const allPass = svcRes?.failed === 0;
          const hasFail = (svcRes?.failed ?? 0) > 0;

          return (
            <div
              key={svc.port}
              data-testid={`svc-card-${svc.port}`}
              style={{
                background:   'var(--card)',
                border:       `1px solid ${hasFail ? 'rgba(239,68,68,.4)' : allPass ? 'rgba(34,197,94,.25)' : 'var(--border)'}`,
                borderRadius: 10,
                overflow:     'hidden',
                display:      'flex',
                flexDirection:'column',
              }}
            >
              {/* Card header */}
              <div style={{
                padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 10,
                background: 'rgba(255,255,255,.02)', borderBottom: '1px solid var(--border)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{svc.label}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)', background: 'rgba(255,255,255,.06)', padding: '1px 6px', borderRadius: 4 }}>
                      :{svc.port}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, fontSize: 12 }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                      background:  !health ? 'var(--muted)' : health.status === 'up' ? 'var(--green)' : 'var(--red)',
                      boxShadow:   health?.status === 'up' ? '0 0 5px var(--green)' : 'none',
                    }} />
                    <span style={{ color: 'var(--muted)' }}>
                      {!health
                        ? 'checking…'
                        : health.status === 'up'
                          ? `up · ${health.latency}ms${health.detail?.uptime !== undefined ? ` · ${health.detail.uptime}s uptime` : ''}`
                          : 'down — service not running'}
                    </span>
                  </div>
                </div>

                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {svcRes ? (
                    <>
                      <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1, color: hasFail ? 'var(--red)' : 'var(--green)' }}>
                        {svcRes.passed}<span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>/{svcRes.passed + svcRes.failed}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>tests passed</div>
                    </>
                  ) : runStatus === 'running' ? (
                    <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,.2)', borderTopColor: 'var(--blue)', borderRadius: '50%', animation: 'spin .7s linear infinite', marginTop: 6 }} />
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>not run</span>
                  )}
                </div>
              </div>

              {/* Test results */}
              {grouped ? (
                <div style={{ padding: '6px 0', overflowY: 'auto', maxHeight: 340 }}>
                  {Array.from(grouped.entries()).map(([group, tests]) => (
                    <div key={group}>
                      <div style={{ padding: '7px 16px 3px', fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                        {group}
                      </div>
                      {tests.map((t, i) => (
                        <div key={i} title={t.error || undefined} style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '2px 16px' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, flexShrink: 0, color: t.status === 'passed' ? 'var(--green)' : 'var(--red)' }}>
                            {t.status === 'passed' ? '✓' : '✗'}
                          </span>
                          <span style={{ fontSize: 12, flex: 1, color: t.status === 'passed' ? 'var(--dim)' : 'var(--text)', lineHeight: 1.6 }}>
                            {t.title}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>
                            {t.duration}ms
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 12, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {runStatus === 'running' ? 'Running…' : 'Click "Run Tests" to see results'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Run All Tests section ─────────────────────────────────── */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 10, overflow: 'hidden',
      }}>
        {/* Section header */}
        <div style={{
          padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 14,
          borderBottom: allResult ? '1px solid var(--border)' : 'none',
          background: 'rgba(255,255,255,.02)',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>Full Test Suite</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Runs all Playwright projects: api · kafka · integration · microservices
            </div>
          </div>

          {allResult && (
            <div style={{ fontSize: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ color: 'var(--green)', fontWeight: 600 }}>
                {allResult.projects.reduce((n, p) => n + p.passed, 0)} passed
              </span>
              {allResult.projects.reduce((n, p) => n + p.failed, 0) > 0 && (
                <span style={{ color: 'var(--red)', fontWeight: 600 }}>
                  {allResult.projects.reduce((n, p) => n + p.failed, 0)} failed
                </span>
              )}
              {allResult.stats.duration !== undefined && (
                <span style={{ color: 'var(--muted)' }}>
                  {(allResult.stats.duration / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={runAll}
            disabled={allRunStatus === 'running' || runStatus === 'running'}
            data-testid="btn-run-all-tests"
            style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
          >
            {allRunStatus === 'running' && (
              <span style={{
                display: 'inline-block', width: 12, height: 12, flexShrink: 0,
                border: '2px solid rgba(255,255,255,.25)', borderTopColor: '#fff',
                borderRadius: '50%', animation: 'spin .7s linear infinite',
              }} />
            )}
            {allRunStatus === 'running' ? `Running… ${allElapsed}s` : 'Run All Tests'}
          </button>
        </div>

        {/* Per-project results */}
        {allResult && (
          <div style={{ padding: '8px 0' }}>
            {allResult.projects.map(proj => {
              const total  = proj.passed + proj.failed;
              const pct    = total > 0 ? proj.passed / total : 0;
              const allOk  = proj.failed === 0;
              return (
                <div key={proj.name} style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '7px 20px',
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: allOk ? 'var(--green)' : 'var(--red)',
                    boxShadow: allOk ? '0 0 5px var(--green)' : 'none',
                  }} />
                  <span style={{ width: 120, fontSize: 13, fontFamily: 'monospace', color: 'var(--dim)' }}>
                    {proj.name}
                  </span>
                  {/* Progress bar */}
                  <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,.06)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 3,
                      width: `${pct * 100}%`,
                      background: allOk ? 'var(--green)' : 'var(--red)',
                      transition: 'width .4s ease',
                    }} />
                  </div>
                  <span style={{ fontSize: 12, color: allOk ? 'var(--green)' : 'var(--red)', fontWeight: 600, width: 56, textAlign: 'right' }}>
                    {proj.passed}/{total}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', width: 80 }}>
                    {allOk ? 'all passed' : `${proj.failed} failed`}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Idle / loading placeholder */}
        {!allResult && (
          <div style={{ padding: '18px 20px', fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
            {allRunStatus === 'running'
              ? 'Running all projects… this may take a minute'
              : 'Click "Run All Tests" to run the full suite'}
          </div>
        )}
      </div>
    </div>
  );
}
