<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

Zeus Chat: a Next.js 16 + TypeScript chat UI for any AI model, Claude Sonnet 5 first. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before touching `src/lib/`. Requirements and their IDs (FR-C1, FR-M5, ...) are in [docs/PRD.md](docs/PRD.md).

## Commands

Use pnpm. Never npm or yarn.

```bash
pnpm install
pnpm dev                                   # http://127.0.0.1:3000 (loopback only)
pnpm test                                  # unit/integration tests, no network
pnpm vitest run src/lib/chat/sse.test.ts   # one file
pnpm lint && pnpm typecheck                # both must pass before you say you are done
pnpm db:generate                           # after editing src/lib/db/schema.ts
pnpm mock                                  # terminal 1: fake Anthropic API on :8787
pnpm dev:mock                              # terminal 2: app on :3001 pointed at the mock
```

`pnpm test:live` calls the real Anthropic API and costs money. Do not run it unless asked. To exercise streaming, Stop, refusal, and error states for free, use the mock pair above; the message text steers it (`slow`, `refuse`, `error`).

## Layout

- `src/lib/providers/` — vendor adapters. The only place `@anthropic-ai/sdk` or any vendor SDK may be imported (ESLint enforces this).
- `src/lib/models/registry.ts` — model IDs, prices, limits, capability flags. Single source of truth.
- `src/lib/chat/` — `sse.ts` encodes `ChatEvent`s for the browser, `sse-parse.ts` decodes them; `run-turn.ts` owns turn persistence; `title.ts` generates titles after replies.
- `src/lib/repo/` — all application SQL, history/search, settings and retention cleanup. Routes and components never query the DB directly.
- `src/lib/env.ts` — the only reader of `process.env`. Server-only; never import from `src/components` or `src/hooks` (ESLint enforces this).
- `src/app/api/` — thin route handlers: validate with Zod, call a lib function, return.

## Rules

- One PRD requirement (or one milestone slice) per PR. Name the FR in the PR title.
- Model IDs come from the registry. Never hard-code `claude-sonnet-5` or any model string outside `registry.ts` and tests.
- Sonnet 5 request shape: `thinking: { type: "adaptive", display: "summarized" }`, effort in `output_config.effort`, streaming always. Never send `temperature`, `top_p`, `top_k`, `budget_tokens`, or an assistant prefill; the API rejects them.
- Use SDK types (`Anthropic.MessageParam`, `Anthropic.Message`, typed error classes). Do not redefine them or string-match error messages.
- Keep the prompt prefix stable: no timestamps, IDs, or per-request values in the system prompt.
- Schema changes go through `pnpm db:generate`; commit the generated files in `src/lib/db/migrations/`. Never edit an applied migration.
- Conversations are append-only. Regenerate truncates a suffix; Continue appends. Never edit a message row's content after it is `complete`.
- Model output is untrusted: render through the sanitized Markdown component; never `dangerouslySetInnerHTML`.
- Every new adapter or event type ships with a fixture-driven test (`anthropic.test.ts` shows the fake-client pattern). Every edge in ARCHITECTURE.md §5 (stop, crash, error, refusal, max_tokens) stays covered.
- Do not add dependencies for things the stack already covers (Zod, Drizzle, react-markdown, Vitest). Ask before adding a UI library.
- Never commit `.env*` (except `.env.example`), `data/`, or anything containing a key.

## Done means

Tests, lint, and typecheck pass. If you changed `providers/anthropic.ts`, confirm the request payload table in ARCHITECTURE.md §4.2 still matches `buildParams`. Update the PRD status table if a requirement moved.
