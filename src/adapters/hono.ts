import { createMiddleware } from "hono/factory";
import type { Gate, MiddlewareOptions } from "../index";
import type { Context, Next } from "hono";

type HonoRateLimitOptions = {
  gate: Gate;
  keyPrefix: string;
  message?: string;
  getKey?: (c: Context) => string;
};

export function createRateLimiter({
  gate,
  keyPrefix,
  message = "Too many requests",
  getKey,
}: HonoRateLimitOptions) {
  return createMiddleware(async (c: Context, next: Next) => {
    const identifier = getKey
      ? getKey(c)
      : ((c.get("clientIp") as string | undefined) ?? c.req.header("x-forwarded-for") ?? "unknown");

    const result = await gate.rateLimit.check(`${keyPrefix}:${identifier}`);

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
  gate: Gate;
  keyHeader?: string;
};

export function requireIdempotencyKey({
  gate,
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

    const cached = await gate.idempotency.getResponse(key);
    if (cached) {
      return c.json(cached, 200);
    }

    const originalJson = c.json.bind(c);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c.json as any) = (body: unknown, status?: number, headers?: Record<string, string>) => {
      if (status === undefined || status < 500) {
        gate.idempotency.setResponse(key, body).catch(() => {});
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return originalJson(body, status as any, headers);
    };

    await next();
  });
}

export function gateMiddleware(gate: Gate, opts?: MiddlewareOptions) {
  const mw = gate.middleware(opts);
  return createMiddleware(async (c: Context, next: Next) => {
    const req = new Request(c.req.raw);
    const res = await mw(req, async () => {
      await next();
      return c.res;
    });
    if (res && res.status !== 200) {
      const body = await res.json();
      return c.json(body, res.status as 200 | 400 | 401 | 429 | 500);
    }
  });
}
