# Permcheck

[![npm version](https://img.shields.io/npm/v/permcheck?color=blue&label=npm)](https://www.npmjs.com/package/permcheck)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**API safety layer for TypeScript backends.** Validate requests, format structured responses, prevent duplicate processing, rate-limit endpoints, and manage API keys — all with first-class TypeScript types and Zod schemas.

---

## Features

- **Request validation** — Validate `body`, `query`, `params`, and `headers` with Zod schemas
- **Structured responses** — Consistent `ok`, `fail`, `paginated`, and RFC 9457 `problem` response shapes
- **Rate limiting** — In-memory store included; pluggable Redis and Postgres stores for production
- **Idempotency** — Prevent duplicate processing with idempotency keys (`Idempotency-Key` header)
- **API keys** — Validate, hash, scope-check, and authenticate API keys from memory, Redis, or Postgres
- **Framework agnostic** — Core works with any runtime/framework; official Hono adapter included
- **Middleware** — Drop-in `permcheck.middleware()` for auth + rate limiting + idempotency in one call
- **TypeScript strict** — Full type inference with `strict: true` and Zod 4
- **Tree-shakeable** — Deep imports for every module; import only what you need

---

## Installation

```sh
bun add permcheck
```

Requires **Bun >= 1.3.1** and **Zod ^4.4.2** (installed automatically).

---

## Quick Start

```ts
import  createPermcheck  from "permcheck";
import { z } from "zod";

const permcheck = createPermcheck({
  apiKeys: [{ key: "sk-secret-123", scopes: ["read"] }],
  rateLimit: { windowMs: 60_000, max: 10 },
});

// Validate an incoming request
const result = permcheck.validate(
  { body: z.object({ name: z.string() }) },
  { body: { name: "Alice" } }
);

if (!result.success) {
  return permcheck.fail("Validation failed", "VALIDATION_ERROR", result.errors);
}

return permcheck.ok({ name: result.data.body.name });
```

---

## Validation

Validation uses [Zod](https://zod.dev) schemas. The `validate()` method accepts an object with optional `body`, `query`, `params`, and `headers` schemas.

```ts
import { validateRequest } from "permcheck/validate";
// or via permcheck instance:
// permcheck.validate(schemas, request)

const UserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

const result = validateRequest(
  {
    body: UserSchema,
    query: z.object({ page: z.coerce.number().optional() }),
    headers: z.object({ "x-request-id": z.string().optional() }),
  },
  {
    body: { name: "Alice", email: "alice@example.com" },
    query: { page: "2" },
    params: { id: "123" },
    headers: { "x-request-id": "abc-123" },
  }
);

if (!result.success) {
  // result.errors → { body: ["body.name: Required"], query: [...] }
  console.error(result.errors);
} else {
  // result.data → { body: { name: "Alice", ... }, query: { page: 2 } }
  console.log(result.data);
}
```

The standalone `validate(schemas)` function also accepts a `Request` object directly, parsing the JSON body and URL search params automatically:

```ts
import { validate } from "permcheck/validate";

const middleware = async (req: Request) => {
  const result = await validate({
    body: z.object({ title: z.string() }),
    query: z.object({ limit: z.coerce.number() }),
  })(req);

  if (!result.success) return new Response("Invalid", { status: 400 });
  // ...
};
```

---

## Responses

All response helpers return plain objects — serialise them however you like (JSON, Hono `c.json()`, etc.).

### `ok(data)`

```ts
permcheck.ok({ id: 1, name: "Alice" });
// → { success: true, data: { id: 1, name: "Alice" } }
```

### `fail(message, code?, details?)`

```ts
permcheck.fail("Not found", "NOT_FOUND");
// → { success: false, error: { message: "Not found", code: "NOT_FOUND" } }

permcheck.fail("Validation error", "VALIDATION_ERROR", { name: ["Required"] });
// → { success: false, error: { message: "Validation error", code: "VALIDATION_ERROR", details: { name: ["Required"] } } }
```

### `paginated(data, total, page, limit)`

```ts
permcheck.paginated([{ id: 1 }], 42, 1, 10);
// → { success: true, data: [...], pagination: { total: 42, page: 1, limit: 10, pages: 5 } }
```

### `problem(detail)` — RFC 9457 Problem Details

```ts
permcheck.problem({
  type: "https://api.example.com/errors/rate-limit",
  title: "Rate Limit Exceeded",
  status: 429,
  detail: "Too many requests. Retry after 30 seconds.",
  instance: "/api/orders",
});
// → { success: false, error: { ... }, problem: { type, title, status, detail, instance } }
```

---

## Rate Limiting

### Basic usage

```ts
import { createPermcheck, InMemoryRateLimitStore } from "permcheck";

const permcheck = createPermcheck({
  rateLimit: {
    windowMs: 60_000, // 1 minute window
    max: 100, // 100 requests per window
    // store: customStore // optional — defaults to InMemoryRateLimitStore
  },
});

// Usage
const result = await permcheck.rateLimit.check(request);
// → { allowed: boolean, remaining: number, reset: number (epoch ms) }

if (!result.allowed) {
  return permcheck.fail("Too many requests", "RATE_LIMIT_EXCEEDED");
}
```

### Custom key function

```ts
const permcheck = createPermcheck({
  rateLimit: {
    keyFn: (req) => req.headers.get("x-api-key") ?? "anonymous",
  },
});
```

### Redis store

```ts
import { Redis, type Redis as RedisType } from "ioredis";
import { fromIORedis, RedisRateLimitStore } from "permcheck/stores/redis";

const client = new Redis();
const redisClient = fromIORedis(client);

const permcheck = createPermcheck({
  rateLimit: {
    store: new RedisRateLimitStore(redisClient),
    windowMs: 60_000,
    max: 1000,
  },
});
```

### Postgres store

```ts
import { PostgresRateLimitStore } from "permcheck/stores/postgres";
import { sql } from "your-pg-client";

const store = new PostgresRateLimitStore({ query: sql.query.bind(sql) });
await store.ensureTable(); // creates permcheck_rate_limits table
```

---

## Idempotency

Prevent duplicate processing by storing responses keyed by an `Idempotency-Key` header.

```ts
const permcheck = createPermcheck({
  idempotency: {
    // store: customStore   — defaults to InMemoryStore
    keyHeader: "Idempotency-Key", // default
    ttl: 86_400_000, // 24 hours (default)
  },
});

// Check for cached response
const cached = await permcheck.idempotency.getResponse(key);
if (cached) {
  return cached; // return previous response
}

// ... process request ...

// Store the response
await permcheck.idempotency.setResponse(key, responseData);
```

### Redis store

```ts
import { Redis } from "ioredis";
import { fromIORedis, RedisIdempotencyStore } from "permcheck/stores/redis";

const client = new Redis();
const redisClient = fromIORedis(client);

const permcheck = createPermcheck({
  idempotency: {
    store: new RedisIdempotencyStore(redisClient),
  },
});
```

### Postgres store

```ts
import { PostgresIdempotencyStore } from "permcheck/stores/postgres";

const store = new PostgresIdempotencyStore({ query: sql.query.bind(sql) });
await store.ensureTable(); // creates permcheck_idempotency table
```

---

## API Keys

### In-memory validation

```ts
const permcheck = createPermcheck({
  apiKeys: [
    { key: "sk-test-1", scopes: ["read", "write"] },
    { key: "sk-test-2", scopes: ["read"] },
  ],
});

// Direct validation
const result = permcheck.apiKeys.validate("sk-test-1");
// → { authenticated: true, key: "sk-test-1", scopes: ["read", "write"] }

// Authenticate from a Request (extracts Bearer token from Authorization header)
const authenticate = permcheck.apiKeys.authenticate({ requiredScopes: ["read"] });
const authResult = await authenticate(request);
// → { authenticated: true, key: "sk-test-1", scopes: [...], metadata: {...} }
```

### Redis store

```ts
import { Redis } from "ioredis";
import { RedisApiKeyStore } from "permcheck/stores/redis-api-keys";

const client = new Redis();
const store = new RedisApiKeyStore(client);

// Add a key
await store.setKey({ key: "sk-redis-1", scopes: ["admin"] });

// Validate
const result = await store.validate("sk-redis-1");

// Authenticate from request
const authenticate = store.authenticate({ requiredScopes: ["admin"] });
const authResult = await authenticate(request);
```

### Postgres store

```ts
import { PostgresApiKeyStore } from "permcheck/stores/postgres-api-keys";

const store = new PostgresApiKeyStore({ query: sql.query.bind(sql) });
await store.ensureTable(); // creates permcheck_api_keys table

await store.setKey({ key: "sk-pg-1", scopes: ["read"] });
const result = await store.validate("sk-pg-1");
```

---

## Hono Adapter

The `permcheck/adapters/hono` module provides first-class middleware for [Hono](https://hono.dev).

```ts
import { Hono } from "hono";
import { createPermcheck } from "permcheck";
import {
  createRateLimiter,
  requireIdempotencyKey,
  permcheckMiddleware,
} from "permcheck/adapters/hono";

const permcheck = createPermcheck({
  apiKeys: [{ key: "sk-hono-1", scopes: ["read"] }],
  rateLimit: { windowMs: 60_000, max: 30 },
  idempotency: { ttl: 86_400_000 },
});

const app = new Hono();

// Standalone rate limiter middleware (limit/windowMs from permcheck config)
app.use(
  "/api/*",
  createRateLimiter({
    permcheck,
    keyPrefix: "api",
    getKey: (c) => c.req.header("x-forwarded-for") ?? "unknown",
  })
);

// Standalone idempotency middleware
app.post("/api/orders", requireIdempotencyKey({ permcheck }), async (c) => {
  // ...
  return c.json(permcheck.ok({ orderId: "ord_123" }), 201);
});

// Combined middleware (auth + rate limit + idempotency)
app.use(
  "/admin/*",
  permcheckMiddleware(permcheck, {
    auth: true,
    requiredScopes: ["admin"],
    rateLimit: true,
    idempotency: true,
  })
);

app.get("/api/health", (c) => c.json(permcheck.ok({ status: "ok" })));

export default app;
```

### Adapter API

| Middleware              | Description                                                   |
| ----------------------- | ------------------------------------------------------------- |
| `createRateLimiter`     | Rate-limit by a custom key (window/max from permcheck config) |
| `requireIdempotencyKey` | Validates `Idempotency-Key` header, caches responses          |
| `permcheckMiddleware`   | All-in-one: auth + rate limit + idempotency                   |

---

## Deep Imports

Every module can be imported individually for tree-shaking and direct use:

| Subpath Export                       | Exports                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `permcheck`                          | `createPermcheck`, `validateRequest`, `ok`, `fail`, `paginated`, `problem`, types                                    |
| `permcheck/validate`                 | `validateRequest`, `validate`, types                                                                                 |
| `permcheck/respond`                  | `ok`, `fail`, `paginated`, `problem`, types                                                                          |
| `permcheck/idempotency`              | `idempotency`, `InMemoryStore`, types                                                                                |
| `permcheck/rate-limit`               | `rateLimit`, `InMemoryRateLimitStore`, `keyByApiKey`, types                                                          |
| `permcheck/api-keys`                 | `createApiKeyValidator`, types                                                                                       |
| `permcheck/errors`                   | `PermcheckError`, `ValidationError`, `AuthenticationError`, `RateLimitError`, `IdempotencyError`, `isPermcheckError` |
| `permcheck/stores/redis`             | `fromIORedis`, `RedisIdempotencyStore`, `RedisRateLimitStore`                                                        |
| `permcheck/stores/redis-api-keys`    | `RedisApiKeyStore`                                                                                                   |
| `permcheck/stores/postgres`          | `PostgresIdempotencyStore`, `PostgresRateLimitStore`                                                                 |
| `permcheck/stores/postgres-api-keys` | `PostgresApiKeyStore`                                                                                                |
| `permcheck/adapters/hono`            | `createRateLimiter`, `requireIdempotencyKey`, `permcheckMiddleware`                                                  |

---

## Error Handling

Permcheck throws typed errors for programmatic handling, and the `fail()` helper for HTTP responses.

### Error classes

```ts
import {
  PermcheckError,
  ValidationError,
  AuthenticationError,
  RateLimitError,
  IdempotencyError,
  isPermcheckError,
} from "permcheck/errors";
```

| Class                 | Code                   | Status | Description                    |
| --------------------- | ---------------------- | ------ | ------------------------------ |
| `PermcheckError`      | (custom)               | 500    | Base error class               |
| `ValidationError`     | `VALIDATION_ERROR`     | 400    | Invalid request data           |
| `AuthenticationError` | `AUTHENTICATION_ERROR` | 401    | Missing or invalid credentials |
| `RateLimitError`      | `RATE_LIMIT_ERROR`     | 429    | Rate limit exceeded            |
| `IdempotencyError`    | `IDEMPOTENCY_ERROR`    | 409    | Idempotency key conflict       |

Check for Permcheck errors:

```ts
try {
  // ...
} catch (err) {
  if (isPermcheckError(err)) {
    console.error(err.code, err.status, err.message);
  }
}
```

---

## Configuration Reference

### `createPermcheck(options?)`

| Option                  | Type                       | Default                  | Description                                                                        |
| ----------------------- | -------------------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `apiKeys`               | `ApiKeyEntry[]`            | `[]`                     | Static API keys for in-memory validation                                           |
| `client`                | `Client`                   | —                        | client for remote rate-limit, idempotency & API key validation with local fallback |
| `rateLimit.windowMs`    | `number`                   | `60_000`                 | Rate limit window in milliseconds                                                  |
| `rateLimit.max`         | `number`                   | `100`                    | Max requests per window                                                            |
| `rateLimit.store`       | `RateLimitStore`           | `InMemoryRateLimitStore` | Persistent store for rate limit data                                               |
| `rateLimit.keyFn`       | `(req: Request) => string` | IP via `x-forwarded-for` | Function to derive rate limit key                                                  |
| `idempotency.store`     | `IdempotencyStore`         | `InMemoryStore`          | Persistent store for idempotency data                                              |
| `idempotency.keyHeader` | `string`                   | `Idempotency-Key`        | Header name for idempotency key                                                    |
| `idempotency.ttl`       | `number`                   | `86_400_000` (24h)       | Time-to-live for cached responses                                                  |

### `MiddlewareOptions`

| Option           | Type       | Default                          | Description                    |
| ---------------- | ---------- | -------------------------------- | ------------------------------ |
| `auth`           | `boolean`  | `true` if `apiKeys` provided     | Enable API key authentication  |
| `requiredScopes` | `string[]` | `[]`                             | Require specific scopes        |
| `rateLimit`      | `boolean`  | `true` if `rateLimit` configured | Enable rate limiting           |
| `idempotency`    | `boolean`  | `false`                          | Enable idempotency checks      |
| `excludePaths`   | `string[]` | `[]`                             | Path prefixes to skip entirely |

---

## TypeScript

Permcheck is built with TypeScript under `strict: true`. All validation schemas use Zod for full type inference.

```ts
import { z } from "zod";
import type { ValidationSchemas, ValidationResult, SuccessResponse } from "permcheck";

const schemas: ValidationSchemas = {
  body: z.object({ email: z.string().email() }),
  query: z.object({ page: z.coerce.number() }),
};

type Body = z.infer<typeof schemas.body>; // { email: string }

// Response types
const res: SuccessResponse<{ id: string }> = permcheck.ok({ id: "abc" });
// → { success: true, data: { id: "abc" } }
```

Response types are branded with `success: true` / `success: false` for discriminated unions:

```ts
type Response = SuccessResponse<unknown> | ErrorResponse;

function handle(res: Response) {
  if (res.success) {
    // TS narrows to SuccessResponse — access .data
  } else {
    // TS narrows to ErrorResponse — access .error
  }
}
```

---

## License

MIT © [Benson Isaac](https://github.com/bensxn)
