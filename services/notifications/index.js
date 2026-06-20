require('dotenv').config();
const http = require('http');
const { randomUUID } = require('crypto');
const { Kafka } = require('kafkajs');
const { Pool } = require('pg');

const HEALTH_PORT = process.env.NOTIFICATIONS_HEALTH_PORT || 3004;
const BROKERS     = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',').map(s => s.trim());
const TOPICS      = ['orders', 'payments', 'notifications', 'dead-letter-queue', 'audit-events'];
const startTime   = Date.now() - 1000;

const pool = new Pool({
  host: process.env.PGHOST || 'localhost', port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'mockdb', user: process.env.PGUSER || 'mockuser',
  password: process.env.PGPASSWORD || 'mockpass',
});

const kafka    = new Kafka({ clientId: 'notification-service', brokers: BROKERS, logCreator: () => () => {} });
const consumer = kafka.consumer({ groupId: 'notification-service-group' });

let consumerReady = false;
let messagesProcessed = 0;

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_log (
      id VARCHAR(36) PRIMARY KEY, topic VARCHAR(255) NOT NULL, key VARCHAR(255),
      event_type VARCHAR(255) NOT NULL, payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_log_topic   ON event_log (topic)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_log_created ON event_log (created_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kafka_consumer_offsets (
      consumer_group VARCHAR(255) NOT NULL, topic VARCHAR(255) NOT NULL, partition INTEGER NOT NULL,
      committed_offset BIGINT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (consumer_group, topic, partition)
    )`);
}

async function connectKafka() {
  try {
    await consumer.connect();
    for (const topic of TOPICS) {
      await consumer.subscribe({ topic, fromBeginning: false });
    }
    console.log('[notifications] Subscribed to topics:', TOPICS.join(', '));
    consumerReady = true;

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const key       = message.key?.toString() || null;
        const eventType = message.headers?.['event-type']?.toString() || 'unknown';
        let payload     = {};
        try { payload = message.value ? JSON.parse(message.value.toString()) : {}; } catch {}

        await pool.query(
          `INSERT INTO event_log (id, topic, key, event_type, payload)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
          [randomUUID(), topic, key, eventType, payload]
        ).catch(err => console.warn('[notifications] event_log insert failed:', err.message));

        await pool.query(
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
    console.warn('[notifications] Kafka unavailable, running without consumer:', err.message);
  }
}

async function start() {
  await initDB();
  console.log('[notifications] Database ready');

  // Health server starts immediately — Kafka connects in background
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy', service: 'notification-service', version: '2.0.0',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      consumerReady, messagesProcessed,
    }));
  }).listen(HEALTH_PORT, () => console.log(`[notifications] Health on port ${HEALTH_PORT}`));

  connectKafka();
}

start().catch(err => { console.error('[notifications] Fatal:', err.message); process.exit(1); });
process.on('SIGTERM', async () => { await consumer.disconnect().catch(() => {}); await pool.end().catch(() => {}); });
