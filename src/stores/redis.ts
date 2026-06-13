import type { IdempotencyStore } from "../idempotency";
import type { RateLimitStore } from "../rate-limit";

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  del(key: string): Promise<number>;
}

export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(private client: RedisClient) {}

  async get(key: string): Promise<unknown | null> {
    const val = await this.client.get(key);
    if (!val) return null;
    try {
      return JSON.parse(val) as unknown;
    } catch {
      return val;
    }
  }

  async set(key: string, value: unknown, ttl: number): Promise<void> {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    await this.client.setex(key, Math.ceil(ttl / 1000), serialized);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private client: RedisClient) {}

  async increment(key: string, windowMs: number): Promise<{ count: number; reset: number }> {
    const windowSeconds = Math.ceil(windowMs / 1000);
    const count = await this.client.incr(key);

    if (count === 1) {
      await this.client.expire(key, windowSeconds);
    }

    const ttlSeconds = await this.client.ttl(key);
    const remainingMs = ttlSeconds > 0 ? ttlSeconds * 1000 : windowMs;
    const reset = Date.now() + remainingMs;

    return { count, reset };
  }

  async reset(key: string): Promise<void> {
    await this.client.del(key);
  }
}
