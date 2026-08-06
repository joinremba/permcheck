export interface IdempotencyStore {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, ttl: number): Promise<void>;
  delete(key: string): Promise<void>;
}

const CACHED_RESPONSE_MARKER = "__permcheckCachedResponse";

export interface CachedHttpResponse {
  [CACHED_RESPONSE_MARKER]: true;
  status: number;
  headers: Record<string, string>;
  bodyType: "empty" | "json" | "text";
  body?: unknown;
}

export function isCachedHttpResponse(value: unknown): value is CachedHttpResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)[CACHED_RESPONSE_MARKER] === true &&
    typeof (value as Record<string, unknown>).status === "number"
  );
}

function snapshotHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "content-length") return;
    headers[key] = value;
  });
  return headers;
}

export async function captureHttpResponse(response: Response): Promise<CachedHttpResponse> {
  const headers = snapshotHeaders(response);

  if (response.status === 204 || response.status === 205 || response.body === null) {
    return {
      [CACHED_RESPONSE_MARKER]: true,
      status: response.status,
      headers,
      bodyType: "empty",
    };
  }

  const text = await response.clone().text();
  if (text === "") {
    return {
      [CACHED_RESPONSE_MARKER]: true,
      status: response.status,
      headers,
      bodyType: "empty",
    };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("json")) {
    try {
      return {
        [CACHED_RESPONSE_MARKER]: true,
        status: response.status,
        headers,
        bodyType: "json",
        body: JSON.parse(text),
      };
    } catch {
      // Fall through to text replay for malformed JSON responses.
    }
  }

  return {
    [CACHED_RESPONSE_MARKER]: true,
    status: response.status,
    headers,
    bodyType: "text",
    body: text,
  };
}

export function replayCachedHttpResponse(cached: unknown): Response | null {
  if (!isCachedHttpResponse(cached)) return null;

  const init = {
    status: cached.status,
    headers: cached.headers,
  };

  if (cached.bodyType === "empty") {
    return new Response(null, init);
  }

  if (cached.bodyType === "json") {
    const headers = new Headers(cached.headers);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return new Response(JSON.stringify(cached.body), {
      status: cached.status,
      headers,
    });
  }

  return new Response(String(cached.body ?? ""), init);
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
