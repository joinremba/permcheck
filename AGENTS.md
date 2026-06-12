# @remba/gate

API safety layer for TypeScript backends: request validation, structured responses, idempotency, API key management, and rate limiting, all built on Zod schemas.

## Commands

| Command             | Description                            |
| ------------------- | -------------------------------------- |
| `bun test`          | Run tests                              |
| `bun run typecheck` | tsc --noEmit                           |
| `bun run lint`      | ESLint                                 |
| `bun run format`    | Prettier                               |
| `bun run check`     | lint + format:check + typecheck + test |
| `bun run build`     | Build to dist/                         |

## Stack

- **Runtime:** Bun 1.3.1+
- **Language:** TypeScript 6 (strict mode)
- **Validation:** Zod 4.x
- **Code quality:** ESLint 8 + Prettier

## Key Patterns

- All source lives in `src/`
- Tests are colocated with source: `src/*.test.ts`
- Validation uses Zod schemas exclusively
- Design is middleware-friendly and framework-agnostic (Express, Hono, Elysia, Bun.serve)
- Single runtime dependency: `zod`

## npm Publishing

- `package.json` is configured with `publishConfig.access: public`
- CI publishes automatically on `v*` tags via `npm publish --provenance` (see `.github/workflows/publish.yml`)
- A `NPM_TOKEN` secret must be present in the GitHub repository settings

## Config Reference

- **Dependencies:** zod (runtime)
- **Dev dependencies:** @types/bun, typescript, eslint, prettier, @typescript-eslint/\*
- **Licence:** MIT
- **Engines:** bun >= 1.3.1
- **Scripts:** test, typecheck, lint, format, format:check, check, build, prepublishOnly
