require('dotenv').config({ override: true });
const http = require('http');
const { randomUUID } = require('crypto');
const { Kafka } = require('kafkajs');
const { Pool } = require('pg');

const HEALTH_PORT = process.env.NOTIFICATIONS_HEALTH_PORT || 3004;
const BROKERS     = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',').map(s => s.trim());
const TOPICS      = ['orders', 'payments', 'notifications', 'dead-letter-queue', 'audit-events'];
const startTime   = Date.now() - 1000;
const SVC         = 'notifications-svc';

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

const kafka    = new Kafka({ clientId: 'notification-service', brokers: BROKERS, logCreator: () => () => {} });
const consumer = kafka.consumer({ groupId: 'notification-service-group' });
const producer = kafka.producer({ allowAutoTopicCreation: true });

let consumerReady = false;
let producerReady = false;
let messagesProcessed = 0;
let messagesPoisoned = 0;

async function publish(topic, key, value, headers = {}) {
  if (!producerReady) {
    serverLog('warn', SVC, `Kafka producer not ready — dropped event to ${topic}`, { topic, key });
    return;
  }
  try {
    await producer.send({ topic, messages: [{ key, value: JSON.stringify(value), headers }] });
    serverLog('info', SVC, `Published to ${topic}`, { topic, key, eventType: headers['event-type'] });
  } catch (err) {
    serverLog('error', SVC, `Failed to publish to ${topic}: ${err.message}`, { topic, key });
  }
}

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_log (
      id VARCHAR(36) PRIMARY KEY, topic VARCHAR(255) NOT NULL, key VARCHAR(255),
      event_type VARCHAR(255) NOT NULL, payload JSONB NOT NULL, dedupe_key VARCHAR(600),
      trace_id VARCHAR(36),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`ALTER TABLE event_log ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(600)`);
  await pool.query(`ALTER TABLE event_log ADD COLUMN IF NOT EXISTS trace_id VARCHAR(36)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_log_topic   ON event_log (topic)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_log_created ON event_log (created_at DESC)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_event_log_dedupe_key ON event_log (dedupe_key) WHERE dedupe_key IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_log_trace_id ON event_log (trace_id) WHERE trace_id IS NOT NULL`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kafka_consumer_offsets (
      consumer_group VARCHAR(255) NOT NULL, topic VARCHAR(255) NOT NULL, partition INTEGER NOT NULL,
      committed_offset BIGINT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (consumer_group, topic, partition)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS server_logs (
      id VARCHAR(36) PRIMARY KEY, level VARCHAR(10) NOT NULL,
      source VARCHAR(100) NOT NULL DEFAULT 'server', message TEXT NOT NULL,
      context JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).catch(() => {});
  dbReady = true;
}

async function connectKafka() {
  try {
    await producer.connect();
    producerReady = true;
    serverLog('info', SVC, 'Kafka producer connected');
  } catch (err) {
    serverLog('warn', SVC, `Kafka producer unavailable: ${err.message}`);
  }

  try {
    await consumer.connect();
    for (const topic of TOPICS) {
      await consumer.subscribe({ topic, fromBeginning: false });
    }
    serverLog('info', SVC, `Subscribed to topics: ${TOPICS.join(', ')}`);
    consumerReady = true;

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const key       = message.key?.toString() || null;
        const eventType = message.headers?.['event-type']?.toString() || 'unknown';
        const traceId   = message.headers?.['trace-id']?.toString() || null;
        const rawValue  = message.value ? message.value.toString() : null;

        let payload;
        let parseError = null;
        try { payload = rawValue ? JSON.parse(rawValue) : {}; } catch (err) { parseError = err; }

        if (parseError) {
          // Poison message: the body isn't valid JSON, so there's nothing sensible to
          // log as an event. Route it to the DLQ (with the failure reason attached) and
          // keep consuming — a bad message must never take the consumer down.
          messagesPoisoned++;
          serverLog('warn', SVC, `Poison message on ${topic}: ${parseError.message}`, { topic, partition, key, eventType });
          await publish('dead-letter-queue', key, {
            originalTopic: topic,
            originalPartition: partition,
            originalOffset: message.offset,
            originalEventType: eventType,
            rawValue: rawValue ? rawValue.slice(0, 2000) : null,
            failureReason: 'invalid_json',
            error: parseError.message,
            failedAt: new Date().toISOString(),
          }, { 'event-type': 'message.poisoned', 'original-topic': topic, 'trace-id': traceId || '' });
        } else {
          serverLog('info', SVC, `Consumed ${eventType} from ${topic}`, { topic, partition, key, eventType });

          // Dedupe on (topic, eventType, key) — a redelivered/duplicate message for the
          // same logical event is a no-op instead of a second event_log row. Messages
          // without a key (or two genuinely different event types for the same key,
          // e.g. order.created then order.confirmed) are never deduped against each other.
          const dedupeKey = key ? `${topic}:${eventType}:${key}` : null;

          await dbQuery('event_log', 'INSERT',
            `INSERT INTO event_log (id, topic, key, event_type, payload, dedupe_key, trace_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
            [randomUUID(), topic, key, eventType, payload, dedupeKey, traceId]
          ).catch(err => serverLog('warn', SVC, `event_log insert failed: ${err.message}`, { topic, eventType }));
        }

        await dbQuery('kafka_consumer_offsets', 'UPSERT',
          `INSERT INTO kafka_consumer_offsets (consumer_group, topic, partition, committed_offset, updated_at)
           VALUES ('notification-service-group', $1, $2, $3, NOW())
           ON CONFLICT (consumer_group, topic, partition)
           DO UPDATE SET committed_offset = EXCLUDED.committed_offset, updated_at = NOW()`,
          [topic, partition, message.offset]
        ).catch(() => {});

        messagesProcessed++;
      },
    });
  } catch (err) {
    serverLog('warn', SVC, `Kafka unavailable, running without consumer: ${err.message}`);
  }
}

async function start() {
  await initDB();
  serverLog('info', SVC, 'Database ready');

  // Health server starts immediately — Kafka connects in background
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy', service: 'notification-service', version: '2.0.0',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      consumerReady, producerReady, messagesProcessed, messagesPoisoned,
    }));
  }).listen(HEALTH_PORT, () => serverLog('info', SVC, `Health on port ${HEALTH_PORT}`));

  connectKafka();
}

start().catch(err => { console.error('[notifications] Fatal:', err.message); process.exit(1); });
process.on('SIGTERM', async () => {
  await consumer.disconnect().catch(() => {});
  await producer.disconnect().catch(() => {});
  await pool.end().catch(() => {});
});
