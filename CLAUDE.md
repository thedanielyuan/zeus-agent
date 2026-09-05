# CLAUDE.md

@AGENTS.md

Claude Code specifics on top of the shared rules above.

## Skills

- Load the `claude-api` skill before editing anything in `src/lib/providers/anthropic.ts` or the registry. Model IDs, thinking, effort, and caching rules drift; the skill is authoritative over memory. Use the exact ID `claude-sonnet-5` with no date suffix.
- Use the `agents-md-writer` skill when updating this file or AGENTS.md.

## Plan mode

Enter plan mode and get approval before changing:

- `src/lib/providers/types.ts` (the `ChatEvent` union or `ChatProvider` interface)
- `src/lib/db/schema.ts` or adding a migration
- anything under `src/app/api/chat/`

Everything else: just do it, one FR per PR.

## Working style

- Verify in the browser with the in-app browser pane, not by reading code alone, for any UI change. Send, Stop, and Retry must be exercised.
- Never run `pnpm test:live` or hit the real API without being asked; unit tests use the fake provider.
- Never put a key in a command, a file, or a log line. `ANTHROPIC_API_KEY` is read by the SDK from the environment only.
- Scratch files go in the session scratchpad, not the repo.

## Git

- Branch from `main`; never commit directly to `main`.
- Commit messages: `<area>: <imperative summary> (FR-xx)`, for example `providers: map refusal stop_details to ChatEvent (FR-M7)`.
- PR body: what changed, which PRD requirement it closes, how it was verified. Do not merge; the owner merges.
