import { expect, test } from "bun:test";
import { createApiKeyValidator } from "./api-keys";

test("validate returns authenticated for matching key", () => {
  const validator = createApiKeyValidator([{ key: "sk-live-abc", scopes: ["read"] }]);
  const result = validator.validate("sk-live-abc");
  expect(result.authenticated).toBe(true);
  expect(result.scopes).toEqual(["read"]);
});

test("validate returns error for unknown key", () => {
  const validator = createApiKeyValidator([{ key: "sk-live-abc" }]);
  const result = validator.validate("sk-live-xyz");
  expect(result.authenticated).toBe(false);
  expect(result.error).toBe("Invalid API key");
});

test("verify with hashKeys true hashes before lookup", async () => {
  const validator = createApiKeyValidator(
    [
      {
        key: "sk-live-123",
        scopes: ["admin"],
      },
    ],
    { hashKeys: true }
  );
  // "sk-live-123" sha256 = 9418b81169b7...
  const result = await validator.verify("sk-live-123");
  expect(result.authenticated).toBe(true);
  expect(result.scopes).toEqual(["admin"]);
});

test("authenticate middleware reads Authorization header", async () => {
  const validator = createApiKeyValidator([{ key: "sk-test", scopes: ["read"] }]);
  const auth = validator.authenticate({ requiredScopes: ["read"] });
  const req = new Request("http://localhost", {
    headers: { Authorization: "Bearer sk-test" },
  });
  const result = await auth(req);
  expect(result.authenticated).toBe(true);
});

test("authenticate rejects missing scopes", async () => {
  const validator = createApiKeyValidator([{ key: "sk-test", scopes: ["read"] }]);
  const auth = validator.authenticate({ requiredScopes: ["write"] });
  const req = new Request("http://localhost", {
    headers: { Authorization: "Bearer sk-test" },
  });
  const result = await auth(req);
  expect(result.authenticated).toBe(false);
  expect(result.error).toBe("Insufficient permissions");
});
