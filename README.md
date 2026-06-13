# @joinremba/gate

[![npm version](https://img.shields.io/npm/v/@joinremba/gate?logo=npm)](https://www.npmjs.com/package/@joinremba/gate)
[![Licence](https://img.shields.io/npm/l/@joinremba/gate)](LICENSE)
[![CI](https://github.com/joinremba/gate/actions/workflows/ci.yml/badge.svg)](https://github.com/joinremba/gate/actions/workflows/ci.yml)
[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.3.1-black?logo=bun)](https://bun.sh)

Gate is the API safety layer for TypeScript backends. It validates requests, formats responses, prevents duplicate operations, manages API keys, and protects endpoints from abuse.

## Features

- **Request validation** — Validate body, query, params, and headers with Zod schemas.
- **Structured responses** — Consistent `{ success, data, error }` response envelope with `ok()` and `fail()` helpers.
- **Problem details** — RFC 9457 problem-details-style error format.
- **Pagination** — Standardised paginated response helper.
- **Idempotency** — Prevent duplicate writes with idempotency keys. Ships with in-memory store; plug in Redis or Postgres.
- **Rate limiting** — Protect endpoints from abuse with configurable windows and limits.
- **API key management** — Rotatable, scoped API key authentication with Bearer token support.
- **Framework-agnostic** — Use with Express, Hono, Fastify, Elysia, or raw Bun.

## Installation

```sh
bun add @joinremba/gate
```

## Quick Start

```ts
import { createGate, ok } from "@joinremba/gate";
import { z } from "zod";

const gate = createGate({
  apiKeys: [{ key: "sk-abc123", scopes: ["write"] }],
  rateLimit: { windowMs: 60_000, max: 100 },
});

app.post("/transfers", gate.middleware(), async (req, res) => {
  return ok({ message: "Transfer queued" });
});
```

## Modules

Gate is organised into sub-modules that can be imported individually:

```ts
import { validateRequest } from "@joinremba/gate/validate";
import { ok, fail, paginated, problem } from "@joinremba/gate/respond";
import { idempotency, InMemoryStore } from "@joinremba/gate/idempotency";
import { rateLimit, InMemoryRateLimitStore } from "@joinremba/gate/rate-limit";
import { createApiKeyValidator } from "@joinremba/gate/api-keys";
import { GateError, ValidationError, AuthenticationError } from "@joinremba/gate/errors";
```

### `createGate(options?)`

Factory function that returns a `Gate` instance with all modules pre-configured.

```ts
const gate = createGate({
  apiKeys: [
    { key: "sk-read-only", scopes: ["read"] },
    { key: "sk-admin", scopes: ["read", "write", "delete"] },
  ],
  rateLimit: { windowMs: 60_000, max: 50 },
  idempotency: { keyHeader: "Idempotency-Key", ttl: 86_400_000 },
});
```

### Validate (`@joinremba/gate/validate`)

Validate request body, query, params, and headers against Zod schemas.

```ts
import { validateRequest } from "@joinremba/gate/validate";
import { z } from "zod";

const transferSchema = z.object({
  amount: z.number().positive(),
  currency: z.enum(["NGN", "USD", "EUR"]),
  recipient: z.string().min(1),
});

const result = validateRequest({ body: transferSchema }, { body: req.body });

if (!result.success) {
  return gate.fail("Validation failed", "VALIDATION_ERROR", result.errors);
}
```

### Respond (`@joinremba/gate/respond`)

Build consistent API responses.

```ts
import { ok, fail, paginated, problem } from "@joinremba/gate/respond";

// Success
ok({ id: 1, name: "Alice" });
// -> { success: true, data: { id: 1, name: "Alice" } }

// Error
fail("Resource not found", "NOT_FOUND");
// -> { success: false, error: { message: "Resource not found", code: "NOT_FOUND" } }

// Paginated
paginated([{ id: 1 }], 25, 1, 10);
// -> { success: true, data: [...], pagination: { total: 25, page: 1, limit: 10, pages: 3 } }

// Problem details (RFC 9457)
problem({
  type: "https://errors.remba.com/rate-limit",
  title: "Rate Limit Exceeded",
  status: 429,
  detail: "Too many requests, please retry later",
});
```

### Idempotency (`@joinremba/gate/idempotency`)

Prevent duplicate processing of the same request using idempotency keys.

```ts
import { idempotency, InMemoryStore } from "@joinremba/gate/idempotency";

const guard = idempotency({
  store: new InMemoryStore(),
  keyHeader: "Idempotency-Key",
  ttl: 86_400_000, // 24 hours
});

// Check if a request has been processed
const existing = await guard.getResponse(idempotencyKey);
if (existing) return existing;

// Store the response after processing
await guard.setResponse(idempotencyKey, response);
```

Bring your own store by implementing the `IdempotencyStore` interface (Redis, Postgres, etc.).

### Rate Limiting (`@joinremba/gate/rate-limit`)

Protect endpoints from abuse.

```ts
import { rateLimit, InMemoryRateLimitStore } from "@joinremba/gate/rate-limit";

const limiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 30,
  keyFn: (req) => req.headers.get("x-forwarded-for") ?? "global",
});

const { allowed, remaining } = await limiter.check(req);
if (!allowed) throw new RateLimitError();
```

Customise the key function to rate-limit by user ID, API key, or IP.

### API Keys (`@joinremba/gate/api-keys`)

Validates API keys with optional scoped permissions. Designed for **internal** authentication — service-to-service, admin dashboards, cron jobs, webhooks. Not a replacement for user auth (OAuth, JWTs, password login).

```ts
import { createApiKeyValidator } from "@joinremba/gate/api-keys";

const keys = createApiKeyValidator([
  { key: "sk-read-only", scopes: ["read"] },
  { key: "sk-admin", scopes: ["read", "write", "delete"] },
]);

// Direct validation
keys.validate("sk-read-only");
// -> { authenticated: true, key: "sk-read-only", scopes: ["read"] }

// Request authentication middleware
const auth = keys.authenticate({ requiredScopes: ["write"], header: "Authorization" });
const result = auth(request);
if (!result.authenticated) throw new AuthenticationError(result.error);
```

**When to use it:** You have a few static keys for internal services, a shared webhook secret, or scoped tokens for admin tools. Keys are configured at startup and held in memory — no database query per request, zero dependencies.

**When not to use it:** You need key rotation, hashed storage, per-user API keys, expiry/revocation, or rate limiting per key. For those cases, use the hashed or DB-backed stores below.

#### Hashed API Keys

Store SHA-256 hashes instead of plaintext keys. Protects against memory dumps.

```ts
const validator = createApiKeyValidator([{ key: "sk-live-123", scopes: ["admin"] }], {
  hashKeys: true,
});

await validator.verify("sk-live-123");
// -> { authenticated: true, key: "sk-live-123", scopes: ["admin"] }
```

#### DB-backed API Key Stores

Validate keys against Postgres or Redis. Keys can be added/removed at runtime.

```ts
import { PostgresApiKeyStore } from "@joinremba/gate/stores/postgres-api-keys";

const store = new PostgresApiKeyStore(pgClient);
await store.ensureTable();

// Add a key
await store.setKey({ key: "sk-live-abc", scopes: ["read"] }, expiresAt);

// Validate
const result = await store.verify("sk-live-abc");

// Remove
await store.deleteKey("sk-live-abc");
```

```ts
import { RedisApiKeyStore } from "@joinremba/gate/stores/redis-api-keys";

const store = new RedisApiKeyStore(redisClient);
await store.setKey({ key: "sk-redis-key", scopes: ["admin"] });
const result = await store.verify("sk-redis-key");
```

### Combined Middleware

Run auth, rate limiting, and idempotency in a single middleware call:

```ts
const gate = createGate({
  apiKeys: [{ key: "sk-admin" }],
  rateLimit: { windowMs: 60_000, max: 100 },
});

app.use(
  gate.middleware({
    auth: true,
    requiredScopes: ["write"],
    rateLimit: true,
    idempotency: true,
    excludePaths: ["/health", "/metrics"],
  })
);
```

The middleware returns 401 for invalid/missing keys, 429 when rate limited, and caches idempotent responses automatically.

### Per-key Rate Limiting

Rate-limit by API key instead of IP:

```ts
import { rateLimit, keyByApiKey } from "@joinremba/gate/rate-limit";

const limiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyFn: keyByApiKey,
});
```

### Errors (`@joinremba/gate/errors`)

Standard error types for consistent error handling.

| Error                 | Status | Code                   | When                       |
| --------------------- | ------ | ---------------------- | -------------------------- |
| `GateError`           | 500    | `GATE_ERROR`           | Base error type            |
| `ValidationError`     | 400    | `VALIDATION_ERROR`     | Invalid request input      |
| `AuthenticationError` | 401    | `AUTHENTICATION_ERROR` | Missing or invalid API key |
| `RateLimitError`      | 429    | `RATE_LIMIT_ERROR`     | Rate limit exceeded        |
| `IdempotencyError`    | 409    | `IDEMPOTENCY_ERROR`    | Idempotency key conflict   |

## TypeScript Types

```ts
import type {
  Gate,
  GateOptions,
  Middleware,
  ValidationSchemas,
  ValidationResult,
  SuccessResponse,
  ErrorResponse,
  PaginatedResponse,
  ProblemDetails,
  IdempotencyStore,
  IdempotencyOptions,
  RateLimitStore,
  RateLimitOptions,
  RateLimitStrategy,
  ApiKeyEntry,
  AuthenticateOptions,
  AuthenticateResult,
} from "@joinremba/gate";
```

## Examples

### Express middleware

```ts
import express from "express";
import { createGate, ok } from "@joinremba/gate";
import { z } from "zod";

const app = express();
const gate = createGate({ rateLimit: { windowMs: 60_000, max: 30 } });

app.post(
  "/api/orders",
  (req, res, next) => {
    const result = gate.validate(
      { body: z.object({ productId: z.string(), quantity: z.number() }) },
      { body: req.body }
    );
    if (!result.success) {
      return res.status(400).json(gate.fail("Validation failed", undefined, result.errors));
    }
    req.body = result.data.body;
    next();
  },
  async (req, res) => {
    const order = await createOrder(req.body);
    res.json(ok(order));
  }
);
```

### Hono middleware

```ts
import { Hono } from "hono";
import { createGate, ok } from "@joinremba/gate";

const app = new Hono();
const gate = createGate({ apiKeys: [{ key: "sk-admin" }] });

app.use("/api/*", async (c, next) => {
  const auth = gate.apiKeys.authenticate()(c.req.raw);
  if (!auth.authenticated) {
    return c.json(gate.fail("Unauthorized"), 401);
  }
  await next();
});
```

### Combining multiple features

```ts
const gate = createGate({
  apiKeys: [{ key: "sk-admin", scopes: ["write"] }],
  idempotency: { store: new InMemoryStore(), ttl: 86_400_000 },
  rateLimit: { windowMs: 60_000, max: 50 },
});

app.post("/orders", async (req, res, next) => {
  // Rate limit
  const rl = await gate.rateLimit.check(req);
  if (!rl.allowed) return res.status(429).json(gate.fail("Too many requests"));

  // Idempotency
  const idemKey = req.headers.get(gate.idempotency.keyHeader);
  if (idemKey) {
    const cached = await gate.idempotency.getResponse(idemKey);
    if (cached) return res.json(cached);
  }

  // Validate
  const result = gate.validate({ body: z.object({ amount: z.number() }) }, { body: req.body });
  if (!result.success) return res.status(400).json(gate.fail("Validation failed"));

  const response = ok(await processOrder(result.data.body));

  if (idemKey) await gate.idempotency.setResponse(idemKey, response);
  res.json(response);
});
```

## Roadmap

**MVP** (current)

- Request validation (body, query, params, headers)
- Standard success/error responses
- Problem-details error format (RFC 9457)
- Pagination helper
- Request ID support
- Express and Hono middleware examples
- In-memory idempotency store
- In-memory rate limiting store

**V1** (current)

- Redis and Postgres stores for idempotency and rate limiting
- API key hashing and validation
- DB-backed API key stores (Redis, Postgres)
- Combined middleware (auth + rate limit + idempotency)
- Per-key rate limiting helper

**V2**

- API key dashboard
- Usage analytics
- Abuse detection
- Team API key management
- Hosted key verification
- Organisation-level quotas

## Related Packages

- [@joinremba/beacon](https://github.com/joinremba/beacon) — Environment validation, config, secrets, and feature gates.
- [@joinremba/catalog](https://github.com/joinremba/catalog) — Production-ready logging and error event layer built on Pino.

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct, development workflow, and pull request process.

## License

MIT &mdash; see [LICENSE](LICENSE).
