import { useState, useEffect, useCallback } from 'react';

interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: string;
  message: string;
  context: Record<string, unknown> | null;
  timestamp: string;
}

const PAGE_SIZE = 15;

const LEVEL_COLORS: Record<string, string> = {
  info:  '#3b82f6',
  warn:  '#f59e0b',
  error: '#ef4444',
  debug: '#8b5cf6',
};

const LEVEL_BG: Record<string, string> = {
  info:  'rgba(59,130,246,.12)',
  warn:  'rgba(245,158,11,.12)',
  error: 'rgba(239,68,68,.12)',
  debug: 'rgba(139,92,246,.12)',
};

export function LogsPanel() {
  const [logs, setLogs]         = useState<LogEntry[]>([]);
  const [level, setLevel]       = useState('all');
  const [search, setSearch]     = useState('');
  const [paused, setPaused]     = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading]   = useState(true);
  const [page, setPage]         = useState(1);
  const [total, setTotal]       = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const fetchLogs = useCallback(async (targetPage = 1, isPoll = false) => {
    if (isPoll && paused) return;
    try {
      const params = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE) });
      if (level !== 'all') params.set('level', level);
      if (search.trim()) params.set('search', search.trim());
      const res  = await fetch(`/api/v1/logs?${params}`);
      const data = await res.json();
      setLogs(data.logs ?? []);
      setTotal(data.total ?? 0);
      setPage(data.page ?? 1);
      setTotalPages(data.totalPages ?? 1);
    } catch {
      // silently ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, [level, search, paused]);

  useEffect(() => {
    setPage(1);
    fetchLogs(1);
  }, [level, search]);

  useEffect(() => {
    const id = setInterval(() => fetchLogs(page, true), 5000);
    return () => clearInterval(id);
  }, [fetchLogs, page]);

  function goToPage(p: number) {
    setPage(p);
    fetchLogs(p);
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div data-testid="logs-panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>

      {/* ── Top bar ── */}
      <div className="panel-top">
        <h2 className="panel-title">Server Logs</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search messages or sources…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--surface-2, var(--surface))', color: 'var(--text)', fontSize: 12, width: 220,
            }}
          />
          <button
            className={`btn btn-sm ${paused ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setPaused(p => !p)}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => fetchLogs(page)}>↺ Refresh</button>
        </div>
      </div>

      {/* ── Filter pills ── */}
      <div className="filter-pills">
        {(['all', 'info', 'warn', 'error', 'debug'] as const).map(l => (
          <button
            key={l}
            className={`pill ${level === l ? 'active' : ''}`}
            onClick={() => setLevel(l)}
            style={level === l && l !== 'all' ? { background: LEVEL_COLORS[l], borderColor: LEVEL_COLORS[l] } : undefined}
          >
            {l === 'all' ? `All (${total})` : l.charAt(0).toUpperCase() + l.slice(1)}
          </button>
        ))}
        {paused && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--amber)', fontWeight: 600 }}>● PAUSED</span>
        )}
      </div>

      {/* ── Table ── */}
      {loading ? (
        <div className="empty-state">
          <div className="empty-icon">⏳</div>
          <div className="empty-title">Loading logs…</div>
        </div>
      ) : logs.length === 0 ? (
        <div className="empty-state" data-testid="logs-empty">
          <div className="empty-icon">🗒️</div>
          <div className="empty-title">No logs yet</div>
          <div className="empty-sub">Server activity will appear here</div>
        </div>
      ) : (
        <div className="table-wrap" style={{ flex: 1, overflow: 'auto' }}>
          <table data-testid="logs-table" style={{ fontFamily: 'monospace' }}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Level</th>
                <th>Source</th>
                <th>Message</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <>
                  <tr
                    key={log.id}
                    onClick={() => log.context && toggleExpand(log.id)}
                    style={{
                      cursor: log.context ? 'pointer' : 'default',
                      background: expanded.has(log.id) ? LEVEL_BG[log.level] : undefined,
                    }}
                  >
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12 }}>
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span style={{
                        padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                        background: LEVEL_BG[log.level], color: LEVEL_COLORS[log.level],
                      }}>
                        {log.level.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--dim)', fontSize: 12 }}>{log.source}</td>
                    <td style={{ color: 'var(--text)', fontSize: 12 }}>{log.message}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {log.context && (expanded.has(log.id) ? '▲ ctx' : '▼ ctx')}
                    </td>
                  </tr>
                  {expanded.has(log.id) && log.context && (
                    <tr key={`${log.id}-ctx`} style={{ background: LEVEL_BG[log.level] }}>
                      <td colSpan={5} style={{ padding: '6px 16px 10px 40px' }}>
                        <pre style={{ margin: 0, fontSize: 11, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                          {JSON.stringify(log.context, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="pagination">
              <span className="pagination-info">
                {total} log{total !== 1 ? 's' : ''}
                <span style={{ color: 'var(--border)', margin: '0 2px' }}>·</span>
                page {page} of {totalPages}
              </span>
              <div className="pagination-pages">
                <button className="page-btn" onClick={() => goToPage(1)} disabled={page === 1}>«</button>
                <button className="page-btn" onClick={() => goToPage(page - 1)} disabled={page === 1}>‹</button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                  const p = start + i;
                  return p <= totalPages ? (
                    <button key={p} className={`page-btn ${p === page ? 'active' : ''}`} onClick={() => goToPage(p)}>{p}</button>
                  ) : null;
                })}
                <button className="page-btn" onClick={() => goToPage(page + 1)} disabled={page === totalPages}>›</button>
                <button className="page-btn" onClick={() => goToPage(totalPages)} disabled={page === totalPages}>»</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
