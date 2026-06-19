import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export interface DbOrder {
  id: string;
  user_id: string;
  status: string;
  amount: number;
  currency: string;
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

  async findOrderById(id: string): Promise<DbOrder | null> {
    const { rows } = await this.pool.query<DbOrder>('SELECT * FROM orders WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  async findPaymentById(id: string): Promise<DbPayment | null> {
    const { rows } = await this.pool.query<DbPayment>('SELECT * FROM payments WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  async countOrders(): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>('SELECT COUNT(*) as count FROM orders');
    return parseInt(rows[0].count);
  }

  async countPayments(): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>('SELECT COUNT(*) as count FROM payments');
    return parseInt(rows[0].count);
  }
}
