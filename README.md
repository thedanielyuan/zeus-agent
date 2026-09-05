# Zeus Chat

A self-hosted chat interface for talking to any AI model through one UI. Version 1 ships with Claude Sonnet 5; other models plug in through a small provider adapter.

**Status:** M1 chat core and M2 history implemented and validated offline. Conversations, settings, search, automatic titles, Markdown/JSON exports and 30-day soft deletion are backed by SQLite. Cost accounting and edit-and-regenerate follow in M3. Real provider acceptance has not been run. See the [PRD](docs/PRD.md), [architecture](docs/ARCHITECTURE.md), and [M2 validation](docs/M2-VALIDATION.md).

## What it does

- Streams replies token by token, with Stop, Retry, and Continue.
- Shows Claude's summarized thinking in a collapsible panel and lets you pick an effort level.
- Restores saved conversations at their own URLs, with searchable history, editable automatic titles and Markdown/JSON downloads.
- Saves conversation settings and global defaults, appearance and thinking visibility in SQLite.
- Hides deleted chats immediately and removes their stored records after 30 days, with cleanup at startup and hourly while running.
- Records final token usage, with prompt caching enabled. Interrupted usage stays unknown; cost tracking arrives in M3.
- Never sends your API key to the browser and never sends anything anywhere except the model vendor.

## Requirements

- Node 24
- pnpm
- An Anthropic API key with access to `claude-sonnet-5`

## Quick start

```bash
pnpm install
```

Copy `.env.example` to `.env.local` and fill in your key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Then start the dev server (it binds to loopback only):

```bash
pnpm dev
```

Open http://127.0.0.1:3000. The database is created at `./data/zeus.db` on the first page load. Existing databases migrate automatically when opened. Back up the database and restart the server when upgrading so pending migrations and recovery run before serving history.

## Run without an API key

`scripts/mock-anthropic.mjs` is a tiny server that speaks the real Anthropic Messages streaming protocol, so the whole stack runs for free. In one terminal:

```bash
pnpm mock
```

In another:

```bash
pnpm dev:mock
```

Open http://127.0.0.1:3001. Type `slow` for a long reply (try Stop), `refuse` for a refusal, `cut off` for Continue, or `code` for syntax highlighting. Error fixtures: `auth error`, `rate limit`, `error` (overload), and `retry once` (fails through the SDK retries, then succeeds when you press Retry).

The mock also supplies automatic titles. With a real provider, the first completed reply triggers one additional low-effort title call (up to 128 output tokens, 30-second deadline); a failed title leaves the first-message fallback.

Mock turns use `./data/mock.db`, separate from your real chat database. The script supplies a dummy key and clears any inherited auth token. Stop another dev server in the same checkout before starting this one.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server with hot reload on 127.0.0.1:3000 |
| `pnpm build` then `pnpm start` | Production build and serve |
| `pnpm test` | Unit and integration tests (no network) |
| `pnpm test:live` | One real streamed turn against the API; needs `ANTHROPIC_API_KEY`, costs money |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Next route typegen, then `tsc --noEmit` |
| `pnpm db:generate` | Generate a migration after editing the schema |
| `pnpm db:migrate` | Apply pending SQLite migrations (the app also does this at startup) |
| `pnpm mock` / `pnpm dev:mock` | Fake Anthropic API on :8787 and the app on :3001 pointed at it |

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required for the Anthropic provider |
| `ZEUS_DB_PATH` | `./data/zeus.db` | SQLite file location |
| `ZEUS_LOG_LEVEL` | `info` | Set `debug` for request shapes (message content is never logged) |

## Project layout

```
docs/            PRD and architecture
scripts/         mock Anthropic server
src/app/         Next.js routes and API handlers
src/components/  UI
src/hooks/       client-side streaming hook
src/lib/         providers, model registry, db, chat transport, errors
data/            SQLite database (gitignored)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full tree and the provider interface.

## Adding a model or provider

Add the model to `src/lib/models/registry.ts`. If it is a new vendor, implement `ChatProvider` in `src/lib/providers/<vendor>.ts` and register it. The architecture doc §4.3 has the five steps. Nothing else in the app should need to change.

## Roadmap

| Milestone | Scope |
|---|---|
| M0 | Scaffold: one streamed round-trip from the browser |
| M1 | Chat core: stop, retry, errors, refusal handling, Markdown |
| M2 | Implemented: durable history, settings, sidebar, search, export, auto-titles, retention |
| M3 | Polish: cost tracking, edit and regenerate, theme, accessibility |
| M4 | Second provider and mid-conversation model switching |

Details and acceptance criteria are in the [PRD](docs/PRD.md) §10.

## Working with AI coding agents

[AGENTS.md](AGENTS.md) holds the repo conventions for any coding agent. [CLAUDE.md](CLAUDE.md) adds Claude Code specifics.

## License

TBD.
