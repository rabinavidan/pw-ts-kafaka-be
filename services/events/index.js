require('dotenv').config();
const http = require('http');
const { Pool } = require('pg');

const PORT      = process.env.EVENTS_PORT || 3003;
const startTime = Date.now() - 1000;

const pool = new Pool({
  host: process.env.PGHOST || 'localhost', port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'mockdb', user: process.env.PGUSER || 'mockuser',
  password: process.env.PGPASSWORD || 'mockpass',
});

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url    = new URL(req.url, `http://localhost:${PORT}`);
  const path   = url.pathname;
  const method = req.method.toUpperCase();

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
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10), 200);
    const topic = url.searchParams.get('topic');

    const query = topic
      ? await pool.query(
          `SELECT id, topic, key, event_type AS "eventType", payload, created_at AS "timestamp"
             FROM event_log WHERE topic = $1 ORDER BY created_at DESC LIMIT $2`,
          [topic, limit])
      : await pool.query(
          `SELECT id, topic, key, event_type AS "eventType", payload, created_at AS "timestamp"
             FROM event_log ORDER BY created_at DESC LIMIT $1`,
          [limit]);

    const events = query.rows.map(r => ({
      id: r.id, topic: r.topic, key: r.key, eventType: r.eventType,
      payload: r.payload, timestamp: r.timestamp.toISOString(),
    }));
    return send(res, 200, { events });
  }

  send(res, 404, { code: 'NOT_FOUND', message: `${method} ${path} not found` });
});

server.listen(PORT, () => console.log(`[events] Listening on http://localhost:${PORT}`));
process.on('SIGTERM', async () => { await pool.end().catch(() => {}); server.close(); });
