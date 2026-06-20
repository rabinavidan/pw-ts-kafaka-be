require('dotenv').config();
const http = require('http');
const { randomUUID } = require('crypto');
const { promisify } = require('util');
const { exec: execRaw } = require('child_process');
const execAsync = promisify(execRaw);
const { Kafka } = require('kafkajs');
const { Pool } = require('pg');

const PORT      = process.env.PORT || 3000;
const BROKERS   = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',').map(s => s.trim());
const startTime = Date.now() - 1000;

// ── PostgreSQL pool ───────────────────────────────────────────────
const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'mockdb',
  user:     process.env.PGUSER     || 'mockuser',
  password: process.env.PGPASSWORD || 'mockpass',
});

let dbReady = false;

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id         VARCHAR(36)   PRIMARY KEY,
      user_id    VARCHAR(255)  NOT NULL,
      status     VARCHAR(50)   NOT NULL DEFAULT 'created',
      amount     NUMERIC(12,2) NOT NULL,
      currency   VARCHAR(10)   NOT NULL DEFAULT 'USD',
      items      JSONB         NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id         VARCHAR(36)   PRIMARY KEY,
      order_id   VARCHAR(36)   NOT NULL,
      status     VARCHAR(50)   NOT NULL DEFAULT 'pending',
      amount     NUMERIC(12,2) NOT NULL,
      currency   VARCHAR(10)   NOT NULL DEFAULT 'USD',
      method     VARCHAR(50)   NOT NULL DEFAULT 'credit_card',
      created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_log (
      id         VARCHAR(36)  PRIMARY KEY,
      topic      VARCHAR(255) NOT NULL,
      key        VARCHAR(255),
      event_type VARCHAR(255) NOT NULL,
      payload    JSONB        NOT NULL,
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kafka_consumer_offsets (
      consumer_group   VARCHAR(255) NOT NULL,
      topic            VARCHAR(255) NOT NULL,
      partition        INTEGER      NOT NULL,
      committed_offset BIGINT       NOT NULL DEFAULT 0,
      updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      PRIMARY KEY (consumer_group, topic, partition)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS server_logs (
      id         VARCHAR(36)  PRIMARY KEY,
      level      VARCHAR(10)  NOT NULL,
      source     VARCHAR(100) NOT NULL DEFAULT 'server',
      message    TEXT         NOT NULL,
      context    JSONB,
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_status       ON orders (status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payments_order_id   ON payments (order_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_log_created   ON event_log (created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_server_logs_created ON server_logs (created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_server_logs_level   ON server_logs (level)`);
  dbReady = true;
  console.log('[mock-server] Database ready');
}

// ── Server logger ─────────────────────────────────────────────────
function serverLog(level, source, message, context = null) {
  console.log(`[${level.toUpperCase()}] [${source}] ${message}`, context || '');
  if (!dbReady) return;
  pool.query(
    `INSERT INTO server_logs (id, level, source, message, context) VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), level, source, message, context ? JSON.stringify(context) : null]
  ).catch(err => console.warn('[logger] DB write failed:', err.message));
}

// ── DB query wrapper — logs every table interaction ───────────────
async function dbQuery(table, operation, sql, params = []) {
  const t0 = Date.now();
  try {
    const result = await pool.query(sql, params);
    serverLog('info', 'db', `${operation} on ${table} → ${result.rowCount ?? result.rows.length} row(s)`, {
      table, operation, rowCount: result.rowCount ?? result.rows.length, ms: Date.now() - t0,
    });
    return result;
  } catch (err) {
    serverLog('error', 'db', `${operation} on ${table} failed: ${err.message}`, {
      table, operation, ms: Date.now() - t0,
    });
    throw err;
  }
}

// ── Row mappers ───────────────────────────────────────────────────
function rowToOrder(r) {
  return {
    id:        r.id,
    userId:    r.user_id,
    status:    r.status,
    amount:    parseFloat(r.amount),
    currency:  r.currency,
    items:     r.items,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

function rowToPayment(r) {
  return {
    id:        r.id,
    orderId:   r.order_id,
    status:    r.status,
    amount:    parseFloat(r.amount),
    currency:  r.currency,
    method:    r.method,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at ? r.updated_at.toISOString() : undefined,
  };
}

// ── Kafka producer ────────────────────────────────────────────────
const kafka    = new Kafka({ clientId: 'mock-server', brokers: BROKERS, logCreator: () => () => {} });
const producer = kafka.producer({ allowAutoTopicCreation: true });
let producerReady = false;
let kafkaReconnectTimer = null;

async function connectKafka() {
  try {
    await producer.connect();
    producerReady = true;
    if (kafkaReconnectTimer) { clearTimeout(kafkaReconnectTimer); kafkaReconnectTimer = null; }
    serverLog('info', 'kafka', 'Kafka producer connected', { brokers: BROKERS });
  } catch (err) {
    serverLog('warn', 'kafka', `Kafka unavailable, retrying in 5s: ${err.message}`);
    kafkaReconnectTimer = setTimeout(connectKafka, 5000);
  }
}

async function publish(topic, key, value, headers = {}) {
  const eventType = (headers['event-type'] || 'unknown').toString();
  pool.query(
    `INSERT INTO event_log (id, topic, key, event_type, payload) VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), topic, key, eventType, value]
  ).catch(err => console.warn('[mock-server] event_log insert failed:', err.message));

  if (!producerReady) {
    serverLog('warn', 'kafka', `Kafka producer not ready — event dropped`, { topic, key, eventType });
    return;
  }
  try {
    await producer.send({
      topic,
      messages: [{ key, value: JSON.stringify(value), headers }],
    });
    serverLog('info', 'kafka', `Published event to ${topic}`, { topic, key, eventType });
  } catch (err) {
    serverLog('error', 'kafka', `Failed to publish to ${topic}: ${err.message}`, { topic, key, eventType });
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve({}); }
    });
  });
}

// ── Microservice health probe ─────────────────────────────────────
async function checkServiceHealth(port) {
  return new Promise((resolve) => {
    const t0  = Date.now();
    const req = http.get(`http://localhost:${port}/health`, { timeout: 2000 }, (r) => {
      let data = '';
      r.on('data', d => (data += d));
      r.on('end', () => {
        try { resolve({ status: 'up', latency: Date.now() - t0, detail: JSON.parse(data) }); }
        catch { resolve({ status: 'up', latency: Date.now() - t0, detail: null }); }
      });
    });
    req.on('error',   () => resolve({ status: 'down', latency: -1, detail: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 'down', latency: -1, detail: null }); });
  });
}

// ── Playwright result transformer ─────────────────────────────────
function collectSpecs(suite, group, acc) {
  for (const spec of suite.specs || []) {
    const testRun = spec.tests?.[0];
    const result  = testRun?.results?.[0];
    acc.push({
      title:    spec.title,
      group,
      status:   result?.status === 'passed' ? 'passed' : 'failed',
      duration: result?.duration || 0,
      error:    result?.error?.message || null,
    });
  }
  for (const child of suite.suites || []) collectSpecs(child, child.title, acc);
}

function transformPwResults(raw) {
  const services = [];
  for (const fileSuite of raw.suites || []) {
    for (const svcSuite of fileSuite.suites || []) {
      const tests = [];
      collectSpecs(svcSuite, svcSuite.title, tests);
      services.push({
        name:   svcSuite.title,
        tests,
        passed: tests.filter(t => t.status === 'passed').length,
        failed: tests.filter(t => t.status === 'failed').length,
      });
    }
  }
  return { services, stats: raw.stats || {} };
}

function walkAllSpecs(suites, acc) {
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) {
      const testRun = spec.tests?.[0];
      const result  = testRun?.results?.[0];
      const project = testRun?.projectName || 'unknown';
      if (!acc[project]) acc[project] = { name: project, passed: 0, failed: 0 };
      if (result?.status === 'passed') acc[project].passed++;
      else acc[project].failed++;
    }
    walkAllSpecs(suite.suites, acc);
  }
}

function transformAllPwResults(raw) {
  const acc = {};
  walkAllSpecs(raw.suites, acc);
  return { projects: Object.values(acc), stats: raw.stats || {} };
}

// ── Router ────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url    = new URL(req.url, `http://localhost:${PORT}`);
  const path   = url.pathname;
  const method = req.method.toUpperCase();
  const t0     = Date.now();

  const originalEnd = res.end.bind(res);
  res.end = function(...args) {
    const duration = Date.now() - t0;
    const skip = path === '/health' || path === '/ready' || path.startsWith('/api/v1/logs');
    if (!skip) {
      serverLog('info', 'http', `${method} ${path} ${res.statusCode}`, { method, path, status: res.statusCode, ms: duration });
    }
    return originalEnd(...args);
  };

  // ── Health ────────────────────────────────────────────────────
  if (method === 'GET' && path === '/health') {
    let dbLatency = -1;
    let dbStatus  = 'down';
    try {
      const t0 = Date.now();
      await pool.query('SELECT 1');
      dbLatency = Date.now() - t0;
      dbStatus  = 'up';
    } catch {}

    return send(res, 200, {
      status:  'healthy',
      service: 'orders-service',
      version: '1.0.0',
      uptime:  Math.floor((Date.now() - startTime) / 1000),
      dependencies: [
        { name: 'kafka',    status: producerReady ? 'up' : 'down', latency: 2 },
        { name: 'database', status: dbStatus, latency: dbLatency },
      ],
    });
  }

  if (method === 'GET' && path === '/ready') {
    return send(res, 200, { status: 'ready' });
  }

  // GET /api/v1/events
  if (method === 'GET' && path === '/api/v1/events') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10), 200);
    const { rows } = await pool.query(
      `SELECT id, topic, key, event_type AS "eventType", payload, created_at AS "timestamp"
         FROM event_log ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    const events = rows.map(r => ({
      id:        r.id,
      topic:     r.topic,
      key:       r.key,
      eventType: r.eventType,
      payload:   r.payload,
      timestamp: r.timestamp.toISOString(),
    }));
    return send(res, 200, { events });
  }

  // GET /api/v1/logs
  if (method === 'GET' && path === '/api/v1/logs') {
    const limit  = Math.min(parseInt(url.searchParams.get('limit') || '200', 10), 1000);
    const level  = url.searchParams.get('level');
    const search = url.searchParams.get('search');
    const conditions = [];
    const params = [];
    if (level && level !== 'all') { params.push(level); conditions.push(`level = $${params.length}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`message ILIKE $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT id, level, source, message, context, created_at AS "timestamp"
         FROM server_logs ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return send(res, 200, { logs: rows.map(r => ({ ...r, timestamp: r.timestamp.toISOString() })) });
  }

  // ── Orders ────────────────────────────────────────────────────

  // POST /api/v1/orders
  if (method === 'POST' && path === '/api/v1/orders') {
    const body = await readBody(req);
    if (!body.userId || body.userId === '') {
      return send(res, 422, { code: 'VALIDATION_ERROR', message: 'userId is required' });
    }
    if (Array.isArray(body.items) && body.items.length === 0) {
      return send(res, 422, { code: 'VALIDATION_ERROR', message: 'items cannot be empty' });
    }

    const items  = (body.items || []).map(i => ({ ...i, price: 100 }));
    const amount = items.length > 0 ? items.length * 100 : 100;
    const id     = randomUUID();
    const now    = new Date();

    await dbQuery('orders', 'INSERT', `INSERT INTO orders (id, user_id, status, amount, currency, items, created_at, updated_at) VALUES ($1, $2, 'created', $3, $4, $5, $6, $6)`,
      [id, body.userId, amount, body.currency || 'USD', JSON.stringify(items), now]);

    const order = {
      id, userId: body.userId, status: 'created', amount,
      currency: body.currency || 'USD', items,
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    send(res, 201, order);

    publish('orders', order.id, {
      orderId: order.id, userId: order.userId, status: 'created',
      amount: order.amount, currency: order.currency, items: order.items,
      createdAt: order.createdAt,
    }, { 'event-type': 'order.created' });

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
    const rowsQ  = statusFilter
      ? await dbQuery('orders', 'SELECT', `SELECT * FROM orders WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [statusFilter, pageSize, offset])
      : await dbQuery('orders', 'SELECT', `SELECT * FROM orders ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [pageSize, offset]);

    return send(res, 200, {
      items:   rowsQ.rows.map(rowToOrder),
      total,
      page,
      pageSize,
      hasNext: offset + pageSize < total,
    });
  }

  // PUT /api/v1/orders/:id/confirm
  const orderConfirm = path.match(/^\/api\/v1\/orders\/([^/]+)\/confirm$/);
  if ((method === 'PUT' || method === 'PATCH') && orderConfirm) {
    const { rows } = await dbQuery('orders', 'UPDATE', `UPDATE orders SET status = 'confirmed', updated_at = NOW() WHERE id = $1 RETURNING *`, [orderConfirm[1]]);
    if (!rows.length) return send(res, 404, { code: 'NOT_FOUND', message: 'Order not found' });
    const order = rowToOrder(rows[0]);
    send(res, 200, order);
    publish('orders', order.id, {
      orderId: order.id, userId: order.userId, status: 'confirmed',
      amount: order.amount, currency: order.currency, items: order.items,
      createdAt: order.createdAt,
    }, { 'event-type': 'order.confirmed' });
    return;
  }

  // PUT /api/v1/orders/:id/cancel
  const orderCancel = path.match(/^\/api\/v1\/orders\/([^/]+)\/cancel$/);
  if ((method === 'PUT' || method === 'PATCH') && orderCancel) {
    const { rows } = await dbQuery('orders', 'UPDATE', `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *`, [orderCancel[1]]);
    if (!rows.length) return send(res, 404, { code: 'NOT_FOUND', message: 'Order not found' });
    const order = rowToOrder(rows[0]);
    send(res, 200, order);
    publish('orders', order.id, {
      orderId: order.id, userId: order.userId, status: 'cancelled',
      amount: order.amount, currency: order.currency, items: order.items,
      createdAt: order.createdAt,
    }, { 'event-type': 'order.cancelled' });
    return;
  }

  // GET /api/v1/orders/:id
  const orderById = path.match(/^\/api\/v1\/orders\/([^/]+)$/);
  if (method === 'GET' && orderById) {
    const { rows } = await dbQuery('orders', 'SELECT', `SELECT * FROM orders WHERE id = $1`, [orderById[1]]);
    if (!rows.length) return send(res, 404, { code: 'NOT_FOUND', message: 'Order not found' });
    return send(res, 200, rowToOrder(rows[0]));
  }

  // ── Payments ──────────────────────────────────────────────────

  // POST /api/v1/payments
  if (method === 'POST' && path === '/api/v1/payments') {
    const body = await readBody(req);
    if (!body.orderId) {
      return send(res, 422, { code: 'VALIDATION_ERROR', message: 'orderId is required' });
    }

    // Simulated failure → DLQ
    if (body.simulateFailure) {
      const { rows: orderRows } = await dbQuery('orders', 'SELECT', `SELECT * FROM orders WHERE id = $1`, [body.orderId]);
      const order = orderRows[0] ? rowToOrder(orderRows[0]) : { orderId: body.orderId };
      send(res, 201, { id: randomUUID(), orderId: body.orderId, status: 'failed' });
      publish('dead-letter-queue', body.orderId, {
        originalEvent: order, failureReason: 'payment_failed', failedAt: new Date().toISOString(),
      }, { 'event-type': 'payment.failed', 'original-topic': 'orders' });
      return;
    }

    // Duplicate payment guard
    const { rows: existing } = await dbQuery('payments', 'SELECT', `SELECT id FROM payments WHERE order_id = $1`, [body.orderId]);
    if (existing.length) {
      return send(res, 409, { code: 'CONFLICT', message: 'Payment already exists for this order' });
    }

    const { rows: orderRows } = await dbQuery('orders', 'SELECT', `SELECT * FROM orders WHERE id = $1`, [body.orderId]);
    const order   = orderRows[0] ? rowToOrder(orderRows[0]) : null;
    const id      = randomUUID();
    const amount  = body.amount ?? order?.amount ?? 100;
    const currency = body.currency || order?.currency || 'USD';
    const method  = body.method || 'credit_card';
    const now     = new Date();

    await dbQuery('payments', 'INSERT', `INSERT INTO payments (id, order_id, status, amount, currency, method, created_at) VALUES ($1, $2, 'pending', $3, $4, $5, $6)`,
      [id, body.orderId, amount, currency, method, now]);

    const payment = { id, orderId: body.orderId, status: 'pending', amount, currency, method, createdAt: now.toISOString() };
    send(res, 201, payment);
    publish('payments', payment.id, {
      paymentId: payment.id, orderId: payment.orderId, status: 'pending',
      amount: payment.amount, currency: payment.currency, method: payment.method,
      processedAt: payment.createdAt,
    }, { 'event-type': 'payment.initiated' });
    return;
  }

  // PUT /api/v1/payments/:id/process
  const paymentProcess = path.match(/^\/api\/v1\/payments\/([^/]+)\/process$/);
  if ((method === 'PUT' || method === 'PATCH') && paymentProcess) {
    const { rows } = await dbQuery('payments', 'UPDATE', `UPDATE payments SET status = 'processed', updated_at = NOW() WHERE id = $1 RETURNING *`, [paymentProcess[1]]);
    if (!rows.length) return send(res, 404, { code: 'NOT_FOUND', message: 'Payment not found' });
    const payment = rowToPayment(rows[0]);
    send(res, 200, payment);
    publish('payments', payment.id, {
      paymentId: payment.id, orderId: payment.orderId, status: 'processed',
      amount: payment.amount, currency: payment.currency, method: payment.method,
      processedAt: payment.updatedAt,
    }, { 'event-type': 'payment.processed' });
    return;
  }

  // PUT /api/v1/payments/:id/refund
  const paymentRefund = path.match(/^\/api\/v1\/payments\/([^/]+)\/refund$/);
  if ((method === 'PUT' || method === 'PATCH') && paymentRefund) {
    const { rows } = await dbQuery('payments', 'UPDATE', `UPDATE payments SET status = 'refunded', updated_at = NOW() WHERE id = $1 RETURNING *`, [paymentRefund[1]]);
    if (!rows.length) return send(res, 404, { code: 'NOT_FOUND', message: 'Payment not found' });
    const payment = rowToPayment(rows[0]);
    send(res, 200, payment);
    publish('payments', payment.id, {
      paymentId: payment.id, orderId: payment.orderId, status: 'refunded',
      amount: payment.amount, currency: payment.currency, method: payment.method,
      processedAt: payment.updatedAt,
    }, { 'event-type': 'payment.refunded' });
    return;
  }

  // PUT /api/v1/payments/:id/fail
  const paymentFail = path.match(/^\/api\/v1\/payments\/([^/]+)\/fail$/);
  if ((method === 'PUT' || method === 'PATCH') && paymentFail) {
    const { rows } = await dbQuery('payments', 'UPDATE', `UPDATE payments SET status = 'failed', updated_at = NOW() WHERE id = $1 RETURNING *`, [paymentFail[1]]);
    if (!rows.length) return send(res, 404, { code: 'NOT_FOUND', message: 'Payment not found' });
    const payment = rowToPayment(rows[0]);
    send(res, 200, payment);
    publish('dead-letter-queue', payment.id, {
      paymentId: payment.id, orderId: payment.orderId, status: 'failed',
      amount: payment.amount, currency: payment.currency, method: payment.method,
      failureReason: 'payment_failed', failedAt: payment.updatedAt,
    }, { 'event-type': 'payment.failed', 'original-topic': 'payments' });
    return;
  }

  // GET /api/v1/payments/:id
  const paymentById = path.match(/^\/api\/v1\/payments\/([^/]+)$/);
  if (method === 'GET' && paymentById) {
    const { rows } = await dbQuery('payments', 'SELECT', `SELECT * FROM payments WHERE id = $1`, [paymentById[1]]);
    if (!rows.length) return send(res, 404, { code: 'NOT_FOUND', message: 'Payment not found' });
    return send(res, 200, rowToPayment(rows[0]));
  }

  // DELETE /api/v1/orders/:id
  const orderDel = path.match(/^\/api\/v1\/orders\/([^/]+)$/);
  if (method === 'DELETE' && orderDel) {
    const { rowCount } = await dbQuery('orders', 'DELETE', `DELETE FROM orders WHERE id = $1`, [orderDel[1]]);
    if (!rowCount) return send(res, 404, { code: 'NOT_FOUND', message: 'Order not found' });
    publish('orders', orderDel[1], { eventType: 'order.deleted', orderId: orderDel[1] }, { 'event-type': 'order.deleted' });
    return send(res, 200, { id: orderDel[1], deleted: true });
  }

  // DELETE /api/v1/payments/:id
  const paymentDel = path.match(/^\/api\/v1\/payments\/([^/]+)$/);
  if (method === 'DELETE' && paymentDel) {
    const { rowCount } = await dbQuery('payments', 'DELETE', `DELETE FROM payments WHERE id = $1`, [paymentDel[1]]);
    if (!rowCount) return send(res, 404, { code: 'NOT_FOUND', message: 'Payment not found' });
    publish('payments', paymentDel[1], { eventType: 'payment.deleted', paymentId: paymentDel[1] }, { 'event-type': 'payment.deleted' });
    return send(res, 200, { id: paymentDel[1], deleted: true });
  }

  // GET /api/v1/services/health — probe each microservice
  if (method === 'GET' && path === '/api/v1/services/health') {
    const defs = [
      { name: 'orders-service',       port: 3001 },
      { name: 'payments-service',     port: 3002 },
      { name: 'events-service',       port: 3003 },
      { name: 'notification-service', port: 3004 },
    ];
    const results = await Promise.all(defs.map(async d => ({ ...d, ...(await checkServiceHealth(d.port)) })));
    return send(res, 200, { services: results });
  }

  // POST /api/v1/run-tests/microservices — run Playwright microservice suite
  if (method === 'POST' && path === '/api/v1/run-tests/microservices') {
    let stdout = '';
    try {
      ({ stdout } = await execAsync(
        'npx playwright test --project=microservices --reporter=json',
        { cwd: __dirname, timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
      ));
    } catch (e) {
      stdout = e.stdout || '';
    }
    try {
      return send(res, 200, transformPwResults(JSON.parse(stdout)));
    } catch {
      return send(res, 500, { error: 'Failed to parse test output', raw: stdout.slice(0, 500) });
    }
  }

  // POST /api/v1/run-tests/all — run entire Playwright test suite
  if (method === 'POST' && path === '/api/v1/run-tests/all') {
    let stdout = '';
    try {
      ({ stdout } = await execAsync(
        'npx playwright test --reporter=json',
        { cwd: __dirname, timeout: 300000, maxBuffer: 50 * 1024 * 1024 }
      ));
    } catch (e) {
      stdout = e.stdout || '';
    }
    try {
      return send(res, 200, transformAllPwResults(JSON.parse(stdout)));
    } catch {
      return send(res, 500, { error: 'Failed to parse test output', raw: stdout.slice(0, 500) });
    }
  }

  send(res, 404, { code: 'NOT_FOUND', message: `${method} ${path} not found` });
});

// ── Startup ───────────────────────────────────────────────────────
async function start() {
  try {
    await initDB();
  } catch (err) {
    console.error('[mock-server] Database init failed:', err.message);
    process.exit(1);
  }

  connectKafka();

  server.listen(PORT, () => console.log(`Mock API server listening on http://localhost:${PORT}`));
}

start();

// ── Graceful shutdown ─────────────────────────────────────────────
process.on('SIGTERM', async () => {
  await producer.disconnect().catch(() => {});
  await pool.end().catch(() => {});
  server.close();
});
