export interface IdempotencyStore {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, ttl: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export class InMemoryStore implements IdempotencyStore {
  private store = new Map<string, { value: unknown; expires: number }>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupInterval = setInterval(() => this.evictExpired(), 60_000);
    if (
      this.cleanupInterval &&
      typeof this.cleanupInterval === "object" &&
      "unref" in this.cleanupInterval
    ) {
      this.cleanupInterval.unref();
    }
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expires) this.store.delete(key);
    }
  }

  async get(key: string): Promise<unknown | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: unknown, ttl: number): Promise<void> {
    this.store.set(key, { value, expires: Date.now() + ttl });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  dispose(): void {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

export interface IdempotencyOptions {
  store: IdempotencyStore;
  keyHeader?: string;
  ttl?: number;
}

export function idempotency(options: IdempotencyOptions) {
  const keyHeader = options.keyHeader ?? "Idempotency-Key";
  const ttl = options.ttl ?? 86_400_000; // 24 hours

  return {
    keyHeader,
    ttl,
    store: options.store,

    async getResponse(key: string) {
      return options.store.get(`idemp:${key}`);
    },

    async setResponse(key: string, response: unknown) {
      await options.store.set(`idemp:${key}`, response, ttl);
    },
  };
}

export type IdempotencyInstance = ReturnType<typeof idempotency>;
