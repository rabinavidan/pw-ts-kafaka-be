import { useState, useEffect, useRef, useCallback } from 'react';

interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: string;
  message: string;
  context: Record<string, unknown> | null;
  timestamp: string;
}

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
  const [logs, setLogs]           = useState<LogEntry[]>([]);
  const [level, setLevel]         = useState('all');
  const [search, setSearch]       = useState('');
  const [paused, setPaused]       = useState(false);
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [loading, setLoading]     = useState(true);
  const pausedRef                 = useRef(paused);
  pausedRef.current               = paused;

  const fetchLogs = useCallback(async () => {
    if (pausedRef.current) return;
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (level !== 'all') params.set('level', level);
      if (search.trim()) params.set('search', search.trim());
      const res  = await fetch(`/api/v1/logs?${params}`);
      const data = await res.json();
      setLogs(data.logs ?? []);
    } catch {
      // silently ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, [level, search]);

  useEffect(() => {
    fetchLogs();
    const id = setInterval(fetchLogs, 3000);
    return () => clearInterval(id);
  }, [fetchLogs]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const counts = logs.reduce<Record<string, number>>((acc, l) => {
    acc[l.level] = (acc[l.level] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ padding: 20, height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Server Logs</span>

        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'info', 'warn', 'error', 'debug'] as const).map(l => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              style={{
                padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 12,
                background: level === l ? (l === 'all' ? 'var(--accent)' : LEVEL_COLORS[l]) : 'var(--surface-2)',
                color: level === l ? '#fff' : 'var(--text-2)',
                fontWeight: level === l ? 600 : 400,
              }}
            >
              {l}{l !== 'all' && counts[l] ? ` (${counts[l]})` : ''}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Search messages…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)',
            background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12, width: 200,
          }}
        />

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            onClick={() => setPaused(p => !p)}
            style={{
              padding: '4px 12px', borderRadius: 4, border: '1px solid var(--border)',
              background: paused ? 'var(--accent)' : 'var(--surface-2)',
              color: paused ? '#fff' : 'var(--text-2)', cursor: 'pointer', fontSize: 12,
            }}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button
            onClick={fetchLogs}
            style={{
              padding: '4px 12px', borderRadius: 4, border: '1px solid var(--border)',
              background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer', fontSize: 12,
            }}
          >
            ↺ Refresh
          </button>
        </div>
      </div>

      {/* stats bar */}
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-2)' }}>
        <span>{logs.length} entries</span>
        {(['info', 'warn', 'error'] as const).map(l => counts[l] ? (
          <span key={l} style={{ color: LEVEL_COLORS[l] }}>
            {counts[l]} {l}
          </span>
        ) : null)}
        {paused && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>● PAUSED</span>}
      </div>

      {/* log table */}
      <div style={{
        flex: 1, overflow: 'auto', borderRadius: 6, border: '1px solid var(--border)',
        background: 'var(--surface)', fontFamily: 'monospace',
      }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-2)' }}>Loading…</div>
        ) : logs.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-2)' }}>No logs yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)' }}>
                {['Time', 'Level', 'Source', 'Message', ''].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text-2)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <>
                  <tr
                    key={log.id}
                    onClick={() => log.context && toggleExpand(log.id)}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      cursor: log.context ? 'pointer' : 'default',
                      background: expanded.has(log.id) ? LEVEL_BG[log.level] : undefined,
                    }}
                  >
                    <td style={{ padding: '5px 10px', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </td>
                    <td style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}>
                      <span style={{
                        padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                        background: LEVEL_BG[log.level], color: LEVEL_COLORS[log.level],
                      }}>
                        {log.level.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '5px 10px', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                      {log.source}
                    </td>
                    <td style={{ padding: '5px 10px', color: 'var(--text)' }}>
                      {log.message}
                    </td>
                    <td style={{ padding: '5px 10px', color: 'var(--text-2)' }}>
                      {log.context && (
                        <span style={{ fontSize: 11 }}>{expanded.has(log.id) ? '▲' : '▼'} ctx</span>
                      )}
                    </td>
                  </tr>
                  {expanded.has(log.id) && log.context && (
                    <tr key={`${log.id}-ctx`} style={{ background: LEVEL_BG[log.level] }}>
                      <td colSpan={5} style={{ padding: '6px 16px 10px 40px' }}>
                        <pre style={{
                          margin: 0, fontSize: 11, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                        }}>
                          {JSON.stringify(log.context, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
