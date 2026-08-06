import { createMiddleware } from "hono/factory";
import type { Permcheck, MiddlewareOptions } from "../index";
import type { Context, Next } from "hono";
import { captureHttpResponse, replayCachedHttpResponse } from "../idempotency";

type HonoRateLimitOptions = {
  permcheck: Permcheck;
  keyPrefix: string;
  message?: string;
  getKey?: (c: Context) => string;
};

export function createRateLimiter({
  permcheck,
  keyPrefix,
  message = "Too many requests",
  getKey,
}: HonoRateLimitOptions) {
  return createMiddleware(async (c: Context, next: Next) => {
    const identifier = getKey
      ? getKey(c)
      : ((c.get("clientIp") as string | undefined) ?? c.req.header("x-forwarded-for") ?? "unknown");

    const result = await permcheck.rateLimit.check(`${keyPrefix}:${identifier}`);

    if (!result.allowed) {
      return c.json({ success: false, error: { message, code: "RATE_LIMIT_EXCEEDED" } }, 429, {
        "Retry-After": String(Math.ceil((result.reset - Date.now()) / 1000)),
        "X-RateLimit-Remaining": "0",
      });
    }

    c.res.headers.set("X-RateLimit-Remaining", String(result.remaining));
    await next();
  });
}

type HonoIdempotencyOptions = {
  permcheck: Permcheck;
  keyHeader?: string;
};

export function requireIdempotencyKey({
  permcheck,
  keyHeader = "Idempotency-Key",
}: HonoIdempotencyOptions) {
  const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

  return createMiddleware(async (c: Context, next: Next) => {
    const safeMethods = ["GET", "HEAD", "OPTIONS"];
    if (safeMethods.includes(c.req.method)) {
      await next();
      return;
    }

    const key = c.req.header(keyHeader)?.trim() ?? "";
    if (!key) {
      return c.json(
        {
          success: false,
          error: { message: `${keyHeader} header is required`, code: "BAD_REQUEST" },
        },
        400
      );
    }
    if (!KEY_PATTERN.test(key)) {
      return c.json(
        {
          success: false,
          error: {
            message: `${keyHeader} must be 8-128 chars (letters, numbers, ., _, :, -)`,
            code: "BAD_REQUEST",
          },
        },
        400
      );
    }

    const cached = await permcheck.idempotency.getResponse(key);
    if (cached) {
      return replayCachedHttpResponse(cached) ?? c.json(cached, 200);
    }

    await next();

    if (c.res.status < 500) {
      permcheck.idempotency.setResponse(key, await captureHttpResponse(c.res)).catch(() => {});
    }
  });
}

export function permcheckMiddleware(permcheck: Permcheck, opts?: MiddlewareOptions) {
  const mw = permcheck.middleware(opts);
  return createMiddleware(async (c: Context, next: Next) => {
    const req = new Request(c.req.raw);
    const res = await mw(req, async () => {
      await next();
      return c.res;
    });
    if (res && res.status >= 400) {
      const body = await res.json();
      return c.json(body, res.status as 200 | 400 | 401 | 429 | 500);
    }
  });
}
