export interface ApiKeyEntry {
  key: string;
  scopes?: string[];
  metadata?: Record<string, unknown>;
}

export interface ApiKeyValidatorOptions {
  hashKeys?: boolean;
}

export interface AuthenticateOptions {
  requiredScopes?: string[];
  header?: string;
}

export interface AuthenticateResult {
  authenticated: boolean;
  key?: string;
  scopes?: string[];
  metadata?: Record<string, unknown>;
  error?: string;
}

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function createApiKeyValidator(keys: ApiKeyEntry[], options: ApiKeyValidatorOptions = {}) {
  const { hashKeys = false } = options;
  const keyMap = new Map<
    string,
    { key: string; scopes?: string[]; metadata?: Record<string, unknown> }
  >();

  for (const entry of keys) {
    keyMap.set(entry.key, { key: entry.key, scopes: entry.scopes, metadata: entry.metadata });
  }

  let hashCache: Map<
    string,
    { key: string; scopes?: string[]; metadata?: Record<string, unknown> }
  > | null = null;

  async function ensureHashCache() {
    if (!hashCache) {
      hashCache = new Map();
      for (const [, entry] of keyMap) {
        hashCache.set(await sha256(entry.key), entry);
      }
    }
    return hashCache;
  }

  return {
    validate(providedKey: string): AuthenticateResult {
      const entry = keyMap.get(providedKey);
      if (!entry) {
        return { authenticated: false, error: "Invalid API key" };
      }
      return {
        authenticated: true,
        key: entry.key,
        scopes: entry.scopes,
        metadata: entry.metadata,
      };
    },

    async verify(providedKey: string): Promise<AuthenticateResult> {
      if (!hashKeys) {
        return this.validate(providedKey);
      }
      const cache = await ensureHashCache();
      const keyHash = await sha256(providedKey);
      const entry = cache.get(keyHash);
      if (!entry) {
        return { authenticated: false, error: "Invalid API key" };
      }
      return {
        authenticated: true,
        key: providedKey,
        scopes: entry.scopes,
        metadata: entry.metadata,
      };
    },

    authenticate(options: AuthenticateOptions = {}) {
      const header = options.header ?? "Authorization";
      const requiredScopes = options.requiredScopes ?? [];

      return async (req: Request): Promise<AuthenticateResult> => {
        const authHeader = req.headers.get(header);
        if (!authHeader) {
          return { authenticated: false, error: "Missing API key" };
        }

        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
        const result = hashKeys ? await this.verify(token) : this.validate(token);

        if (!result.authenticated) return result;

        if (requiredScopes.length > 0) {
          const hasScopes = requiredScopes.every((s) => result.scopes?.includes(s));
          if (!hasScopes) {
            return { authenticated: false, error: "Insufficient permissions" };
          }
        }

        return result;
      };
    },
  };
}

export type ApiKeyValidator = ReturnType<typeof createApiKeyValidator>;
