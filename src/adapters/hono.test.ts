import { expect, test, describe } from "bun:test";
import { Hono } from "hono";
import { createPermcheck } from "../index";
import { createRateLimiter, requireIdempotencyKey, permcheckMiddleware } from "./hono";

function createApp(
  ...middleware: ReturnType<
    typeof createRateLimiter | typeof requireIdempotencyKey | typeof permcheckMiddleware
  >[]
): Hono {
  const app = new Hono();
  app.use(...middleware);
  app.post("/test", (c) => c.json({ success: true, data: { id: "1" } }, 201));
  app.get("/safe", (c) => c.json({ ok: true }));
  return app;
}

describe("createRateLimiter", () => {
  test("allows requests within limit", async () => {
    const permcheck = createPermcheck({ rateLimit: { windowMs: 60000, max: 5 } });
    const app = createApp(createRateLimiter({ permcheck, keyPrefix: "test" }));

    const res = await app.request("http://localhost/test", { method: "POST" });
    expect(res.status).toBe(201);
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("4");
  });

  test("blocks requests over limit", async () => {
    const permcheck = createPermcheck({ rateLimit: { windowMs: 60000, max: 0 } });
    const app = createApp(createRateLimiter({ permcheck, keyPrefix: "test" }));

    const res = await app.request("http://localhost/test", { method: "POST" });
    expect(res.status).toBe(429);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("error");
  });

  test("uses custom getKey function", async () => {
    const permcheck = createPermcheck({ rateLimit: { windowMs: 60000, max: 5 } });
    const app = new Hono();
    app.use(
      createRateLimiter({
        permcheck,
        keyPrefix: "custom",
        getKey: (c) => c.req.header("x-custom") ?? "unknown",
      })
    );
    app.post("/test", (c) => c.json({ ok: true }, 201));

    const res = await app.request("http://localhost/test", {
      method: "POST",
      headers: { "x-custom": "user-42" },
    });
    expect(res.status).toBe(201);
  });

  test("falls back to clientIp then x-forwarded-for", async () => {
    const permcheck = createPermcheck({ rateLimit: { windowMs: 60000, max: 5 } });
    const app = new Hono();
    app.use(createRateLimiter({ permcheck, keyPrefix: "ip" }));
    app.post("/test", (c) => c.json({ ok: true }, 201));

    const res = await app.request("http://localhost/test", {
      method: "POST",
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    expect(res.status).toBe(201);
  });
});

describe("requireIdempotencyKey", () => {
  test("rejects missing key header", async () => {
    const permcheck = createPermcheck({ idempotency: { ttl: 60000 } });
    const app = createApp(requireIdempotencyKey({ permcheck }));

    const res = await app.request("http://localhost/test", { method: "POST" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).message).toContain(
      "Idempotency-Key header is required"
    );
  });

  test("rejects invalid key format", async () => {
    const permcheck = createPermcheck({ idempotency: { ttl: 60000 } });
    const app = createApp(requireIdempotencyKey({ permcheck }));

    const res = await app.request("http://localhost/test", {
      method: "POST",
      headers: { "Idempotency-Key": "short" },
    });
    expect(res.status).toBe(400);
  });

  test("passes through on GET requests", async () => {
    const permcheck = createPermcheck({ idempotency: { ttl: 60000 } });
    const app = new Hono();
    app.use(requireIdempotencyKey({ permcheck }));
    app.get("/safe", (c) => c.json({ ok: true }));

    const res = await app.request("http://localhost/safe");
    expect(res.status).toBe(200);
  });

  test("returns cached response on duplicate key", async () => {
    const permcheck = createPermcheck({ idempotency: { ttl: 60000 } });
    await permcheck.idempotency.setResponse("idemp-dup-key", {
      success: true,
      data: { id: "cached" },
    });
    const app = createApp(requireIdempotencyKey({ permcheck }));

    const res = await app.request("http://localhost/test", {
      method: "POST",
      headers: { "Idempotency-Key": "idemp-dup-key" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.data as Record<string, unknown>).id).toBe("cached");
  });

  test("caches successful response for idempotent re-use", async () => {
    const permcheck = createPermcheck({ idempotency: { ttl: 60000 } });
    const app = createApp(requireIdempotencyKey({ permcheck }));

    const res1 = await app.request("http://localhost/test", {
      method: "POST",
      headers: { "Idempotency-Key": "cache-me" },
    });
    expect(res1.status).toBe(201);

    const cached = await permcheck.idempotency.getResponse("cache-me");
    expect(cached).toBeDefined();
    expect((cached as Record<string, unknown>).body).toEqual({
      success: true,
      data: { id: "1" },
    });
  });

  test("replays cached response status and text body", async () => {
    const permcheck = createPermcheck({ idempotency: { ttl: 60000 } });
    const app = new Hono();
    app.use(requireIdempotencyKey({ permcheck }));
    app.post(
      "/text",
      () =>
        new Response("accepted", {
          status: 202,
          headers: { "Content-Type": "text/plain", "X-Request-Result": "stored" },
        })
    );

    const res1 = await app.request("http://localhost/text", {
      method: "POST",
      headers: { "Idempotency-Key": "cache-text-response" },
    });
    expect(res1.status).toBe(202);

    const res2 = await app.request("http://localhost/text", {
      method: "POST",
      headers: { "Idempotency-Key": "cache-text-response" },
    });
    expect(res2.status).toBe(202);
    expect(res2.headers.get("X-Request-Result")).toBe("stored");
    expect(await res2.text()).toBe("accepted");
  });

  test("caches and replays 204 no-content responses without parsing body", async () => {
    const permcheck = createPermcheck({ idempotency: { ttl: 60000 } });
    const app = new Hono();
    app.use(requireIdempotencyKey({ permcheck }));
    app.post("/empty", (c) => c.body(null, 204));

    const res1 = await app.request("http://localhost/empty", {
      method: "POST",
      headers: { "Idempotency-Key": "cache-empty-response" },
    });
    expect(res1.status).toBe(204);

    const res2 = await app.request("http://localhost/empty", {
      method: "POST",
      headers: { "Idempotency-Key": "cache-empty-response" },
    });
    expect(res2.status).toBe(204);
    expect(await res2.text()).toBe("");
  });
});

describe("permcheckMiddleware", () => {
  test("passes through when no features configured", async () => {
    const permcheck = createPermcheck();
    const app = new Hono();
    app.use(permcheckMiddleware(permcheck));
    app.post("/test", (c) => c.json({ ok: true }));

    const res = await app.request("http://localhost/test", { method: "POST" });
    expect(res.status).toBe(200);
  });

  test("rejects when auth fails", async () => {
    const permcheck = createPermcheck({ apiKeys: [{ key: "sk-valid" }] });
    const app = new Hono();
    app.use(permcheckMiddleware(permcheck, { auth: true }));
    app.post("/test", (c) => c.json({ ok: true }));

    const res = await app.request("http://localhost/test", {
      method: "POST",
      headers: { Authorization: "Bearer sk-wrong" },
    });
    expect(res.status).toBe(401);
  });

  test("rejects when rate limit exceeded", async () => {
    const permcheck = createPermcheck({ rateLimit: { windowMs: 60000, max: 0 } });
    const app = new Hono();
    app.use(permcheckMiddleware(permcheck, { rateLimit: true }));
    app.post("/test", (c) => c.json({ ok: true }));

    const res = await app.request("http://localhost/test", { method: "POST" });
    expect(res.status).toBe(429);
  });
});
