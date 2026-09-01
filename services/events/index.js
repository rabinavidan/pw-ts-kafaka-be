require('dotenv').config({ override: true });
const http = require('http');
const { randomUUID } = require('crypto');
const { Pool } = require('pg');

const PORT      = process.env.EVENTS_PORT || 3003;
const startTime = Date.now() - 1000;
const SVC       = 'events-svc';

const pool = new Pool({
  host: process.env.PGHOST || 'localhost', port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'mockdb', user: process.env.PGUSER || 'mockuser',
  password: process.env.PGPASSWORD || 'mockpass',
});

let dbReady = false;

function serverLog(level, source, message, context = null) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, source, message, ...(context || {}) }));
  if (!dbReady) return;
  pool.query(
    `INSERT INTO server_logs (id, level, source, message, context) VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), level, source, message, context ? JSON.stringify(context) : null]
  ).catch(err => console.warn('[logger] DB write failed:', err.message));
}

async function dbQuery(table, operation, sql, params = []) {
  const t0 = Date.now();
  try {
    const result = await pool.query(sql, params);
    serverLog('info', 'db', `${operation} on ${table} → ${result.rowCount ?? result.rows.length} row(s)`, {
      table, operation, rowCount: result.rowCount ?? result.rows.length, ms: Date.now() - t0, svc: SVC,
    });
    return result;
  } catch (err) {
    serverLog('error', 'db', `${operation} on ${table} failed: ${err.message}`, {
      table, operation, ms: Date.now() - t0, svc: SVC,
    });
    throw err;
  }
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS server_logs (
      id VARCHAR(36) PRIMARY KEY, level VARCHAR(10) NOT NULL,
      source VARCHAR(100) NOT NULL DEFAULT 'server', message TEXT NOT NULL,
      context JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).catch(() => {});
  dbReady = true;
}

const server = http.createServer(async (req, res) => {
  const url    = new URL(req.url, `http://localhost:${PORT}`);
  const path   = url.pathname;
  const method = req.method.toUpperCase();

  if (path !== '/health' && path !== '/ready') {
    const origEnd = res.end.bind(res);
    res.end = function (body) {
      serverLog('info', SVC, `${method} ${path} → ${res.statusCode}`, { method, path, status: res.statusCode });
      res.end = origEnd;
      return origEnd(body);
    };
  }

  if (method === 'GET' && path === '/health') {
    let dbStatus = 'down', dbLatency = -1;
    try { const t0 = Date.now(); await pool.query('SELECT 1'); dbLatency = Date.now() - t0; dbStatus = 'up'; } catch {}
    return send(res, 200, {
      status: 'healthy', service: 'events-service', version: '2.0.0',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      dependencies: [{ name: 'database', status: dbStatus, latency: dbLatency }],
    });
  }

  if (method === 'GET' && path === '/ready') return send(res, 200, { status: 'ready' });

  // GET /api/v1/events
  if (method === 'GET' && path === '/api/v1/events') {
    const limit   = Math.min(parseInt(url.searchParams.get('limit') || '30', 10), 200);
    const topic   = url.searchParams.get('topic');
    const traceId = url.searchParams.get('traceId');

    let query;
    if (traceId) {
      query = await dbQuery('event_log', 'SELECT',
        `SELECT id, topic, key, event_type AS "eventType", payload, trace_id AS "traceId", created_at AS "timestamp"
           FROM event_log WHERE trace_id = $1 ORDER BY created_at ASC LIMIT $2`,
        [traceId, limit]);
    } else if (topic) {
      query = await dbQuery('event_log', 'SELECT',
        `SELECT id, topic, key, event_type AS "eventType", payload, trace_id AS "traceId", created_at AS "timestamp"
           FROM event_log WHERE topic = $1 ORDER BY created_at DESC LIMIT $2`,
        [topic, limit]);
    } else {
      query = await dbQuery('event_log', 'SELECT',
        `SELECT id, topic, key, event_type AS "eventType", payload, trace_id AS "traceId", created_at AS "timestamp"
           FROM event_log ORDER BY created_at DESC LIMIT $1`,
        [limit]);
    }

    const events = query.rows.map(r => ({
      id: r.id, topic: r.topic, key: r.key, eventType: r.eventType,
      payload: r.payload, traceId: r.traceId, timestamp: r.timestamp.toISOString(),
    }));
    return send(res, 200, { events });
  }

  send(res, 404, { code: 'NOT_FOUND', message: `${method} ${path} not found` });
});

async function start() {
  await initDB();
  serverLog('info', SVC, 'Database ready');
  server.listen(PORT, () => serverLog('info', SVC, `Listening on http://localhost:${PORT}`));
}

start().catch(err => { console.error('[events] Fatal:', err.message); process.exit(1); });
process.on('SIGTERM', async () => { await pool.end().catch(() => {}); server.close(); });
