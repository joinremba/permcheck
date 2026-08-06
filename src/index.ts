import { validateRequest } from "./validate";
import { ok, fail, paginated, problem } from "./respond";
import {
  captureHttpResponse,
  idempotency,
  InMemoryStore,
  replayCachedHttpResponse,
} from "./idempotency";
import { rateLimit, InMemoryRateLimitStore, keyByApiKey } from "./rate-limit";
import type { RateLimitStore, RateLimitCheckResult } from "./rate-limit";
import { createApiKeyValidator } from "./api-keys";
import type { ApiKeyEntry, AuthenticateResult } from "./api-keys";
import type { IdempotencyStore } from "./idempotency";
import type { Client } from "./internal/client";
import { NetworkError } from "./internal/errors";

const permcheckAuthStore = new WeakMap<Request, AuthenticateResult>();
const permcheckIdempotencyStore = new WeakMap<Request, string>();
const permcheckRateLimitStore = new WeakMap<Request, RateLimitCheckResult>();

export function getPermcheckAuth(req: Request): AuthenticateResult | undefined {
  return permcheckAuthStore.get(req);
}

export function getPermcheckIdempotencyKey(req: Request): string | undefined {
  return permcheckIdempotencyStore.get(req);
}

export function getPermcheckRateLimit(req: Request): RateLimitCheckResult | undefined {
  return permcheckRateLimitStore.get(req);
}
import {
  PermcheckError,
  ValidationError,
  AuthenticationError,
  RateLimitError,
  IdempotencyError,
  isPermcheckError,
} from "./errors";

export {
  validateRequest,
  ok,
  fail,
  paginated,
  problem,
  idempotency,
  InMemoryStore,
  rateLimit,
  InMemoryRateLimitStore,
  keyByApiKey,
  createApiKeyValidator,
  PermcheckError,
  ValidationError,
  AuthenticationError,
  RateLimitError,
  IdempotencyError,
  isPermcheckError,
};

export type { ValidationSchemas, ValidationResult, ValidatedRequest } from "./validate";
export type {
  SuccessResponse,
  ErrorResponse,
  ErrorPayload,
  PaginatedResponse,
  ProblemDetails,
  StructuredResponse,
} from "./respond";
export type { IdempotencyStore, IdempotencyOptions, IdempotencyInstance } from "./idempotency";
export type { RateLimitStore, RateLimitOptions, RateLimitInstance } from "./rate-limit";
export type {
  ApiKeyEntry,
  AuthenticateOptions,
  AuthenticateResult,
  ApiKeyValidator,
  ApiKeyValidatorOptions,
} from "./api-keys";

export type Middleware = (req: Request, next?: () => Promise<Response>) => Promise<Response | null>;

export interface MiddlewareOptions {
  auth?: boolean;
  requiredScopes?: string[];
  rateLimit?: boolean;
  idempotency?: boolean;
  /** Paths to skip entirely. */
  excludePaths?: string[];
}

export interface PermcheckOptions {
  apiKeys?: ApiKeyEntry[];
  client?: Client;
  idempotency?: {
    store?: IdempotencyStore;
    keyHeader?: string;
    ttl?: number;
  };
  rateLimit?: {
    windowMs?: number;
    max?: number;
    store?: RateLimitStore;
    keyFn?: (req: Request) => string;
  };
}

export interface Permcheck {
  validate: typeof validateRequest;
  ok: typeof ok;
  fail: typeof fail;
  paginated: typeof paginated;
  problem: typeof problem;
  idempotency: ReturnType<typeof idempotency>;
  rateLimit: ReturnType<typeof rateLimit>;
  apiKeys: ReturnType<typeof createApiKeyValidator>;
  middleware(opts?: MiddlewareOptions): Middleware;
  dispose(): void;
}

export function createPermcheck(options: PermcheckOptions = {}): Permcheck {
  const client = options.client;

  const idempInstance = idempotency({
    store: options.idempotency?.store ?? new InMemoryStore(),
    keyHeader: options.idempotency?.keyHeader,
    ttl: options.idempotency?.ttl,
  });

  const rlInstance = rateLimit({
    windowMs: options.rateLimit?.windowMs,
    max: options.rateLimit?.max,
    store: options.rateLimit?.store,
    keyFn: options.rateLimit?.keyFn,
  });

  const apiKeyValidator = createApiKeyValidator(options.apiKeys ?? []);

  if (client) {
    const origCheck = rlInstance.check.bind(rlInstance);
    rlInstance.check = async (reqOrKey) => {
      const key = typeof reqOrKey === "string" ? reqOrKey : rlInstance.keyFn(reqOrKey);
      try {
        return await client.checkRateLimit(key);
      } catch (err) {
        if (err instanceof NetworkError) return origCheck(reqOrKey);
        throw err;
      }
    };

    const origIdemGet = idempInstance.getResponse.bind(idempInstance);
    const origIdemSet = idempInstance.setResponse.bind(idempInstance);
    idempInstance.getResponse = async (key: string) => {
      try {
        const result = await client.checkIdempotency(key);
        if (result.exists) return result.response;
        return null;
      } catch (err) {
        if (err instanceof NetworkError) return origIdemGet(key);
        throw err;
      }
    };
    idempInstance.setResponse = async (key: string, response: unknown) => {
      try {
        await client.setIdempotency(key, response);
      } catch (err) {
        if (err instanceof NetworkError) return origIdemSet(key, response);
        throw err;
      }
    };

    const origAuthenticate = apiKeyValidator.authenticate.bind(apiKeyValidator);
    apiKeyValidator.authenticate = (authOptions) => {
      const handler = origAuthenticate(authOptions);
      return async (req) => {
        const token = req.headers
          .get("Authorization")
          ?.replace(/^Bearer\s+/i, "")
          .trim();
        if (token) {
          try {
            const result = await client.verifyApiKey(token);
            if (result.valid) {
              return { authenticated: true, key: token, scopes: result.scopes };
            }
            return { authenticated: false, error: "Invalid API key" };
          } catch (err) {
            if (!(err instanceof NetworkError)) throw err;
          }
        }
        return handler(req);
      };
    };
  }

  const defaultFail = (message: string, code?: string) => fail(message, code ?? "UNAUTHORIZED");

  const permcheck: Permcheck = {
    validate: validateRequest,
    ok,
    fail,
    paginated,
    problem,
    idempotency: idempInstance,
    rateLimit: rlInstance,
    apiKeys: apiKeyValidator,

    dispose(): void {
      const idemStore = idempInstance.store;
      if (
        idemStore &&
        "dispose" in idemStore &&
        typeof (idemStore as { dispose: () => void }).dispose === "function"
      ) {
        (idemStore as { dispose: () => void }).dispose();
      }
      const rlStore = rlInstance.store;
      if (
        rlStore &&
        "dispose" in rlStore &&
        typeof (rlStore as { dispose: () => void }).dispose === "function"
      ) {
        (rlStore as { dispose: () => void }).dispose();
      }
    },

    middleware(opts?: MiddlewareOptions) {
      const {
        auth = options.apiKeys != null && options.apiKeys.length > 0,
        requiredScopes,
        rateLimit: enableRl = options.rateLimit != null,
        idempotency: enableIdem = false,
        excludePaths = [],
      } = opts ?? {};

      return async (req: Request, next?: () => Promise<Response>) => {
        if (!next) return null;

        const path = new URL(req.url).pathname;
        if (excludePaths.some((p) => path === p || path.startsWith(p))) {
          return next();
        }

        // Rate limit check
        if (enableRl) {
          const rlResult = await rlInstance.check(req);
          permcheckRateLimitStore.set(req, rlResult);
          if (!rlResult.allowed) {
            const body = defaultFail("Too many requests", "RATE_LIMIT_EXCEEDED");
            return new Response(JSON.stringify(body), {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": String(Math.ceil((rlResult.reset - Date.now()) / 1000)),
                "X-RateLimit-Remaining": "0",
              },
            });
          }
        }

        // Auth check
        if (auth) {
          const authFn = apiKeyValidator.authenticate({ requiredScopes });
          const authResult = await authFn(req);
          if (!authResult.authenticated) {
            const body = defaultFail(authResult.error ?? "Unauthorized", "AUTHENTICATION_ERROR");
            return new Response(JSON.stringify(body), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
          permcheckAuthStore.set(req, authResult);
        }

        // Idempotency check
        if (enableIdem) {
          const idemKey = req.headers.get(idempInstance.keyHeader);
          if (idemKey) {
            const cached = await idempInstance.getResponse(idemKey);
            if (cached) {
              return (
                replayCachedHttpResponse(cached) ??
                new Response(JSON.stringify(cached), {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                })
              );
            }
            permcheckIdempotencyStore.set(req, idemKey);
          }
        }

        const response = await next();
        if (!response) return null;

        // Store response for idempotency
        if (enableIdem) {
          const idemKey = permcheckIdempotencyStore.get(req);
          if (idemKey && response.status < 500) {
            await idempInstance.setResponse(idemKey, await captureHttpResponse(response));
          }
        }

        return response;
      };
    },
  };

  return permcheck;
}

export default createPermcheck;
