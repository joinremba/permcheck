# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.5] — 2026-08-06

### Fixed

- **Idempotency middleware no longer assumes a JSON response body.** `requireIdempotencyKey` (Hono adapter) and `permcheck.middleware()` called `response.clone().json()` on every successful (<500) response, which threw `Unexpected end of JSON input` on **204 No Content** (e.g. logout) and mangled `text/plain` responses. Responses are now captured as a structured snapshot (status, headers, body type: `empty`/`json`/`text`) and replayed byte-for-byte on key reuse. Legacy plain-object cache entries still replay via the previous 200-JSON path.

## [0.5.4] — 2026-07-09

### Changed

- **Renamed project from Gate to Permcheck** — all types, functions, and exports
  - `Gate` → `Permcheck`, `GateOptions` → `PermcheckOptions`
  - `createGate()` → `createPermcheck()`
  - `HonoRateLimitOptions.gate` → `HonoRateLimitOptions.permcheck`
  - `HonoIdempotencyOptions.gate` → `HonoIdempotencyOptions.permcheck`
  - `requireIdempotencyKey()` parameter `gate` → `permcheck`
  - `createRateLimiter()` parameter `gate` → `permcheck`
  - `gateMiddleware()` → `permcheckMiddleware()`
  - `getGateAuth()` → `getPermcheckAuth()`
  - `getGateIdempotencyKey()` → `getPermcheckIdempotencyKey()`
  - `getGateRateLimit()` → `getPermcheckRateLimit()`
  - `GateError` → `PermcheckError`
  - `isGateError()` → `isPermcheckError()`
  - All re-exports from sub-modules updated accordingly

## [0.5.3] — 2026-06-21

### Fixed

- `RedisApiKeyStore.setKey()` now uses `hset` (hash write) to match `validate()` which reads with `hgetall` — was silently broken with any real Redis client
- `permcheckMiddleware` (Hono) now treats all success codes (200–399) as success instead of rejecting non-200
- `PostgresRateLimitStore.increment()` acquires advisory lock before the upsert instead of after
- `Permcheck.dispose()` added to clean up `InMemoryStore` / `InMemoryRateLimitStore` intervals (memory leak)

### Removed

- Unused `MiddlewareResult` type
- `"sliding"` variant from `RateLimitStrategy` (was throwing "not implemented")

## [0.4.0] — 2026-06-13

### Added

- `client?: Client` option to `createPermcheck()` — accepts a remote client for cloud features
- Cloud rate limiting: `rateLimit.check()` tries `client.checkRateLimit()` first, falls back to local store on `NetworkError`
- Cloud idempotency: `idempotency.getResponse()` / `setResponse()` try cloud first, fall back to local store
- Cloud API key verification: `apiKeys.authenticate()` verifies via `client.verifyApiKey()` with local fallback

## [0.3.0] — 2026-06-12

### Added

- **Hashed API keys** — `createApiKeyValidator(keys, { hashKeys: true })` stores SHA-256 hashes instead of plaintext. New `verify(token)` method for async hash comparison.
- **DB-backed API key stores** — `PostgresApiKeyStore` and `RedisApiKeyStore` validate keys against a `permcheck_api_keys` table / Redis hash. Support `setKey()`, `deleteKey()`, and key expiry.
- **Combined middleware** — `permcheck.middleware({ auth, rateLimit, idempotency })` runs all checks in one call. Rejects with proper status codes (401, 429). Supports `excludePaths`.
- **Per-key rate limiting helper** — `keyByApiKey(req)` extracts Bearer token from Authorization header for use as rate limit key.
- `permcheck/stores/redis-api-keys` and `permcheck/stores/postgres-api-keys` sub-module exports.
- Redis store for idempotency (`RedisIdempotencyStore`) — implements `IdempotencyStore` via `GET`, `SETEX`, `DEL`
- Redis store for rate limiting (`RedisRateLimitStore`) — implements `RateLimitStore` via `INCR`, `EXPIRE`, `DEL`
- Postgres store for idempotency (`PostgresIdempotencyStore`) — implements `IdempotencyStore` via key-value table with TTL expiry
- Postgres store for rate limiting (`PostgresRateLimitStore`) — implements `RateLimitStore` via counter table with sliding window
- Package exports for both stores: `permcheck/stores/redis` and `permcheck/stores/postgres`

## [0.1.0] — 2026-06-12

### Added

- Initial release
- Request validation (body, query, params, headers) with Zod schemas
- Structured JSON response envelope
- Idempotency key support for safe retries
- API key authentication with scoped permissions
- Configurable rate limiting
