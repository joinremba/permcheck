# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in @joinremba/gate, please report it privately by emailing **bensxnisaac@gmail.com**. Please do not open a public issue.

You can expect an acknowledgement within 48 hours and an initial assessment within 5 business days. We will keep you informed of progress towards a fix and release.

## Supported Versions

Only the latest published version on npm receives security updates. You are encouraged to always use the most recent release.

| Version | Supported |
| ------- | --------- |
| Latest  | Yes       |
| Older   | No        |

## Security Best Practices

When using @joinremba/gate in your project, please follow these guidelines:

- **Validate all input** — Always use Zod schemas to validate request body, query, params, and headers. Never trust raw input from clients.
- **Use rate limiting** — Configure rate limits to protect your endpoints from abuse and denial-of-service attacks.
- **Keep Zod updated** — Zod is the only runtime dependency; keep it up to date to receive security patches.
- **Rotate API keys** — Regularly rotate API keys and avoid hard-coding them in source code. Use environment variables or a secrets manager.
- **Use idempotency for state-changing endpoints** — This prevents duplicate processing and ensures safe retries.
- **Apply the principle of least privilege** — Scope API keys to only the permissions they need.

## Responsible Disclosure

We ask that you give us a reasonable amount of time to fix the issue before disclosing it publicly. We will coordinate with you on the disclosure timeline.
