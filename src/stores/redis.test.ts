import { expect, test } from "bun:test";
import { RedisIdempotencyStore, RedisRateLimitStore, type RedisClient } from "./redis";

function mockRedisClient(): RedisClient {
  const store = new Map<string, { value: string; expires: number }>();
  return {
    async get(key: string) {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expires) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(_key: string, _value: string, _opts?: { ex?: number }) {
      // not used by current impl
    },
    async setex(key: string, seconds: number, value: string) {
      store.set(key, { value, expires: Date.now() + seconds * 1000 });
    },
    async incr(key: string) {
      const entry = store.get(key);
      if (!entry) {
        store.set(key, { value: "1", expires: Infinity });
        return 1;
      }
      const next = Number(entry.value) + 1;
      store.set(key, { value: String(next), expires: entry.expires });
      return next;
    },
    async ttl(key: string) {
      const entry = store.get(key);
      if (!entry) return -2;
      const remaining = Math.ceil((entry.expires - Date.now()) / 1000);
      return remaining > 0 ? remaining : -2;
    },
    async expire(key: string, _seconds: number) {
      const entry = store.get(key);
      if (entry) {
        store.set(key, { ...entry, expires: Date.now() + _seconds * 1000 });
        return 1;
      }
      return 0;
    },
    async del(key: string) {
      return store.delete(key) ? 1 : 0;
    },
  };
}

test("RedisIdempotencyStore set and get", async () => {
  const client = mockRedisClient();
  const store = new RedisIdempotencyStore(client);
  await store.set("order:42", { status: "confirmed" }, 60_000);
  const result = await store.get("order:42");
  expect(result).toEqual({ status: "confirmed" });
});

test("RedisIdempotencyStore returns null for missing key", async () => {
  const client = mockRedisClient();
  const store = new RedisIdempotencyStore(client);
  const result = await store.get("nonexistent");
  expect(result).toBeNull();
});

test("RedisRateLimitStore increment", async () => {
  const client = mockRedisClient();
  const store = new RedisRateLimitStore(client);
  const first = await store.increment("user:1", 60_000);
  expect(first.count).toBe(1);
  const second = await store.increment("user:1", 60_000);
  expect(second.count).toBe(2);
});

test("RedisRateLimitStore reset", async () => {
  const client = mockRedisClient();
  const store = new RedisRateLimitStore(client);
  await store.increment("user:1", 60_000);
  await store.reset("user:1");
  const result = await store.increment("user:1", 60_000);
  expect(result.count).toBe(1);
});
