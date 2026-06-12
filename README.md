# @remba/gate

[![npm version](https://img.shields.io/npm/v/@remba/gate?logo=npm)](https://www.npmjs.com/package/@remba/gate)
[![Licence](https://img.shields.io/npm/l/@remba/gate)](LICENSE)
[![CI](https://github.com/joinremba/gate/actions/workflows/ci.yml/badge.svg)](https://github.com/joinremba/gate/actions/workflows/ci.yml)
[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.3.1-black?logo=bun)](https://bun.sh)

Gate is the API safety layer for TypeScript backends. It validates requests, formats responses, prevents duplicate operations, manages API keys, and protects endpoints from abuse.

## Features

- **Request validation** — Validate body, query, params, and headers with Zod schemas.
- **Structured responses** — Consistent `{ success, data, error }` response envelope.
- **Idempotency** — Prevent duplicate writes with idempotency keys.
- **API key management** — Rotatable, scoped API key authentication.
- **Rate limiting** — Protect endpoints from abuse with configurable rate limits.

## Installation

```sh
bun add @remba/gate
```

## Quick Start

```ts
import { createGate } from "@remba/gate";

const gate = createGate();

// Use with your HTTP framework
app.use(gate.middleware());
```

## API Reference

### `createGate(options?)`

Factory function that returns a Gate instance. Accepts an optional `GateOptions` object to configure validation, idempotency, API keys, and rate limiting.

**Middleware mode** — Call `gate.middleware()` to obtain a framework-agnostic middleware function that can be plugged into Express, Hono, Elysia, or any Bun-native server.

**Direct usage** — Use the returned `gate.validate()`, `gate.idempotent()`, `gate.authenticate()`, and `gate.limit()` functions directly for per-route control.

```ts
import { createGate } from "@remba/gate";

const gate = createGate({
  apiKeys: ["sk-abc123"],
  rateLimit: { windowMs: 60_000, max: 100 },
});
```

### Request Validation

Validate incoming request body, query string, route params, and headers against Zod schemas. Returns a structured result.

```ts
import { z } from "zod";

const bodySchema = z.object({ name: z.string() });
const result = gate.validate({ body: bodySchema }, request);
```

### Structured Response Envelope

All responses follow a consistent envelope:

```ts
{ success: true, data: { ... } }
{ success: false, error: { message: "...", code: "..." } }
```

Use `gate.success(data)` and `gate.error(message, code?)` to build responses.

### Idempotency Key Interface

Idempotency keys prevent duplicate processing of the same request. Send an `Idempotency-Key` header on POST/PUT/PATCH requests. Gate will cache the response and return it for subsequent requests with the same key.

```ts
const gate = createGate({ idempotency: { store: new Map(), ttl: 86_400_000 } });
```

A custom store can be provided (e.g. Redis-backed) by implementing the `IdempotencyStore` interface.

### API Key Management

Gate supports API key authentication with optional scoped permissions. Provide keys to the factory or validate them at runtime.

```ts
const gate = createGate({
  apiKeys: [
    { key: "sk-read-only", scopes: ["read"] },
    { key: "sk-admin", scopes: ["read", "write", "delete"] },
  ],
});

// Per-route check
gate.authenticate(request, { requiredScopes: ["write"] });
```

### Rate Limiting

Configure rate limits per endpoint or globally. Supports sliding window and fixed window strategies.

```ts
const gate = createGate({
  rateLimit: { windowMs: 60_000, max: 100, strategy: "sliding" },
});
```

A custom store (in-memory, Redis, etc.) can be provided for distributed deployments.

### TypeScript Types

The following types are exported:

- `GateOptions` — Configuration object for `createGate`
- `ValidationTarget` — `"body" | "query" | "params" | "headers"`
- `ValidationSchema` — Zod schema or record of Zod schemas
- `StructuredResponse<T>` — `{ success: true, data: T } | { success: false, error: ErrorPayload }`
- `ErrorPayload` — `{ message: string; code?: string }`
- `IdempotencyOptions` — Idempotency configuration
- `IdempotencyStore` — Interface for custom idempotency backing stores
- `ApiKeyConfig` — API key with optional scopes
- `RateLimitOptions` — Rate limit configuration
- `RateLimitStrategy` — `"fixed" | "sliding"`
- `GateInstance` — Return type of `createGate`

## Examples

### Basic request validation with Zod

```ts
import { createGate } from "@remba/gate";
import { z } from "zod";

const gate = createGate();
const userSchema = z.object({ name: z.string().min(1), email: z.string().email() });

Bun.serve({
  port: 3000,
  async fetch(req) {
    const result = gate.validate({ body: userSchema }, req);
    if (!result.success) {
      return new Response(JSON.stringify(result), { status: 400 });
    }
    return new Response(JSON.stringify(gate.success(result.data)), { status: 201 });
  },
});
```

### Structured error responses

```ts
const gate = createGate();

// Success
gate.success({ id: 1, name: "Alice" });
// -> { success: true, data: { id: 1, name: "Alice" } }

// Error
gate.error("Resource not found", "NOT_FOUND");
// -> { success: false, error: { message: "Resource not found", code: "NOT_FOUND" } }
```

### Idempotency for POST endpoints

```ts
const gate = createGate({ idempotency: { store: new Map(), ttl: 86_400_000 } });

app.post("/orders", gate.idempotent(), async (req) => {
  const order = await createOrder(req.body);
  return gate.success(order);
});

// Client sends Idempotency-Key: abc-123 in the header.
// Subsequent requests with the same key return the cached response.
```

### API key authentication

```ts
const gate = createGate({
  apiKeys: [
    { key: "sk-1a2b3c", scopes: ["read"] },
    { key: "sk-admin", scopes: ["read", "write"] },
  ],
});

app.get("/users", gate.authenticate({ requiredScopes: ["read"] }), async (req) => {
  return gate.success(await listUsers());
});
```

### Rate limiting configuration

```ts
const gate = createGate({
  rateLimit: {
    windowMs: 60_000,
    max: 30,
    strategy: "sliding",
  },
});

app.get("/api/data", gate.limit(), async (req) => {
  return gate.success(await fetchData());
});
```

### Combining multiple features

```ts
const gate = createGate({
  apiKeys: [{ key: "sk-admin", scopes: ["write"] }],
  idempotency: { store: new Map(), ttl: 86_400_000 },
  rateLimit: { windowMs: 60_000, max: 50 },
});

app.post(
  "/orders",
  gate.authenticate({ requiredScopes: ["write"] }),
  gate.idempotent(),
  gate.limit(),
  async (req) => {
    const result = gate.validate(
      { body: z.object({ productId: z.string(), quantity: z.number() }) },
      req
    );
    if (!result.success) {
      return new Response(JSON.stringify(result), { status: 400 });
    }
    const order = await createOrder(result.data);
    return gate.success(order);
  }
);
```

## Related Packages

- [@remba/beacon](https://github.com/joinremba/beacon) — Structured logging and telemetry for TypeScript backends.
- [@remba/catalog](https://github.com/joinremba/catalog) — API catalog and documentation from Zod schemas.

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct, development workflow, and pull request process.

## License

MIT &mdash; see [LICENSE](LICENSE).
