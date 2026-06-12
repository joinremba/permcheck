# Contributing to @remba/gate

Thank you for your interest in contributing to Gate! We welcome contributions from everyone, whether it is a bug fix, a new feature, or improved documentation.

Please note that this project is released with a [Contributor Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to abide by its terms.

## Getting Started

### Prerequisites

- **Bun 1.3.1+** — This project uses Bun as its runtime and package manager. [Install Bun](https://bun.sh/docs/installation) if you have not already.
- **Git** — For version control.

### Setup

1. Fork the repository on GitHub.
2. Clone your fork:

   ```sh
   git clone https://github.com/joinremba/gate.git
   cd gate
   ```

3. Install dependencies:

   ```sh
   bun install
   ```

4. Create a branch for your work:

   ```sh
   git checkout -b feature/your-feature-name
   ```

## Development Commands

| Command             | Description                                   |
| ------------------- | --------------------------------------------- |
| `bun test`          | Run tests                                     |
| `bun run typecheck` | TypeScript type checking                      |
| `bun run lint`      | ESLint                                        |
| `bun run format`    | Prettier (write)                              |
| `bun run check`     | All checks (lint + format + typecheck + test) |
| `bun run build`     | Build to `dist/`                              |

Run `bun run check` before submitting your pull request to ensure everything passes.

## Code Style

- **Prettier + ESLint** are enforced. Run `bun run lint` and `bun run format:check` to verify your code.
- **Strict TypeScript** is enabled via `tsconfig.json`. The `strict` flag and additional checks (`noUncheckedIndexedAccess`, `noImplicitOverride`) are on.
- **No `any` types** — The ESLint rule `@typescript-eslint/no-explicit-any` is set to `error`. Test files are exempt from this rule.
- **Use `bun`** as the package manager. Never use `npm`, `npx`, or `yarn`.

## Testing Guidelines

- Write tests for all new functionality and bug fixes.
- Place tests alongside source files: `src/*.test.ts`.
- Use `bun:test` (the built-in Bun test runner) — do not import from `vitest`, `jest`, or other frameworks.
- Aim for high coverage, especially on validation and idempotency logic.
- Run `bun test` before committing.

## Pull Request Process

1. Ensure `bun run check` passes with no errors or warnings.
2. Keep pull requests focused — one feature or bug fix per PR.
3. Write a clear PR description including the motivation for the change and the approach taken.
4. Update the README if the public API changes.
5. Add or update tests to cover your changes.
6. Request review from a maintainer.
7. Maintainers will merge once the CI pipeline passes and the review is approved.

## Conventional Commits

We follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages:

```
type(scope): description
```

**Types:** `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `style`, `ci`

**Examples:**

- `feat(gate): add IP-based rate limiting strategy`
- `fix(gate): handle malformed idempotency keys gracefully`
- `docs: update API reference with rate limit examples`
- `test(gate): add unit tests for API key validation`

## Reporting Issues

### Bug Reports

When reporting a bug, please include:

- A clear description of the expected behaviour and what actually happened.
- Steps to reproduce the issue, including a minimal code snippet if applicable.
- Environment details: Bun version, OS, and package version.

### Feature Requests

When suggesting a feature, please describe:

- The problem you are trying to solve.
- The proposed solution and how it would work.
- Any alternative approaches you have considered.

## Getting Help

If you have questions or need help getting started, please open a [discussion](https://github.com/joinremba/gate/discussions) or [issue](https://github.com/joinremba/gate/issues).

## License

By contributing, you agree that your contributions will be licensed under the MIT Licence.
