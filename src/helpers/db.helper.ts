import { Pool, QueryResult } from 'pg';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config({ override: true });

export interface DbOrder {
  id: string;
  user_id: string;
  status: string;
  amount: number;
  currency: string;
  items: unknown;
  created_at: Date;
  updated_at: Date | null;
}

export interface DbPayment {
  id: string;
  order_id: string;
  status: string;
  amount: number;
  currency: string;
  method: string;
  created_at: Date;
  updated_at: Date | null;
}

export interface DbEventLog {
  id: string;
  topic: string;
  key: string | null;
  event_type: string;
  payload: unknown;
  created_at: Date;
}

export interface DbKafkaOffset {
  consumer_group: string;
  topic: string;
  partition: number;
  committed_offset: number;
  updated_at: Date;
}

export interface InsertOrderParams {
  id?: string;
  user_id: string;
  status?: string;
  amount: number;
  currency?: string;
  items?: unknown;
}

export interface InsertPaymentParams {
  id?: string;
  order_id: string;
  status?: string;
  amount: number;
  currency?: string;
  method?: string;
}

export interface InsertEventLogParams {
  id?: string;
  topic: string;
  key?: string;
  event_type: string;
  payload: unknown;
}

export interface InsertKafkaOffsetParams {
  consumer_group: string;
  topic: string;
  partition: number;
  committed_offset?: number;
}

export class DbHelper {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      host:     process.env.PGHOST     || 'localhost',
      port:     parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'mockdb',
      user:     process.env.PGUSER     || 'mockuser',
      password: process.env.PGPASSWORD || 'mockpass',
    });
  }

  async connect(): Promise<void> {
    const client = await this.pool.connect();
    client.release();
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, params);
  }

  // ── Orders ────────────────────────────────────────────────────────

  async insertOrder(params: InsertOrderParams): Promise<DbOrder> {
    const id = params.id ?? uuidv4();
    const { rows } = await this.pool.query<DbOrder>(
      `INSERT INTO orders (id, user_id, status, amount, currency, items)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, params.user_id, params.status ?? 'created', params.amount, params.currency ?? 'USD', JSON.stringify(params.items ?? [])]
    );
    return rows[0];
  }

  async findOrderById(id: string): Promise<DbOrder | null> {
    const { rows } = await this.pool.query<DbOrder>('SELECT * FROM orders WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  async findOrdersByStatus(status: string): Promise<DbOrder[]> {
    const { rows } = await this.pool.query<DbOrder>('SELECT * FROM orders WHERE status = $1 ORDER BY created_at', [status]);
    return rows;
  }

  async findOrdersByUserId(userId: string): Promise<DbOrder[]> {
    const { rows } = await this.pool.query<DbOrder>('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at', [userId]);
    return rows;
  }

  async updateOrderStatus(id: string, status: string): Promise<DbOrder | null> {
    const { rows } = await this.pool.query<DbOrder>(
      `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );
    return rows[0] ?? null;
  }

  async deleteOrder(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('DELETE FROM orders WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  async countOrders(status?: string): Promise<number> {
    const { rows } = status
      ? await this.pool.query<{ count: string }>('SELECT COUNT(*) as count FROM orders WHERE status = $1', [status])
      : await this.pool.query<{ count: string }>('SELECT COUNT(*) as count FROM orders');
    return parseInt(rows[0].count);
  }

  // ── Payments ──────────────────────────────────────────────────────

  async insertPayment(params: InsertPaymentParams): Promise<DbPayment> {
    const id = params.id ?? uuidv4();
    const { rows } = await this.pool.query<DbPayment>(
      `INSERT INTO payments (id, order_id, status, amount, currency, method)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, params.order_id, params.status ?? 'pending', params.amount, params.currency ?? 'USD', params.method ?? 'credit_card']
    );
    return rows[0];
  }

  async findPaymentById(id: string): Promise<DbPayment | null> {
    const { rows } = await this.pool.query<DbPayment>('SELECT * FROM payments WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  async findPaymentsByOrderId(orderId: string): Promise<DbPayment[]> {
    const { rows } = await this.pool.query<DbPayment>('SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at', [orderId]);
    return rows;
  }

  async findPaymentsByStatus(status: string): Promise<DbPayment[]> {
    const { rows } = await this.pool.query<DbPayment>('SELECT * FROM payments WHERE status = $1 ORDER BY created_at', [status]);
    return rows;
  }

  async updatePaymentStatus(id: string, status: string): Promise<DbPayment | null> {
    const { rows } = await this.pool.query<DbPayment>(
      `UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );
    return rows[0] ?? null;
  }

  async deletePayment(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('DELETE FROM payments WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  async countPayments(status?: string): Promise<number> {
    const { rows } = status
      ? await this.pool.query<{ count: string }>('SELECT COUNT(*) as count FROM payments WHERE status = $1', [status])
      : await this.pool.query<{ count: string }>('SELECT COUNT(*) as count FROM payments');
    return parseInt(rows[0].count);
  }

  // ── Event Log ─────────────────────────────────────────────────────

  async insertEventLog(params: InsertEventLogParams): Promise<DbEventLog> {
    const id = params.id ?? uuidv4();
    const { rows } = await this.pool.query<DbEventLog>(
      `INSERT INTO event_log (id, topic, key, event_type, payload)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, params.topic, params.key ?? null, params.event_type, JSON.stringify(params.payload)]
    );
    return rows[0];
  }

  async findEventsByTopic(topic: string): Promise<DbEventLog[]> {
    const { rows } = await this.pool.query<DbEventLog>(
      'SELECT * FROM event_log WHERE topic = $1 ORDER BY created_at',
      [topic]
    );
    return rows;
  }

  async findEventsByType(eventType: string): Promise<DbEventLog[]> {
    const { rows } = await this.pool.query<DbEventLog>(
      'SELECT * FROM event_log WHERE event_type = $1 ORDER BY created_at',
      [eventType]
    );
    return rows;
  }

  async findEventsByKey(key: string): Promise<DbEventLog[]> {
    const { rows } = await this.pool.query<DbEventLog>(
      'SELECT * FROM event_log WHERE key = $1 ORDER BY created_at',
      [key]
    );
    return rows;
  }

  async countEvents(topic?: string): Promise<number> {
    const { rows } = topic
      ? await this.pool.query<{ count: string }>('SELECT COUNT(*) as count FROM event_log WHERE topic = $1', [topic])
      : await this.pool.query<{ count: string }>('SELECT COUNT(*) as count FROM event_log');
    return parseInt(rows[0].count);
  }

  // ── Kafka Consumer Offsets ────────────────────────────────────────

  async upsertKafkaOffset(params: InsertKafkaOffsetParams): Promise<DbKafkaOffset> {
    const { rows } = await this.pool.query<DbKafkaOffset>(
      `INSERT INTO kafka_consumer_offsets (consumer_group, topic, partition, committed_offset)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (consumer_group, topic, partition)
       DO UPDATE SET committed_offset = EXCLUDED.committed_offset, updated_at = NOW()
       RETURNING *`,
      [params.consumer_group, params.topic, params.partition, params.committed_offset ?? 0]
    );
    return rows[0];
  }

  async findKafkaOffset(consumerGroup: string, topic: string, partition: number): Promise<DbKafkaOffset | null> {
    const { rows } = await this.pool.query<DbKafkaOffset>(
      'SELECT * FROM kafka_consumer_offsets WHERE consumer_group = $1 AND topic = $2 AND partition = $3',
      [consumerGroup, topic, partition]
    );
    return rows[0] ?? null;
  }

  async deleteKafkaOffset(consumerGroup: string, topic: string, partition: number): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM kafka_consumer_offsets WHERE consumer_group = $1 AND topic = $2 AND partition = $3',
      [consumerGroup, topic, partition]
    );
    return (rowCount ?? 0) > 0;
  }
}
