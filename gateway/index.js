require('dotenv').config();
const http = require('http');
const { randomUUID } = require('crypto');

const PORT      = process.env.PORT || 3000;
const startTime = Date.now() - 1000;
const SVC       = 'gateway';

function log(level, message, context = null) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, source: SVC, message, ...(context || {}) }));
}

const SERVICES = {
  orders:        process.env.ORDERS_SERVICE_URL        || 'http://localhost:3001',
  payments:      process.env.PAYMENTS_SERVICE_URL      || 'http://localhost:3002',
  events:        process.env.EVENTS_SERVICE_URL        || 'http://localhost:3003',
  notifications: process.env.NOTIFICATIONS_SERVICE_URL || 'http://localhost:3004',
};

function routeTo(path) {
  if (path.startsWith('/api/v1/orders'))   return SERVICES.orders;
  if (path.startsWith('/api/v1/payments')) return SERVICES.payments;
  if (path.startsWith('/api/v1/events'))   return SERVICES.events;
  return null;
}

function forward(req, res, baseUrl) {
  // Assign a trace id at the edge if the caller didn't bring one — every
  // downstream service reads this same header off the forwarded request.
  const traceId = (req.headers['x-trace-id'] || '').toString() || randomUUID();
  const target = new URL(req.url, baseUrl);
  const options = {
    hostname: target.hostname, port: target.port || 80,
    path: target.pathname + target.search, method: req.method,
    headers: { ...req.headers, host: target.host, 'x-trace-id': traceId },
  };
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxyReq.on('error', (err) => {
    log('error', `Bad gateway forwarding to ${baseUrl}: ${err.message}`, { service: baseUrl, traceId });
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 'BAD_GATEWAY', service: baseUrl, message: err.message }));
  });
  req.pipe(proxyReq, { end: true });
}

function checkHealth(name, url) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    http.get(`${url}/health`, { timeout: 2000 }, (res) => {
      res.resume();
      resolve({ name, status: res.statusCode === 200 ? 'up' : 'degraded', latency: Date.now() - t0 });
    }).on('error', () => resolve({ name, status: 'down', latency: -1 }))
      .on('timeout', function() { this.destroy(); resolve({ name, status: 'down', latency: -1 }); });
  });
}

const server = http.createServer(async (req, res) => {
  const url    = new URL(req.url, `http://localhost:${PORT}`);
  const path   = url.pathname;
  const method = req.method.toUpperCase();
  const t0     = Date.now();

  if (path !== '/health' && path !== '/ready') {
    const origEnd = res.end.bind(res);
    res.end = function (...args) {
      log('info', `${method} ${path} → ${res.statusCode}`, { method, path, status: res.statusCode, ms: Date.now() - t0 });
      res.end = origEnd;
      return origEnd(...args);
    };
  }

  if (method === 'GET' && path === '/health') {
    const checks = await Promise.all(
      Object.entries(SERVICES).map(([name, url]) => checkHealth(name, url))
    );
    const allUp  = checks.every(c => c.status === 'up');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status:       allUp ? 'healthy' : 'degraded',
      version:      '2.0.0',
      uptime:       Math.floor((Date.now() - startTime) / 1000),
      dependencies: checks,   // backward-compat key used by health tests
      services:     checks,   // semantic key for service mesh visibility
    }));
  }

  if (method === 'GET' && path === '/ready') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ready' }));
  }

  const target = routeTo(path);
  if (!target) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ code: 'NOT_FOUND', message: `${method} ${path} not found` }));
  }

  forward(req, res, target);
});

server.listen(PORT, () => log('info', `Listening on http://localhost:${PORT}`));
process.on('SIGTERM', () => server.close());
