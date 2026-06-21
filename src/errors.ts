export class GateError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 500) {
    super(message);
    this.name = "GateError";
    this.code = code;
    this.status = status;
  }
}

export class ValidationError extends GateError {
  readonly issues: unknown[];

  constructor(message: string, issues: unknown[] = []) {
    super(message, "VALIDATION_ERROR", 400);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

export class AuthenticationError extends GateError {
  constructor(message = "Unauthorized") {
    super(message, "AUTHENTICATION_ERROR", 401);
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends GateError {
  readonly retryAfter: number;

  constructor(retryAfter = 60) {
    super("Too many requests", "RATE_LIMIT_ERROR", 429);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class IdempotencyError extends GateError {
  constructor(message = "Idempotency key conflict") {
    super(message, "IDEMPOTENCY_ERROR", 409);
    this.name = "IdempotencyError";
  }
}

export function isGateError(err: unknown): err is GateError {
  return err instanceof GateError;
}
