# M1 chat core validation

Date: 2026-09-06. Scope: FR-C1–C5, FR-M1–M7, FR-E1–E4, FR-X1–X4 and the minimal persistence needed for their lifecycle. Validation uses fixtures and a local mock provider. No real Anthropic API call or paid live test was run.

## Automated checks

- `pnpm test`: 80 tests pass; the single live-provider test remains skipped.
- `pnpm lint`: passes, including the repaired client/server import boundary.
- `pnpm typecheck`: passes.
- `pnpm build`: production build passes.
- `pnpm db:generate`: generated migration `0001_lame_azazel.sql` adds nullable refusal-details JSON; earlier migrations remain unchanged.

`chat/run-turn.test.ts` uses scripted normalized provider events and real SQLite databases. It covers transactional insertion before provider I/O; 250 ms checkpoints even when no next token arrives; Stop and reader cancellation; a hung provider's ten-minute deadline; refusal, output cutoff, context limits, provider error, unexpected EOF, and thrown exceptions; null interrupted usage; immutable completed rows; Retry suffix replacement; Continue appending; context filtering; stable prompt prefixes; overlapping turns; duplicate and mismatched IDs; deleted conversations; transaction rollback; failed final writes; and reopening disk-backed rows/checkpoints.

`api/chat/route.test.ts` covers the persisted SSE response and server message ID, same-origin validation including Next's localhost normalization, invalid and legacy transcript-shaped requests, unknown models, missing credentials, the 1 MB UTF-8 limit (including chunked bodies), concurrent requests, cancellation, and exception redaction. Provider and Markdown tests cover error mapping, request shape, sanitized output, token colors in both themes, and unknown-language fallback.

## Browser and database checks

Agent-browser drove an isolated copy of the working tree with Next.js 16.3.4, the real Anthropic SDK, and `scripts/mock-anthropic.mjs` on loopback. The test database was a fresh temporary file, separate from the owner's database. The existing development server was left running.

| Flow | Observed result |
|---|---|
| Send `code example` | Thinking and text stream, final usage is stored, code displays multiple token colors, no HTML insertion. |
| Send `slow response`, then Stop | Partial words remain visible and match the stored interrupted row; all usage fields are null. Mock logs confirm the upstream connection closed. |
| Retry the stopped turn | Completes through `word80`; the user row and earlier context remain unchanged, with exactly one replacement assistant row. |
| Send `refuse this fixture` | UI displays `general_harms` and the fixture explanation; both persist in refusal-details JSON. |
| Send `cut off fixture`, then Continue | The cutoff row stays complete with `max_tokens`; Continue appends `Continue.` and a new assistant row. |
| Send `retry once browser fixture`, then Retry | The SDK exhausts its retries with an overload message; user Retry succeeds without another user row. |
| Send `auth error fixture` and `rate limit fixture` | Distinct authentication and rate-limit messages, persisted error codes, and Retry controls. |
| New chat, then return to the first conversation | Subsequent turns append to the correct SQLite conversation; 20 messages across two conversations after the scenario suite. |
| Light/dark and 360 px viewport | Code colors change with theme, composer remains usable, and document scroll width equals viewport width. |
| Missing credentials | Setup banner names `ANTHROPIC_API_KEY`; Send is disabled. |

No browser runtime errors or framework error overlay were observed after the localhost-origin regression was fixed. A dedicated automated test now covers that case.

To repeat manually, stop any dev server in this checkout, run `pnpm mock`, then `pnpm dev:mock` in another terminal. Open `http://127.0.0.1:3001`. Mock turns use `data/mock.db` with dummy credentials. The fixture keywords above select each provider state. The timeout is exercised with fake time in the automated suite rather than a ten-minute paid request.

## Remaining acceptance

- Real Sonnet 5 access, live-provider streaming/latency, cache economics, and live manual acceptance are unverified. `pnpm test:live` requires separate authorization because it costs money.
- M2 owns restoring the sidebar and settings after a reload, durable search/rename/export, automatic titles, and soft-delete retention. M1 stores turn records but the browsing interface still operates on the current session.
- M3 owns cost calculation, edit-and-regenerate, and broader accessibility/performance acceptance. Stored cost remains null.
- The single-process SQLite design is unchanged. Crash recovery is verified through reopened unfinished checkpoints; an actual forced process-kill exercise and the complete NFR acceptance table remain unrun.
