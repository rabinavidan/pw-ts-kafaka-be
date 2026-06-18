// Stateful mock API server with Kafka event publishing — no extra dependencies
require('dotenv').config();
const http = require('http');
const { randomUUID } = require('crypto');
const { Kafka } = require('kafkajs');

const PORT      = process.env.PORT || 3000;
const BROKERS   = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',').map(s => s.trim());
const startTime = Date.now() - 1000;

// ── Kafka producer (fire-and-forget, non-blocking) ────────────────
const kafka    = new Kafka({ clientId: 'mock-server', brokers: BROKERS, logCreator: () => () => {} });
const producer = kafka.producer({ allowAutoTopicCreation: true });

let producerReady = false;

function startServer() {
  server.listen(PORT, () => {
    console.log(`Mock API server listening on http://localhost:${PORT}`);
  });
}

producer.connect()
  .then(() => {
    producerReady = true;
    console.log('[mock-server] Kafka producer connected');
    startServer();
  })
  .catch(err => {
    console.warn('[mock-server] Kafka unavailable, events will not be published:', err.message);
    startServer();
  });

async function publish(topic, key, value, headers = {}) {
  // Always log for the UI event feed, regardless of Kafka availability
  eventLog.push({
    id:        randomUUID(),
    topic,
    key,
    eventType: (headers['event-type'] || 'unknown').toString(),
    payload:   value,
    timestamp: new Date().toISOString(),
  });
  if (eventLog.length > 200) eventLog.splice(0, eventLog.length - 200);

  if (!producerReady) return;
  try {
    await producer.send({
      topic,
      messages: [{ key, value: JSON.stringify(value), headers }],
    });
  } catch (err) {
    console.warn(`[mock-server] Failed to publish to ${topic}:`, err.message);
  }
}

// ── In-memory stores ──────────────────────────────────────────────
const orders        = new Map(); // id → Order
const payments      = new Map(); // id → Payment
const orderPayments = new Map(); // orderId → paymentId
const eventLog      = [];        // last 200 published events (for UI feed)

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

// ── Router ────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url    = new URL(req.url, `http://localhost:${PORT}`);
  const path   = url.pathname;
  const method = req.method.toUpperCase();

  // ── Health ────────────────────────────────────────────────────
  if (method === 'GET' && path === '/health') {
    return send(res, 200, {
      status: 'healthy',
      version: '1.0.0',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      dependencies: [
        { name: 'kafka',    status: 'up', latency: 2 },
        { name: 'database', status: 'up', latency: 1 },
      ],
    });
  }

  if (method === 'GET' && path === '/ready') {
    return send(res, 200, { status: 'ready' });
  }

  // GET /api/v1/events  (live Kafka event feed for UI)
  if (method === 'GET' && path === '/api/v1/events') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10), 200);
    return send(res, 200, { events: eventLog.slice(-limit).reverse() });
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

    const now   = new Date().toISOString();
    const items = (body.items || []).map(i => ({ ...i, price: 100 }));
    const order = {
      id:        randomUUID(),
      userId:    body.userId,
      status:    'created',
      amount:    items.length > 0 ? items.length * 100 : 100,
      currency:  body.currency || 'USD',
      items,
      createdAt: now,
      updatedAt: now,
    };
    orders.set(order.id, order);
    send(res, 201, order);

    // Publish OrderEvent
    publish('orders', order.id, {
      orderId:   order.id,
      userId:    order.userId,
      status:    'created',
      amount:    order.amount,
      currency:  order.currency,
      items:     order.items,
      createdAt: order.createdAt,
    }, { 'event-type': 'order.created' });

    return;
  }

  // GET /api/v1/orders  (list + filter)
  if (method === 'GET' && path === '/api/v1/orders') {
    const statusFilter = url.searchParams.get('status');
    const page         = Math.max(1, parseInt(url.searchParams.get('page')     || '1',  10));
    const pageSize     = Math.max(1, parseInt(url.searchParams.get('pageSize') || '10', 10));

    let items = Array.from(orders.values());
    if (statusFilter) items = items.filter(o => o.status === statusFilter);

    const start = (page - 1) * pageSize;
    return send(res, 200, {
      items:    items.slice(start, start + pageSize),
      total:    items.length,
      page,
      pageSize,
      hasNext:  start + pageSize < items.length,
    });
  }

  // PUT /api/v1/orders/:id/confirm
  const orderConfirm = path.match(/^\/api\/v1\/orders\/([^/]+)\/confirm$/);
  if ((method === 'PUT' || method === 'PATCH') && orderConfirm) {
    const order = orders.get(orderConfirm[1]);
    if (!order) return send(res, 404, { code: 'NOT_FOUND', message: 'Order not found' });
    order.status    = 'confirmed';
    order.updatedAt = new Date().toISOString();
    send(res, 200, order);

    publish('orders', order.id, {
      orderId:   order.id,
      userId:    order.userId,
      status:    'confirmed',
      amount:    order.amount,
      currency:  order.currency,
      items:     order.items,
      createdAt: order.createdAt,
    }, { 'event-type': 'order.confirmed' });

    return;
  }

  // PUT /api/v1/orders/:id/cancel
  const orderCancel = path.match(/^\/api\/v1\/orders\/([^/]+)\/cancel$/);
  if ((method === 'PUT' || method === 'PATCH') && orderCancel) {
    const order = orders.get(orderCancel[1]);
    if (!order) return send(res, 404, { code: 'NOT_FOUND', message: 'Order not found' });
    order.status    = 'cancelled';
    order.updatedAt = new Date().toISOString();
    send(res, 200, order);

    publish('orders', order.id, {
      orderId:   order.id,
      userId:    order.userId,
      status:    'cancelled',
      amount:    order.amount,
      currency:  order.currency,
      items:     order.items,
      createdAt: order.createdAt,
    }, { 'event-type': 'order.cancelled' });

    return;
  }

  // GET /api/v1/orders/:id
  const orderById = path.match(/^\/api\/v1\/orders\/([^/]+)$/);
  if (method === 'GET' && orderById) {
    const order = orders.get(orderById[1]);
    if (!order) return send(res, 404, { code: 'NOT_FOUND', message: 'Order not found' });
    return send(res, 200, order);
  }

  // ── Payments ──────────────────────────────────────────────────

  // POST /api/v1/payments
  if (method === 'POST' && path === '/api/v1/payments') {
    const body = await readBody(req);

    if (!body.orderId) {
      return send(res, 422, { code: 'VALIDATION_ERROR', message: 'orderId is required' });
    }

    // Simulated failure → route to DLQ
    if (body.simulateFailure) {
      const order = orders.get(body.orderId);
      send(res, 201, { id: randomUUID(), orderId: body.orderId, status: 'failed' });

      publish('dead-letter-queue', body.orderId, {
        originalEvent:  order || { orderId: body.orderId },
        failureReason:  'payment_failed',
        failedAt:       new Date().toISOString(),
      }, { 'event-type': 'payment.failed', 'original-topic': 'orders' });

      return;
    }

    if (orderPayments.has(body.orderId)) {
      return send(res, 409, { code: 'CONFLICT', message: 'Payment already exists for this order' });
    }

    const order   = orders.get(body.orderId);
    const payment = {
      id:          randomUUID(),
      orderId:     body.orderId,
      status:      'pending',
      amount:      body.amount ?? order?.amount ?? 100,
      currency:    body.currency || order?.currency || 'USD',
      method:      body.method || 'credit_card',
      createdAt:   new Date().toISOString(),
    };
    payments.set(payment.id, payment);
    orderPayments.set(body.orderId, payment.id);
    send(res, 201, payment);

    publish('payments', payment.id, {
      paymentId:   payment.id,
      orderId:     payment.orderId,
      status:      'pending',
      amount:      payment.amount,
      currency:    payment.currency,
      method:      payment.method,
      processedAt: payment.createdAt,
    }, { 'event-type': 'payment.initiated' });

    return;
  }

  // PUT /api/v1/payments/:id/process
  const paymentProcess = path.match(/^\/api\/v1\/payments\/([^/]+)\/process$/);
  if ((method === 'PUT' || method === 'PATCH') && paymentProcess) {
    const payment = payments.get(paymentProcess[1]);
    if (!payment) return send(res, 404, { code: 'NOT_FOUND', message: 'Payment not found' });
    payment.status    = 'processed';
    payment.updatedAt = new Date().toISOString();
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
    const payment = payments.get(paymentRefund[1]);
    if (!payment) return send(res, 404, { code: 'NOT_FOUND', message: 'Payment not found' });
    payment.status    = 'refunded';
    payment.updatedAt = new Date().toISOString();
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
    const payment = payments.get(paymentFail[1]);
    if (!payment) return send(res, 404, { code: 'NOT_FOUND', message: 'Payment not found' });
    payment.status    = 'failed';
    payment.updatedAt = new Date().toISOString();
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
    const payment = payments.get(paymentById[1]);
    if (!payment) return send(res, 404, { code: 'NOT_FOUND', message: 'Payment not found' });
    return send(res, 200, payment);
  }

  // ── 404 fallthrough ───────────────────────────────────────────
  send(res, 404, { code: 'NOT_FOUND', message: `${method} ${path} not found` });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await producer.disconnect().catch(() => {});
  server.close();
});
