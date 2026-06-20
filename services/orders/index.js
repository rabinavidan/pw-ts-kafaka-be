require('dotenv').config({ override: true });
const http = require('http');
const { randomUUID } = require('crypto');
const { Kafka } = require('kafkajs');
const { Pool } = require('pg');

const PORT      = process.env.ORDERS_PORT || 3001;
const BROKERS   = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',').map(s => s.trim());
const startTime = Date.now() - 1000;
const SVC       = 'orders-svc';

const pool = new Pool({
  host: process.env.PGHOST || 'localhost', port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'mockdb', user: process.env.PGUSER || 'mockuser',
  password: process.env.PGPASSWORD || 'mockpass',
});

let dbReady = false;

function serverLog(level, source, message, context = null) {
  console.log(`[${level.toUpperCase()}] [${source}] ${message}`, context || '');
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

const kafka    = new Kafka({ clientId: 'orders-service', brokers: BROKERS, logCreator: () => () => {} });
const producer = kafka.producer({ allowAutoTopicCreation: true });
let producerReady = false;

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(255) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'created', amount NUMERIC(12,2) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'USD', items JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders (status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders (user_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS server_logs (
      id VARCHAR(36) PRIMARY KEY, level VARCHAR(10) NOT NULL,
      source VARCHAR(100) NOT NULL DEFAULT 'server', message TEXT NOT NULL,
      context JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).catch(() => {});
  dbReady = true;
}

function rowToOrder(r) {
  return {
    id: r.id, userId: r.user_id, status: r.status, amount: parseFloat(r.amount),
    currency: r.currency, items: r.items,
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  };
}

async function publish(topic, key, value, headers = {}) {
  if (!producerReady) {
    serverLog('warn', SVC, `Kafka not ready — dropped event to ${topic}`, { topic, key });
    return;
  }
  try {
    await producer.send({ topic, messages: [{ key, value: JSON.stringify(value), headers }] });
    serverLog('info', SVC, `Published to ${topic}`, { topic, key, eventType: headers['event-type'] });
  } catch (err) {
    serverLog('error', SVC, `Failed to publish to ${topic}: ${err.message}`, { topic, key });
  }
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
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
      status: 'healthy', service: 'orders-service', version: '2.0.0',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      dependencies: [
        { name: 'kafka',    status: producerReady ? 'up' : 'down', latency: 2 },
        { name: 'database', status: dbStatus, latency: dbLatency },
      ],
    });
  }

  if (method === 'GET' && path === '/ready') return send(res, 200, { status: 'ready' });

  // POST /api/v1/orders
  if (method === 'POST' && path === '/api/v1/orders') {
    const body = await readBody(req);
    if (!body.userId || body.userId === '')
      return send(res, 422, { code: 'VALIDATION_ERROR', message: 'userId is required' });
    if (Array.isArray(body.items) && body.items.length === 0)
      return send(res, 422, { code: 'VALIDATION_ERROR', message: 'items cannot be empty' });

    const items  = (body.items || []).map(i => ({ ...i, price: 100 }));
    const amount = items.length > 0 ? items.length * 100 : 100;
    const id     = randomUUID();
    const now    = new Date();

    await dbQuery('orders', 'INSERT',
      `INSERT INTO orders (id, user_id, status, amount, currency, items, created_at, updated_at)
       VALUES ($1, $2, 'created', $3, $4, $5, $6, $6)`,
      [id, body.userId, amount, body.currency || 'USD', JSON.stringify(items), now]
    );
    const order = { id, userId: body.userId, status: 'created', amount, currency: body.currency || 'USD',
                    items, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    send(res, 201, order);
    publish('orders', order.id, { orderId: order.id, userId: order.userId, status: 'created',
      amount: order.amount, currency: order.currency, items: order.items, createdAt: order.createdAt },
      { 'event-type': 'order.created' });
    return;
  }

  // GET /api/v1/orders
  if (method === 'GET' && path === '/api/v1/orders') {
    const statusFilter = url.searchParams.get('status');
    const page     = Math.max(1, parseInt(url.searchParams.get('page')     || '1',  10));
    const pageSize = Math.max(1, parseInt(url.searchParams.get('pageSize') || '10', 10));

    const countQ = statusFilter
      ? await dbQuery('orders', 'COUNT', `SELECT COUNT(*) FROM orders WHERE status = $1`, [statusFilter])
      : await dbQuery('orders', 'COUNT', `SELECT COUNT(*) FROM orders`);
    const total = parseInt(countQ.rows[0].count);
    const offset = (page - 1) * pageSize;
    const rowsQ = statusFilter
      ? await dbQuery('orders', 'SELECT', `SELECT * FROM orders WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
          [statusFilter, pageSize, offset])
      : await dbQuery('orders', 'SELECT', `SELECT * FROM orders ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [pageSize, offset]);
    return send(res, 200, { items: rowsQ.rows.map(rowToOrder), total, page, pageSize,
                             hasNext: offset + pageSize < total });
  }

  // PUT /api/v1/orders/:id/confirm
  const orderConfirm = path.match(/^\/api\/v1\/orders\/([^/]+)\/confirm$/);
  if ((method === 'PUT' || method === 'PATCH') && orderConfirm) {
    const { rows } = await dbQuery('orders', 'UPDATE',
      `UPDATE orders SET status = 'confirmed', updated_at = NOW() WHERE id = $1 RETURNING *`, [orderConfirm[1]]);
    if (!rows.length) return send(res, 404, { code: 'NOT_FOUND', message: 'Order not found' });
    const order = rowToOrder(rows[0]);
    send(res, 200, order);
    publish('orders', order.id, { orderId: order.id, userId: order.userId, status: 'confirmed',
      amount: order.amount, currency: order.currency, items: order.items, createdAt: order.createdAt },
      { 'event-type': 'order.confirmed' });
    return;
  }

  // PUT /api/v1/orders/:id/cancel
  const orderCancel = path.match(/^\/api\/v1\/orders\/([^/]+)\/cancel$/);
  if ((method === 'PUT' || method === 'PATCH') && orderCancel) {
    const { rows } = await dbQuery('orders', 'UPDATE',
      `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *`, [orderCancel[1]]);
    if (!rows.length) return send(res, 404, { code: 'NOT_FOUND', message: 'Order not found' });
    const order = rowToOrder(rows[0]);
    send(res, 200, order);
    publish('orders', order.id, { orderId: order.id, userId: order.userId, status: 'cancelled',
      amount: order.amount, currency: order.currency, items: order.items, createdAt: order.createdAt },
      { 'event-type': 'order.cancelled' });
    return;
  }

  // DELETE /api/v1/orders/:id
  const orderDel = path.match(/^\/api\/v1\/orders\/([^/]+)$/);
  if (method === 'DELETE' && orderDel) {
    const { rowCount } = await dbQuery('orders', 'DELETE', 'DELETE FROM orders WHERE id = $1', [orderDel[1]]);
    if (!rowCount) return send(res, 404, { code: 'NOT_FOUND', message: 'Order not found' });
    publish('orders', orderDel[1], { eventType: 'order.deleted', orderId: orderDel[1] }, { 'event-type': 'order.deleted' });
    return send(res, 200, { id: orderDel[1], deleted: true });
  }

  // GET /api/v1/orders/:id
  const orderById = path.match(/^\/api\/v1\/orders\/([^/]+)$/);
  if (method === 'GET' && orderById) {
    const { rows } = await dbQuery('orders', 'SELECT', `SELECT * FROM orders WHERE id = $1`, [orderById[1]]);
    if (!rows.length) return send(res, 404, { code: 'NOT_FOUND', message: 'Order not found' });
    return send(res, 200, rowToOrder(rows[0]));
  }

  send(res, 404, { code: 'NOT_FOUND', message: `${method} ${path} not found` });
});

async function start() {
  await initDB();
  serverLog('info', SVC, 'Database ready');
  producer.connect()
    .then(() => { producerReady = true; serverLog('info', SVC, 'Kafka producer connected'); })
    .catch(err => serverLog('warn', SVC, `Kafka unavailable: ${err.message}`));
  server.listen(PORT, () => serverLog('info', SVC, `Listening on http://localhost:${PORT}`));
}

start().catch(err => { console.error('[orders] Fatal:', err.message); process.exit(1); });
process.on('SIGTERM', async () => { await producer.disconnect().catch(() => {}); await pool.end().catch(() => {}); server.close(); });
