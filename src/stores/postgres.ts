import type { IdempotencyStore } from "../idempotency";
import type { RateLimitStore } from "../rate-limit";

export interface PostgresClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const IDEMPOTENCY_TABLE = "gate_idempotency";
const RATE_LIMIT_TABLE = "gate_rate_limits";

export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(
    private client: PostgresClient,
    private tableName: string = IDEMPOTENCY_TABLE
  ) {}

  async ensureTable(): Promise<void> {
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at BIGINT NOT NULL
      )
    `);
  }

  async get(key: string): Promise<unknown | null> {
    const { rows } = await this.client.query(
      `SELECT value, expires_at FROM ${this.tableName} WHERE key = $1 AND expires_at > $2`,
      [key, Date.now()]
    );
    const row = rows[0];
    if (!row) return null;
    const val = row.value as string;
    try {
      return JSON.parse(val) as unknown;
    } catch {
      return val;
    }
  }

  async set(key: string, value: unknown, ttl: number): Promise<void> {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    await this.client.query(
      `INSERT INTO ${this.tableName} (key, value, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = $3`,
      [key, serialized, Date.now() + ttl]
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.query(`DELETE FROM ${this.tableName} WHERE key = $1`, [key]);
  }
}

export class PostgresRateLimitStore implements RateLimitStore {
  constructor(
    private client: PostgresClient,
    private tableName: string = RATE_LIMIT_TABLE
  ) {}

  async ensureTable(): Promise<void> {
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 1,
        reset_at BIGINT NOT NULL
      )
    `);
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; reset: number }> {
    const now = Date.now();
    const reset = now + windowMs;

    const { rows } = await this.client.query(
      `INSERT INTO ${this.tableName} (key, count, reset_at)
       VALUES ($1, 1, $2)
       ON CONFLICT (key) DO UPDATE
         SET count = CASE
           WHEN ${this.tableName}.reset_at <= $3 THEN 1
           ELSE ${this.tableName}.count + 1
         END,
         reset_at = CASE
           WHEN ${this.tableName}.reset_at <= $3 THEN $4
           ELSE ${this.tableName}.reset_at
         END
       RETURNING count, reset_at`,
      [key, reset, now, reset]
    );

    // Best-effort locking hint to prevent write skew under concurrency.
    // Not a full serializable isolation — for production, set the table's
    // fillfactor low or use advisory locks.
    await this.client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [key]);

    const row = rows[0];
    if (!row) return { count: 0, reset: Date.now() + windowMs };
    return { count: row.count as number, reset: row.reset_at as number };
  }

  async reset(key: string): Promise<void> {
    await this.client.query(`DELETE FROM ${this.tableName} WHERE key = $1`, [key]);
  }
}
