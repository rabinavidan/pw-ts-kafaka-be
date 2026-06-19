import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client';

type Svc = 'zookeeper' | 'kafka' | 'topics' | 'postgres' | 'gateway' | 'orders' | 'payments' | 'notifications' | 'events' | 'ui';
type SvcStatus = 'unknown' | 'starting' | 'up' | 'down';
type Statuses = Record<Svc, SvcStatus>;

interface LogLine { id: string; text: string; kind: 'run' | 'ok' | 'err' | 'info'; }

const TOPICS = ['orders', 'payments', 'notifications', 'dead-letter-queue', 'audit-events'];
const TOPIC_COLOR: Record<string, string> = {
  orders: '#3b82f6', payments: '#22c55e', notifications: '#a855f7',
  'dead-letter-queue': '#ef4444', 'audit-events': '#f59e0b',
};

const CARDS: {
  id: Svc; icon: string; name: string; port: string; desc: string; accent: string;
  docker: { image: string; container: string } | null;
  k8s: { resource: string; node: string; nodePort?: string };
}[] = [
  {
    id: 'zookeeper', icon: '🦒', name: 'Zookeeper', port: ':2181 · ClusterIP',
    desc: 'Cluster coordinator', accent: '#f59e0b',
    docker: { image: 'confluentinc/cp-zookeeper:7.6.0', container: 'zookeeper-0' },
    k8s: { resource: 'StatefulSet', node: 'desktop-worker' },
  },
  {
    id: 'kafka', icon: '📨', name: 'Kafka Broker', port: ':9092 · NodePort 30092',
    desc: 'Distributed event stream', accent: '#f0883e',
    docker: { image: 'confluentinc/cp-kafka:7.6.0', container: 'kafka-0' },
    k8s: { resource: 'StatefulSet', node: 'desktop-worker', nodePort: '30092' },
  },
  {
    id: 'topics', icon: '📋', name: 'Kafka Topics', port: '5 topics · 3 partitions',
    desc: 'RF=1 · kafka-init Job', accent: '#e3b341',
    docker: { image: 'confluentinc/cp-kafka:7.6.0', container: 'kafka-init' },
    k8s: { resource: 'Job (one-shot)', node: 'desktop-worker' },
  },
  {
    id: 'postgres', icon: '🐘', name: 'PostgreSQL', port: ':5432 · ClusterIP',
    desc: 'Orders · Payments · EventLog', accent: '#336791',
    docker: { image: 'postgres:16-alpine', container: 'postgres-0' },
    k8s: { resource: 'StatefulSet', node: 'desktop-worker' },
  },
  {
    id: 'gateway', icon: '⬛', name: 'API Gateway', port: ':3000 · NodePort 30300',
    desc: 'Routes → orders/payments/events', accent: '#8b5cf6',
    docker: null,
    k8s: { resource: 'Deployment', node: 'desktop-worker2', nodePort: '30300' },
  },
  {
    id: 'orders', icon: '📦', name: 'Orders Service', port: ':3001 · ClusterIP',
    desc: 'Orders CRUD + Kafka publish', accent: '#22c55e',
    docker: null,
    k8s: { resource: 'Deployment ×2', node: 'desktop-worker2' },
  },
  {
    id: 'payments', icon: '💳', name: 'Payments Service', port: ':3002 · ClusterIP',
    desc: 'Payments CRUD + Kafka publish', accent: '#06b6d4',
    docker: null,
    k8s: { resource: 'Deployment ×2', node: 'desktop-worker2' },
  },
  {
    id: 'notifications', icon: '🔔', name: 'Notification Svc', port: ':3004 · health only',
    desc: 'Kafka consumer → event_log', accent: '#a855f7',
    docker: null,
    k8s: { resource: 'Deployment', node: 'desktop-worker2' },
  },
  {
    id: 'events', icon: '📊', name: 'Events Service', port: ':3003 · ClusterIP',
    desc: 'Reads event_log for UI feed', accent: '#f59e0b',
    docker: null,
    k8s: { resource: 'Deployment', node: 'desktop-worker2' },
  },
  {
    id: 'ui', icon: '🎨', name: 'UI Dashboard', port: ':80 · NodePort 30080',
    desc: 'React dashboard (nginx)', accent: '#3b82f6',
    docker: null,
    k8s: { resource: 'Deployment', node: 'desktop-worker2', nodePort: '30080' },
  },
];

// [svc, startMsg, doneMsg, delayMs, durationMs]
const BUILD_STEPS: [Svc, string, string, number, number][] = [
  ['zookeeper',     '⬡ StatefulSet zookeeper → desktop-worker…',               '✓ zookeeper-0 Running · :2181',                              0,    900],
  ['kafka',         '⬡ StatefulSet kafka → desktop-worker (waits on ZK)…',      '✓ kafka-0 Running · :9092 · NodePort 30092',                 1000, 1200],
  ['topics',        '⬡ Job kafka-init → creating 5 topics…',                    '✓ orders · payments · notifications · dlq · audit-events',  2300, 600],
  ['postgres',      '⬡ StatefulSet postgres → desktop-worker…',                 '✓ postgres-0 Running · :5432 · schema applied',              3000, 800],
  ['notifications', '⬡ Deployment notification-service → desktop-worker2…',    '✓ notification-svc Running · subscribed to 5 topics',        3900, 700],
  ['orders',        '⬡ Deployment orders-service ×2 → desktop-worker2…',        '✓ orders-xxxxx + orders-yyyyy Running · :3001',              4700, 800],
  ['payments',      '⬡ Deployment payments-service ×2 → desktop-worker2…',      '✓ payments-xxxxx + payments-yyyyy Running · :3002',          5600, 800],
  ['events',        '⬡ Deployment events-service → desktop-worker2…',           '✓ events-svc Running · :3003',                              6500, 600],
  ['gateway',       '⬡ Deployment gateway → desktop-worker2 · NodePort 30300…', '✓ gateway Running · all services healthy',                  7200, 700],
  ['ui',            '⬡ Deployment ui → desktop-worker2 · nginx serving dist/…', '✓ All pods Ready · API http://172.19.0.3:30300',             8000, 400],
];

function statusColor(s: SvcStatus) {
  if (s === 'up')       return '#22c55e';
  if (s === 'starting') return '#f59e0b';
  if (s === 'down')     return '#ef4444';
  return '#1a2d47';
}

// ─── SVG Pod ──────────────────────────────────────────────────────────────────
interface SvgPodProps {
  x: number; y: number; w: number; h: number;
  icon: string; name: string; sub: string;
  accent: string; status: SvcStatus;
}

function SvgPod({ x, y, w, h, icon, name, sub, accent, status }: SvgPodProps) {
  const color  = statusColor(status);
  const border = status === 'up' ? accent : '#1a2d47';
  const glow   = status === 'up' ? `drop-shadow(0 0 5px ${accent}55)` : 'none';
  return (
    <g style={{ filter: glow, transition: 'filter .4s' }}>
      <rect x={x} y={y} width={w} height={h} rx={6} fill="#0a1628" stroke={border} strokeWidth={status === 'up' ? 1.5 : 1} />
      <text x={x + 8} y={y + 18} fontSize={10}>{icon}</text>
      <text x={x + 22} y={y + 18} fill={status === 'up' ? '#e2e8f0' : '#64748b'} fontSize={9} fontWeight="700">{name}</text>
      <text x={x + 22} y={y + 31} fill="#475569" fontSize={8}>{sub}</text>
      <circle cx={x + w - 8} cy={y + 10} r={4} fill={color}
        style={{ filter: status === 'up' ? `drop-shadow(0 0 4px ${color})` : 'none', transition: 'fill .4s' }} />
    </g>
  );
}

// ─── Topology SVG ─────────────────────────────────────────────────────────────
function Topology({ statuses }: { statuses: Statuses }) {
  const isUp = (id: Svc) => statuses[id] === 'up';
  const lineC = (a: Svc, b: Svc) => isUp(a) && isUp(b) ? '#2d4a6e' : '#1a2d47';

  return (
    <svg viewBox="0 0 920 420" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <marker id="tarr"        markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#2d4a6e" /></marker>
        <marker id="tarr-orange" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#f0883e" /></marker>
        <marker id="tarr-amber"  markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#f59e0b" /></marker>
        <marker id="tarr-purple" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#a855f7" /></marker>
        <marker id="tarr-violet" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#8b5cf6" /></marker>
      </defs>

      {/* Namespace boundary */}
      <rect x={4} y={4} width={912} height={412} rx={10} fill="none" stroke="#1e3a5f" strokeWidth={1} strokeDasharray="6 4" />
      <text x={18} y={20} fill="#2d5a8e" fontSize={10} fontWeight="600">⎈ namespace: pw-kafka-test</text>

      {/* Infra node */}
      <rect x={10} y={46} width={260} height={348} rx={8}
        fill="rgba(245,158,11,0.03)" stroke="#f59e0b" strokeWidth={1} strokeDasharray="5 3"
        opacity={isUp('zookeeper') ? 1 : 0.4} />
      <text x={18} y={62} fill="#f59e0b" fontSize={9} fontWeight="700" opacity={isUp('zookeeper') ? 1 : 0.4}>
        🖥 desktop-worker · role=infra
      </text>

      {/* App node */}
      <rect x={310} y={46} width={596} height={348} rx={8}
        fill="rgba(59,130,246,0.03)" stroke="#3b82f6" strokeWidth={1} strokeDasharray="5 3"
        opacity={isUp('gateway') ? 1 : 0.4} />
      <text x={318} y={62} fill="#3b82f6" fontSize={9} fontWeight="700" opacity={isUp('gateway') ? 1 : 0.4}>
        🖥 desktop-worker2 · role=app
      </text>

      {/* ── Infra pods ── */}
      <SvgPod x={20} y={72}  w={240} h={44} icon="🦒" name="zookeeper-0" sub="StatefulSet · :2181"  accent="#f59e0b" status={statuses.zookeeper} />
      <SvgPod x={20} y={132} w={240} h={44} icon="📨" name="kafka-0"      sub="StatefulSet · :9092"  accent="#f0883e" status={statuses.kafka}     />
      <SvgPod x={20} y={192} w={240} h={44} icon="📋" name="kafka-init"   sub="Job · 5 topics"       accent="#e3b341" status={statuses.topics}    />
      <SvgPod x={20} y={256} w={240} h={44} icon="🐘" name="postgres-0"   sub="StatefulSet · :5432"  accent="#336791" status={statuses.postgres}  />

      {/* ── App left-col pods ── */}
      <SvgPod x={320} y={72}  w={268} h={44} icon="⬛" name="gateway"          sub="Deployment · :3000 → NP:30300"  accent="#8b5cf6" status={statuses.gateway}       />
      <SvgPod x={320} y={132} w={268} h={44} icon="📦" name="orders-service"   sub="Deployment×2 · :3001"           accent="#22c55e" status={statuses.orders}        />
      <SvgPod x={320} y={192} w={268} h={44} icon="💳" name="payments-service" sub="Deployment×2 · :3002"           accent="#06b6d4" status={statuses.payments}      />
      <SvgPod x={320} y={256} w={268} h={44} icon="🔔" name="notification-svc" sub="Deployment · :3004"             accent="#a855f7" status={statuses.notifications} />
      <SvgPod x={320} y={320} w={268} h={44} icon="📊" name="events-service"   sub="Deployment · :3003"             accent="#f59e0b" status={statuses.events}        />

      {/* ── App right-col pods ── */}
      <SvgPod x={606} y={72} w={290} h={44} icon="🎨" name="ui" sub="Deployment · :80 → NP:30080" accent="#3b82f6" status={statuses.ui} />

      {/* ── Connection lines ── */}

      {/* ZK → Kafka (vertical) */}
      <line x1={140} y1={116} x2={140} y2={132} stroke={lineC('zookeeper','kafka')} strokeWidth={2} markerEnd="url(#tarr)" />
      <text x={144} y={126} fill="#475569" fontSize={8}>coordinates</text>

      {/* Kafka → kafka-init (vertical) */}
      <line x1={140} y1={176} x2={140} y2={192} stroke={lineC('kafka','topics')} strokeWidth={2} markerEnd="url(#tarr)" />
      <text x={144} y={186} fill="#475569" fontSize={8}>creates topics</text>

      {/* Kafka → orders (horizontal across boundary) */}
      <line x1={260} y1={150} x2={320} y2={150} stroke={lineC('kafka','orders')} strokeWidth={2} markerEnd="url(#tarr-orange)" />
      <text x={264} y={146} fill="#f0883e" fontSize={8}>kafka-svc:29092</text>

      {/* Kafka → payments (curved) */}
      <path d="M 260 162 Q 292 212 320 210" fill="none" stroke={lineC('kafka','payments')} strokeWidth={1} strokeDasharray="4 3" markerEnd="url(#tarr-orange)" />

      {/* orders/payments → Kafka (publish, dashed arc over top) */}
      <path d="M 395 132 C 360 72 240 72 215 132" fill="none"
        stroke={isUp('orders') ? '#f0883e' : '#2a1f1a'}
        strokeWidth={1.5} strokeDasharray="5 4" markerEnd="url(#tarr-orange)" />
      <text x={292} y={64} textAnchor="middle" fill={isUp('orders') ? '#f0883e' : '#3a2a20'} fontSize={9}>publish events</text>

      {/* Kafka → notifications (consume, dashed purple) */}
      <path d="M 256 162 Q 288 264 320 274" fill="none"
        stroke={isUp('kafka') ? '#a855f7' : '#1a2d47'}
        strokeWidth={1.5} strokeDasharray="4 3" markerEnd="url(#tarr-purple)" />
      <text x={278} y={226} fill={isUp('kafka') ? '#a855f7' : '#1a2d47'} fontSize={8}>consume</text>

      {/* gateway → orders */}
      <line x1={440} y1={116} x2={440} y2={132} stroke={lineC('gateway','orders')} strokeWidth={2} markerEnd="url(#tarr-violet)" />

      {/* gateway → payments */}
      <line x1={450} y1={116} x2={450} y2={192} stroke={lineC('gateway','payments')} strokeWidth={1} strokeDasharray="3 2" markerEnd="url(#tarr-violet)" />

      {/* gateway → events */}
      <line x1={460} y1={116} x2={460} y2={320} stroke={lineC('gateway','events')} strokeWidth={1} strokeDasharray="3 2" markerEnd="url(#tarr-violet)" />
      <text x={464} y={230} fill={isUp('gateway') ? '#8b5cf6' : '#1a2d47'} fontSize={8}>route</text>

      {/* notifications → postgres (write event_log) */}
      <path d="M 320 284 Q 220 314 160 308" fill="none"
        stroke={isUp('notifications') ? '#a855f7' : '#1a2d47'}
        strokeWidth={1} strokeDasharray="3 2" markerEnd="url(#tarr-purple)" />
      <text x={215} y={320} fill={isUp('notifications') ? '#a855f7' : '#1a2d47'} fontSize={7}>write event_log</text>

      {/* events → postgres (read event_log) */}
      <path d="M 320 348 Q 200 372 160 310" fill="none"
        stroke={isUp('events') ? '#f59e0b' : '#1a2d47'}
        strokeWidth={1} strokeDasharray="3 2" markerEnd="url(#tarr-amber)" />
      <text x={200} y={374} fill={isUp('events') ? '#f59e0b' : '#1a2d47'} fontSize={7}>read event_log</text>

      {/* NodePort annotations */}
      <text x={55}  y={406} fill="#f0883e" fontSize={8} opacity={0.7}>⬡ NP:30092 → KAFKA_BROKERS</text>
      <text x={355} y={406} fill="#8b5cf6" fontSize={8} opacity={0.7}>⬡ NP:30300 → API_BASE_URL</text>
      <text x={676} y={406} fill="#3b82f6" fontSize={8} opacity={0.7}>⬡ NP:30080 → Browser</text>
    </svg>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export function InfraPanel() {
  const [statuses, setStatuses] = useState<Statuses>({
    zookeeper: 'unknown', kafka: 'unknown', topics: 'unknown', postgres: 'unknown',
    gateway: 'unknown', orders: 'unknown', payments: 'unknown',
    notifications: 'unknown', events: 'unknown', ui: 'up',
  });
  const [log,      setLog]      = useState<LogLine[]>([]);
  const [building, setBuilding] = useState(false);
  const [built,    setBuilt]    = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const poll = () =>
      api.get<{ status: string; dependencies: { name: string; status: string }[] }>('/health')
        .then(h => {
          const dep = (name: string) =>
            h.dependencies.find(d => d.name === name)?.status === 'up' ? 'up' : 'down';
          const ordersUp = dep('orders') === 'up';
          const kafkaUp  = ordersUp || dep('payments') === 'up';
          const dbUp     = ordersUp || dep('events') === 'up';
          setStatuses(prev => ({
            ...prev,
            gateway:       h.status === 'healthy' ? 'up' : 'down',
            orders:        dep('orders') as SvcStatus,
            payments:      dep('payments') as SvcStatus,
            events:        dep('events') as SvcStatus,
            notifications: dep('notifications') as SvcStatus,
            kafka:         kafkaUp ? 'up' : 'down',
            zookeeper:     kafkaUp ? 'up' : 'down',
            topics:        kafkaUp ? 'up' : 'down',
            postgres:      dbUp    ? 'up' : 'down',
            ui:            'up',
          }));
        })
        .catch(() => setStatuses(prev => ({ ...prev, gateway: 'down' })));
    poll();
    const iv = setInterval(poll, 4000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const addLog = useCallback((text: string, kind: LogLine['kind']) =>
    setLog(prev => [...prev, { id: crypto.randomUUID(), text, kind }]), []);

  const startBuild = useCallback(() => {
    if (building) return;
    setBuilding(true);
    setBuilt(false);
    setLog([]);
    setStatuses({
      zookeeper: 'unknown', kafka: 'unknown', topics: 'unknown', postgres: 'unknown',
      gateway: 'unknown', orders: 'unknown', payments: 'unknown',
      notifications: 'unknown', events: 'unknown', ui: 'up',
    });

    timers.current.forEach(clearTimeout);
    timers.current = [];

    addLog('▸ kubectl apply -f k8s/', 'info');
    addLog('  namespace/pw-kafka-test created · configmap/kafka-config created', 'info');

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
            addLog('▸ API     → http://172.19.0.3:30300', 'info');
            addLog('▸ UI      → http://172.19.0.3:30080', 'info');
            addLog('▸ Kafka   → KAFKA_BROKERS=172.19.0.3:30092', 'info');
            addLog('▸ pgAdmin → http://localhost:5050', 'info');
            setBuilding(false);
            setBuilt(true);
          }, 200);
        }
      }, delay + duration);

      timers.current.push(t1, t2);
    });
  }, [building, addLog]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const upCount = Object.values(statuses).filter(s => s === 'up').length;
  const allUp   = upCount === Object.keys(statuses).length;

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
            ? <><span className="spin">⟳</span> Deploying…</>
            : built ? '↺ Redeploy' : '▶  Deploy to K8s'}
        </button>
      </div>

      {/* ── K8s Cluster Banner ── */}
      <div className="k8s-banner">
        <span className="k8s-banner-title">⎈ Kubernetes</span>
        <span className="k8s-banner-pill">kind v1.34.3</span>
        <span className="k8s-banner-pill">3 nodes</span>
        <span className="k8s-banner-pill">ns: pw-kafka-test</span>
        <span className="k8s-banner-sep" />
        <span className="k8s-node k8s-node-cp">desktop-control-plane <em>tainted</em></span>
        <span className="k8s-node k8s-node-infra">desktop-worker <em>role=infra</em></span>
        <span className="k8s-node k8s-node-app">desktop-worker2 <em>role=app</em></span>
      </div>

      {/* ── Service cards ── */}
      <div className="svc-grid">
        {CARDS.map(c => {
          const s = statuses[c.id];
          return (
            <div key={c.id} className={`svc-card svc-${s}`}
              style={{ '--svc-accent': c.accent } as React.CSSProperties}>
              <div className="svc-card-top">
                <span className="svc-icon">{c.icon}</span>
                <div className="svc-status-row">
                  <span className="svc-dot" style={{
                    background: statusColor(s),
                    boxShadow: s === 'up' ? `0 0 7px ${statusColor(s)}` : 'none',
                  }} />
                  <span className="svc-status-txt">
                    {s === 'starting' ? 'starting…' : s === 'up' ? 'running' : s === 'down' ? 'offline' : 'unknown'}
                  </span>
                </div>
              </div>
              <div className="svc-name">{c.name}</div>
              <div className="svc-port">{c.port}</div>
              <div className="svc-desc">{c.desc}</div>
              <div className="svc-k8s">
                <span className="svc-k8s-icon">⎈</span>
                <div className="svc-k8s-lines">
                  <span className="svc-k8s-resource">{c.k8s.resource}</span>
                  <span className="svc-k8s-node">{c.k8s.node}</span>
                </div>
              </div>
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
                  <span className="svc-docker-whale">📦</span>
                  <span className="svc-docker-image">custom image (Dockerfile)</span>
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
            <span key={t} className="topic-badge"
              style={{ borderColor: TOPIC_COLOR[t] + '55', color: TOPIC_COLOR[t] }}>
              {t}
            </span>
          ))}
          <span className="topic-meta">3 partitions · RF=1 · created by kafka-init Job</span>
        </div>
      </div>

      {/* ── K8s Topology ── */}
      <div className="topo-section">
        <div className="section-label">Kubernetes Topology</div>
        <div className="topo-wrap">
          <Topology statuses={statuses} />
        </div>
      </div>

      {/* ── Deploy log ── */}
      {log.length > 0 && (
        <div className="build-log-section">
          <div className="section-label">
            Deploy Output
            {building && <span className="log-spinner">⟳</span>}
          </div>
          <div className="build-log" ref={logRef}>
            {log.map(l => (
              <div key={l.id} className={`log-line log-${l.kind}`}>{l.text}</div>
            ))}
            {building && <div className="log-cursor" />}
          </div>
        </div>
      )}
    </div>
  );
}
