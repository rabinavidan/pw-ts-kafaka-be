require('dotenv').config({ override: true });
const http = require('http');
const { randomUUID } = require('crypto');
const { Kafka } = require('kafkajs');
const { Pool } = require('pg');

const PORT      = process.env.PAYMENTS_PORT || 3002;
const BROKERS   = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',').map(s => s.trim());
const startTime = Date.now() - 1000;
const SVC       = 'payments-svc';

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

const kafka    = new Kafka({ clientId: 'payments-service', brokers: BROKERS, logCreator: () => () => {} });
const producer = kafka.producer({ allowAutoTopicCreation: true });
let producerReady = false;

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id VARCHAR(36) PRIMARY KEY, order_id VARCHAR(36) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'pending', amount NUMERIC(12,2) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'USD', method VARCHAR(50) NOT NULL DEFAULT 'credit_card',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments (order_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS server_logs (
      id VARCHAR(36) PRIMARY KEY, level VARCHAR(10) NOT NULL,
      source VARCHAR(100) NOT NULL DEFAULT 'server', message TEXT NOT NULL,
      context JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).catch(() => {});
  dbReady = true;
}

function rowToPayment(r) {
  return {
    id: r.id, orderId: r.order_id, status: r.status, amount: parseFloat(r.amount),
    currency: r.currency, method: r.method, createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at ? r.updated_at.toISOString() : undefined,
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
      status: 'healthy', service: 'payments-service', version: '2.0.0',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      dependencies: [
        { name: 'kafka',    status: producerReady ? 'up' : 'down', latency: 2 },
        { name: 'database', status: dbStatus, latency: dbLatency },
      ],
    });
  }

  if (method === 'GET' && path === '/ready') return send(res, 200, { status: 'ready' });

  // POST /api/v1/payments
  if (method === 'POST' && path === '/api/v1/payments') {
    const body = await readBody(req);
    if (!body.orderId)
      return send(res, 422, { code: 'VALIDATION_ERROR', message: 'orderId is required' });

    // Payload mirrors the PUT /:id/fail contract below (same event-type,
    // same required fields) so consumers don't have to branch on which path
    // produced a payment.failed event.
    if (body.simulateFailure) {
      const { rows: orderRows } = await dbQuery('orders', 'SELECT', `SELECT amount, currency FROM orders WHERE id = $1`, [body.orderId]);
      const order    = orderRows[0];
      const id       = randomUUID();
      const amount   = body.amount ?? parseFloat(order?.amount ?? 100);
      const currency = body.currency || order?.currency || 'USD';
      const method   = body.method || 'credit_card';
      const failedAt = new Date().toISOString();
      send(res, 201, { id, orderId: body.orderId, status: 'failed' });
      publish('dead-letter-queue', body.orderId,
        { paymentId: id, orderId: body.orderId, status: 'failed',
          amount, currency, method, failureReason: 'payment_failed', failedAt },
        { 'event-type': 'payment.failed', 'original-topic': 'orders' });
      return;
    }

    const { rows: existing } = await dbQuery('payments', 'SELECT', `SELECT id FROM payments WHERE order_id = $1`, [body.orderId]);
    if (existing.length)
      return send(res, 409, { code: 'CONFLICT', message: 'Payment already exists for this order' });

    const { rows: orderRows } = await dbQuery('orders', 'SELECT', `SELECT amount, currency FROM orders WHERE id = $1`, [body.orderId]);
    const order  = orderRows[0];
    const id     = randomUUID();
    const amount = body.amount ?? parseFloat(order?.amount ?? 100);
    const currency = body.currency || order?.currency || 'USD';
    const method   = body.method || 'credit_card';
    const now      = new Date();

    await dbQuery('payments', 'INSERT',
      `INSERT INTO payments (id, order_id, status, amount, currency, method, created_at) VALUES ($1, $2, 'pending', $3, $4, $5, $6)`,
      [id, body.orderId, amount, currency, method, now]
    );
    const payment = { id, orderId: body.orderId, status: 'pending', amount, currency, method, createdAt: now.toISOString() };
    send(res, 201, payment);
    publish('payments', payment.id,
      { paymentId: payment.id, orderId: payment.orderId, status: 'pending',
        amount: payment.amount, currency: payment.currency, method: payment.method, processedAt: payment.createdAt },
      { 'event-type': 'payment.initiated' });
    return;
  }

  // PUT /api/v1/payments/:id/process
  const paymentProcess = path.match(/^\/api\/v1\/payments\/([^/]+)\/process$/);
  if ((method === 'PUT' || method === 'PATCH') && paymentProcess) {
    const { rows } = await dbQuery('payments', 'UPDATE',
      `UPDATE payments SET status = 'processed', updated_at = NOW() WHERE id = $1 RETURNING *`, [paymentProcess[1]]);
    if (!rows.length) return send(res, 404, { code: 'NOT_FOUND', message: 'Payment not found' });
    const payment = rowToPayment(rows[0]);
    send(res, 200, payment);
    publish('payments', payment.id,
      { paymentId: payment.id, orderId: payment.orderId, status: 'processed',
        amount: payment.amount, currency: payment.currency, method: payment.method, processedAt: payment.updatedAt },
      { 'event-type': 'payment.processed' });
    return;
  }

  // PUT /api/v1/payments/:id/refund
  const paymentRefund = path.match(/^\/api\/v1\/payments\/([^/]+)\/refund$/);
  if ((method === 'PUT' || method === 'PATCH') && paymentRefund) {
    const { rows } = await dbQuery('payments', 'UPDATE',
      `UPDATE payments SET status = 'refunded', updated_at = NOW() WHERE id = $1 RETURNING *`, [paymentRefund[1]]);
    if (!rows.length) return send(res, 404, { code: 'NOT_FOUND', message: 'Payment not found' });
    const payment = rowToPayment(rows[0]);
    send(res, 200, payment);
    publish('payments', payment.id,
      { paymentId: payment.id, orderId: payment.orderId, status: 'refunded',
        amount: payment.amount, currency: payment.currency, method: payment.method, processedAt: payment.updatedAt },
      { 'event-type': 'payment.refunded' });
    return;
  }

  // PUT /api/v1/payments/:id/fail
  const paymentFail = path.match(/^\/api\/v1\/payments\/([^/]+)\/fail$/);
  if ((method === 'PUT' || method === 'PATCH') && paymentFail) {
    const { rows } = await dbQuery('payments', 'UPDATE',
      `UPDATE payments SET status = 'failed', updated_at = NOW() WHERE id = $1 RETURNING *`, [paymentFail[1]]);
    if (!rows.length) return send(res, 404, { code: 'NOT_FOUND', message: 'Payment not found' });
    const payment = rowToPayment(rows[0]);
    send(res, 200, payment);
    publish('dead-letter-queue', payment.id,
      { paymentId: payment.id, orderId: payment.orderId, status: 'failed',
        amount: payment.amount, currency: payment.currency, method: payment.method,
        failureReason: 'payment_failed', failedAt: payment.updatedAt },
      { 'event-type': 'payment.failed', 'original-topic': 'payments' });
    return;
  }

  // DELETE /api/v1/payments/:id
  const paymentDel = path.match(/^\/api\/v1\/payments\/([^/]+)$/);
  if (method === 'DELETE' && paymentDel) {
    const { rowCount } = await dbQuery('payments', 'DELETE', 'DELETE FROM payments WHERE id = $1', [paymentDel[1]]);
    if (!rowCount) return send(res, 404, { code: 'NOT_FOUND', message: 'Payment not found' });
    publish('payments', paymentDel[1], { eventType: 'payment.deleted', paymentId: paymentDel[1] }, { 'event-type': 'payment.deleted' });
    return send(res, 200, { id: paymentDel[1], deleted: true });
  }

  // GET /api/v1/payments/:id
  const paymentById = path.match(/^\/api\/v1\/payments\/([^/]+)$/);
  if (method === 'GET' && paymentById) {
    const { rows } = await dbQuery('payments', 'SELECT', `SELECT * FROM payments WHERE id = $1`, [paymentById[1]]);
    if (!rows.length) return send(res, 404, { code: 'NOT_FOUND', message: 'Payment not found' });
    return send(res, 200, rowToPayment(rows[0]));
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

start().catch(err => { console.error('[payments] Fatal:', err.message); process.exit(1); });
process.on('SIGTERM', async () => { await producer.disconnect().catch(() => {}); await pool.end().catch(() => {}); server.close(); });
