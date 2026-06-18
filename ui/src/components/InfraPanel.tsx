import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client';
import type { HealthStatus } from '../types';

type Svc = 'zookeeper' | 'kafka' | 'topics' | 'mockserver' | 'ui';
type SvcStatus = 'unknown' | 'starting' | 'up' | 'down';
type Statuses = Record<Svc, SvcStatus>;

interface LogLine { id: string; text: string; kind: 'run' | 'ok' | 'err' | 'info'; }

const TOPICS = ['orders', 'payments', 'notifications', 'dead-letter-queue', 'audit-events'];
const TOPIC_COLOR: Record<string, string> = {
  orders: '#3b82f6',
  payments: '#22c55e',
  notifications: '#a855f7',
  'dead-letter-queue': '#ef4444',
  'audit-events': '#f59e0b',
};

const CARDS: {
  id: Svc; icon: string; name: string; port: string; desc: string; accent: string;
  docker: { image: string; container: string } | null;
}[] = [
  { id: 'zookeeper',  icon: '🦒', name: 'Zookeeper',    port: ':2181',    desc: 'Cluster coordinator',      accent: '#f59e0b', docker: { image: 'confluentinc/cp-zookeeper:7.6.0', container: 'zookeeper'  } },
  { id: 'kafka',      icon: '📨', name: 'Kafka Broker', port: ':9092',    desc: 'Distributed event stream', accent: '#f0883e', docker: { image: 'confluentinc/cp-kafka:7.6.0',      container: 'kafka'      } },
  { id: 'topics',     icon: '📋', name: 'Kafka Topics', port: '5 topics', desc: '3 partitions · RF=1',      accent: '#e3b341', docker: { image: 'confluentinc/cp-kafka:7.6.0',      container: 'kafka-init' } },
  { id: 'mockserver', icon: '🖥️', name: 'Mock Server',  port: ':3000',    desc: 'REST API + KafkaJS pub',   accent: '#22c55e', docker: null },
  { id: 'ui',         icon: '🎨', name: 'UI Dashboard', port: ':5173',    desc: 'React test dashboard',     accent: '#3b82f6', docker: null },
];

// [svc, startMsg, doneMsg, delayMs, durationMs]
const BUILD_STEPS: [Svc, string, string, number, number][] = [
  ['zookeeper',  '⬡ Starting Zookeeper container (confluentinc/cp-zookeeper:7.6.0)…',         '✓ Zookeeper ready · :2181 · healthcheck passed',                           0,    950 ],
  ['kafka',      '⬡ Starting Kafka Broker (confluentinc/cp-kafka:7.6.0, waits on ZK)…',       '✓ Kafka Broker ready · :9092 · auto-topic-create enabled',                  1050, 1300],
  ['topics',     '⬡ kafka-init: creating 5 topics (3 partitions, replication-factor=1)…',      '✓ orders · payments · notifications · dead-letter-queue · audit-events',     2450, 600 ],
  ['mockserver', '⬡ Starting Mock Server · wiring KafkaJS producer to :9092…',                '✓ Mock Server :3000 healthy · producer connected · eventLog active',          3150, 900 ],
  ['ui',         '⬡ UI connecting to Mock Server REST API…',                                   '✓ All systems operational · dashboard live',                                4150, 220 ],
];

function statusColor(s: SvcStatus) {
  if (s === 'up')       return '#22c55e';
  if (s === 'starting') return '#f59e0b';
  if (s === 'down')     return '#ef4444';
  return '#1a2d47';
}

// ─── Topology SVG ────────────────────────────────────────────────────────────
function Topology({ statuses }: { statuses: Statuses }) {
  const N = {
    zookeeper:  { x: 24,  y: 88,  w: 128, h: 54, label: 'Zookeeper',    sub: ':2181',     icon: '🦒', accent: '#f59e0b' },
    kafka:      { x: 246, y: 88,  w: 138, h: 54, label: 'Kafka Broker', sub: ':9092',     icon: '📨', accent: '#f0883e' },
    topics:     { x: 246, y: 204, w: 138, h: 54, label: 'Topics × 5',   sub: '3 parts ea',icon: '📋', accent: '#e3b341' },
    mockserver: { x: 488, y: 88,  w: 138, h: 54, label: 'Mock Server',  sub: ':3000',     icon: '🖥️', accent: '#22c55e' },
    ui:         { x: 724, y: 88,  w: 112, h: 54, label: 'UI',           sub: ':5173',     icon: '🎨', accent: '#3b82f6' },
  } as const;

  type NKey = keyof typeof N;
  const cx = (id: NKey) => N[id].x + N[id].w / 2;
  const cy = (id: NKey) => N[id].y + N[id].h / 2;
  const sc  = (id: Svc) => statusColor(statuses[id]);
  const isUp = (id: Svc) => statuses[id] === 'up';

  const lineColor = (a: Svc, b: Svc) =>
    isUp(a) && isUp(b) ? '#2d4a6e' : '#1a2d47';

  return (
    <svg viewBox="0 0 868 278" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <marker id="tarr"     markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <path d="M0,0 L8,3 L0,6 Z" fill="#2d4a6e" />
        </marker>
        <marker id="tarr-pub" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <path d="M0,0 L8,3 L0,6 Z" fill="#f0883e" />
        </marker>
        <marker id="tarr-live" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <path d="M0,0 L8,3 L0,6 Z" fill="#2d4a6e" />
        </marker>
      </defs>

      {/* ZK → Kafka · coordinates */}
      <line
        x1={N.zookeeper.x + N.zookeeper.w + 2} y1={cy('zookeeper')}
        x2={N.kafka.x - 2}                       y2={cy('kafka')}
        stroke={lineColor('zookeeper', 'kafka')} strokeWidth="2" markerEnd="url(#tarr)"
      />
      <text
        x={(N.zookeeper.x + N.zookeeper.w + N.kafka.x) / 2} y={cy('zookeeper') - 9}
        textAnchor="middle" fill="#475569" fontSize="10"
      >coordinates</text>

      {/* Kafka ↓ Topics · stores events */}
      <line
        x1={cx('kafka')} y1={N.kafka.y + N.kafka.h + 2}
        x2={cx('topics')} y2={N.topics.y - 2}
        stroke={lineColor('kafka', 'topics')} strokeWidth="2" markerEnd="url(#tarr)"
      />
      <text
        x={cx('kafka') + 12} y={(N.kafka.y + N.kafka.h + N.topics.y) / 2 + 4}
        fill="#475569" fontSize="10"
      >stores events</text>

      {/* Kafka → MockServer · consumes / health */}
      <line
        x1={N.kafka.x + N.kafka.w + 2} y1={cy('kafka')}
        x2={N.mockserver.x - 2}          y2={cy('mockserver')}
        stroke={lineColor('kafka', 'mockserver')} strokeWidth="2" markerEnd="url(#tarr)"
      />

      {/* MockServer → Kafka · publish (dashed curved over top) */}
      <path
        d={`M ${cx('mockserver')} ${N.mockserver.y - 2}
            Q ${cx('mockserver')} 28 ${cx('kafka')} 28
            L ${cx('kafka')} ${N.kafka.y - 2}`}
        stroke={isUp('mockserver') ? '#f0883e' : '#2a1f1a'}
        strokeWidth="1.5" strokeDasharray="5 4" fill="none"
        markerEnd="url(#tarr-pub)"
      />
      <text
        x={(cx('kafka') + cx('mockserver')) / 2} y="22"
        textAnchor="middle"
        fill={isUp('mockserver') ? '#f0883e' : '#3a2a20'}
        fontSize="10"
      >publish events</text>

      {/* MockServer → UI · REST + events */}
      <line
        x1={N.mockserver.x + N.mockserver.w + 2} y1={cy('mockserver')}
        x2={N.ui.x - 2}                           y2={cy('ui')}
        stroke={lineColor('mockserver', 'ui')} strokeWidth="2" markerEnd="url(#tarr)"
      />
      <text
        x={(N.mockserver.x + N.mockserver.w + N.ui.x) / 2} y={cy('mockserver') - 9}
        textAnchor="middle" fill="#475569" fontSize="10"
      >REST + events</text>

      {/* ── Nodes ── */}
      {(Object.entries(N) as [NKey, (typeof N)[NKey]][]).map(([id, n]) => {
        const s      = statuses[id as Svc];
        const border = s === 'up' ? n.accent : '#1a2d47';
        const glow   = s === 'up' ? `drop-shadow(0 0 5px ${n.accent}55)` : 'none';
        return (
          <g key={id} style={{ filter: glow, transition: 'filter .4s' }}>
            <rect
              x={n.x} y={n.y} width={n.w} height={n.h} rx="9"
              fill="#0a1628" stroke={border} strokeWidth={s === 'up' ? 1.5 : 1}
              style={{ transition: 'stroke .4s' }}
            />
            {/* icon */}
            <text x={n.x + 12} y={n.y + 24} fontSize="15">{n.icon}</text>
            {/* name */}
            <text
              x={n.x + 34} y={n.y + 23}
              fill={s === 'up' ? '#e2e8f0' : '#64748b'} fontSize="11" fontWeight="600"
              style={{ transition: 'fill .4s' }}
            >{n.label}</text>
            {/* sub */}
            <text x={n.x + 34} y={n.y + 38} fill="#475569" fontSize="10">{n.sub}</text>
            {/* status dot */}
            <circle
              cx={n.x + n.w - 12} cy={n.y + 14} r="4.5"
              fill={sc(id as Svc)}
              style={{ filter: s === 'up' ? `drop-shadow(0 0 4px ${sc(id as Svc)})` : 'none', transition: 'fill .4s' }}
            />
          </g>
        );
      })}

      {/* Playwright annotation */}
      <text x="488" y="236" fill="#475569" fontSize="10" fontStyle="italic">▸ Playwright tests call Mock Server REST API</text>
      <text x="488" y="250" fill="#475569" fontSize="10" fontStyle="italic">▸ Playwright KafkaHelper subscribes to Topics directly</text>
    </svg>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function InfraPanel() {
  const [statuses, setStatuses] = useState<Statuses>({
    zookeeper: 'unknown', kafka: 'unknown', topics: 'unknown',
    mockserver: 'unknown', ui: 'up',
  });
  const [log,      setLog]      = useState<LogLine[]>([]);
  const [building, setBuilding] = useState(false);
  const [built,    setBuilt]    = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // Real health polling
  useEffect(() => {
    const poll = () =>
      api.get<HealthStatus>('/health')
        .then(h => {
          const kafkaUp = h.dependencies.find(d => d.name === 'kafka')?.status === 'up';
          setStatuses(prev => ({
            ...prev,
            mockserver: h.status === 'healthy' ? 'up' : 'down',
            kafka:      kafkaUp ? 'up' : 'down',
            zookeeper:  kafkaUp ? 'up' : 'down',
            topics:     kafkaUp ? 'up' : 'down',
            ui: 'up',
          }));
        })
        .catch(() => setStatuses(prev => ({ ...prev, mockserver: 'down' })));
    poll();
    const iv = setInterval(poll, 4000);
    return () => clearInterval(iv);
  }, []);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const addLog = useCallback((text: string, kind: LogLine['kind']) =>
    setLog(prev => [...prev, { id: crypto.randomUUID(), text, kind }]),
  []);

  const startBuild = useCallback(() => {
    if (building) return;
    setBuilding(true);
    setBuilt(false);
    setLog([]);
    setStatuses({ zookeeper: 'unknown', kafka: 'unknown', topics: 'unknown', mockserver: 'unknown', ui: 'up' });

    timers.current.forEach(clearTimeout);
    timers.current = [];

    addLog('▸ docker-compose up -d', 'info');

    BUILD_STEPS.forEach(([svc, msg, done, delay, duration]) => {
      const t1 = setTimeout(() => {
        addLog(msg, 'run');
        setStatuses(prev => ({ ...prev, [svc]: 'starting' }));
      }, delay + 120);

      const t2 = setTimeout(() => {
        addLog(done, 'ok');
        setStatuses(prev => ({ ...prev, [svc]: 'up' }));
        if (svc === 'ui') {
          setTimeout(() => {
            addLog('▸ Stack ready — run: npx playwright test', 'info');
            setBuilding(false);
            setBuilt(true);
          }, 200);
        }
      }, delay + duration);

      timers.current.push(t1, t2);
    });
  }, [building, addLog]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const upCount  = Object.values(statuses).filter(s => s === 'up').length;
  const allUp    = upCount === Object.keys(statuses).length;

  return (
    <div className="infra-panel">

      {/* ── Header ── */}
      <div className="infra-head">
        <div>
          <div className="panel-title">Infrastructure</div>
          <div className="infra-sub">
            {allUp
              ? `All ${upCount} services operational`
              : `${upCount} / ${Object.keys(statuses).length} services running`}
          </div>
        </div>
        <button
          className={`btn ${building ? 'btn-ghost' : built ? 'btn-success' : 'btn-primary'} build-btn`}
          onClick={startBuild}
          disabled={building}
        >
          {building
            ? <><span className="spin">⟳</span> Building…</>
            : built
              ? '↺ Rebuild Stack'
              : '▶  Build Stack'}
        </button>
      </div>

      {/* ── Service cards ── */}
      <div className="svc-grid">
        {CARDS.map(c => {
          const s = statuses[c.id];
          return (
            <div
              key={c.id}
              className={`svc-card svc-${s}`}
              style={{ '--svc-accent': c.accent } as React.CSSProperties}
            >
              <div className="svc-card-top">
                <span className="svc-icon">{c.icon}</span>
                <div className="svc-status-row">
                  <span
                    className="svc-dot"
                    style={{
                      background: statusColor(s),
                      boxShadow: s === 'up' ? `0 0 7px ${statusColor(s)}` : 'none',
                    }}
                  />
                  <span className="svc-status-txt">
                    {s === 'starting' ? 'starting…' : s === 'up' ? 'running' : s === 'down' ? 'offline' : 'unknown'}
                  </span>
                </div>
              </div>
              <div className="svc-name">{c.name}</div>
              <div className="svc-port">{c.port}</div>
              <div className="svc-desc">{c.desc}</div>
              {c.docker ? (
                <div className="svc-docker">
                  <span className="svc-docker-whale">🐳</span>
                  <div className="svc-docker-lines">
                    <span className="svc-docker-image">{c.docker.image}</span>
                    <span className="svc-docker-container">{c.docker.container}</span>
                  </div>
                </div>
              ) : (
                <div className="svc-docker svc-docker-local">
                  <span className="svc-docker-whale">⬡</span>
                  <span className="svc-docker-image">local process</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Kafka Topics ── */}
      <div className="topics-section">
        <div className="section-label">Kafka Topics</div>
        <div className="topics-row">
          {TOPICS.map(t => (
            <span
              key={t}
              className="topic-badge"
              style={{ borderColor: TOPIC_COLOR[t] + '55', color: TOPIC_COLOR[t] }}
            >
              {t}
            </span>
          ))}
          <span className="topic-meta">3 partitions · RF=1 · auto-create enabled</span>
        </div>
      </div>

      {/* ── Connection Topology ── */}
      <div className="topo-section">
        <div className="section-label">Connection Topology</div>
        <div className="topo-wrap">
          <Topology statuses={statuses} />
        </div>
      </div>

      {/* ── Build log ── */}
      {log.length > 0 && (
        <div className="build-log-section">
          <div className="section-label">
            Build Output
            {building && <span className="log-spinner">⟳</span>}
          </div>
          <div className="build-log" ref={logRef}>
            {log.map(l => (
              <div key={l.id} className={`log-line log-${l.kind}`}>
                {l.text}
              </div>
            ))}
            {building && <div className="log-cursor" />}
          </div>
        </div>
      )}
    </div>
  );
}
