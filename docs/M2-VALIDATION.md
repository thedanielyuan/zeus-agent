# M2 history and settings validation

Date: 2026-09-06. Scope: FR-H1–H6 and FR-S1–S4, including restoring FR-M3 defaults and the existing M1 reply lifecycle. All provider activity used offline fixtures or a local mock. No paid Anthropic test or real title-generation call ran.

## Automated checks

- `pnpm test`: 136 tests pass; the one paid live-provider test stays skipped.
- `pnpm lint` and `pnpm typecheck`: pass.
- `pnpm build`: production build passes with the history, export, settings and conversation-page routes.
- `pnpm db:generate`: schema matches the generated migrations with no further changes required.
- `git diff --check`: passes.

New tests cover conversation/default settings CRUD, pagination, the active-turn mutation guard, literal case-insensitive search, recency of the matching record, deduplication before pagination, FTS updates on checkpoint/rename/Retry/delete, the exact retention cutoff and hourly cleanup scheduling. A disk-backed M1 database upgrade backfills the search indexes and fallback titles while preserving message records. Reopening a database restores final metadata, nullable usage, interrupted checkpoints and title-claim recovery.

Title calls cap their input and output. Fixtures cover a single durable claim, low-effort request shape, success, manual rename and deletion races, incomplete/refused/cut-off responses and a provider that ignores cancellation. The route test runs the scheduled `after` callback and confirms the generated title adds no transcript rows. Existing M1 tests still cover every architecture §5 edge and cache-prefix stability.

API tests cover same-origin mutations, invalid/oversized bodies, invalid model/settings/search values, redacted storage failures, missing/deleted records, full JSON fidelity and Markdown attachment responses.

## Browser and restart checks

Agent-browser drove an isolated copy of the source with Next.js 16.3.4, the real Anthropic SDK and `scripts/mock-anthropic.mjs`. The app and mock ran on separate loopback ports with dummy credentials and a fresh temporary SQLite database. The owner's existing development server stayed running. The existing owner database was backed up before schema work; QA did not migrate or write to it.

| Flow | Observed result |
|---|---|
| First send | Thinking/text streamed, a `/c/[id]` URL appeared, and the asynchronous mock title replaced the fallback. |
| Save settings, reload | Instructions, extra-high effort, a 2,048-token reply limit, light appearance and hidden thinking were restored. |
| New chat defaults | A new chat inherited the saved model, effort and instructions. Response limit remains per conversation, as specified in FR-S2. |
| Markdown/JSON export | Both buttons downloaded files. JSON retained thinking even with the UI hide preference enabled, final usage and conversation settings. |
| Stop, then reload | The interrupted partial text returned with unknown usage and Retry available. |
| Search | Uppercase `NEBULA` found a saved user-message substring in an older chat. Selecting the result opened its stored transcript. |
| Rename | `Nebula research notes` survived reload and later navigation. |
| Delete | “Keep chat” cancelled the confirmation. Confirming deletion hid the chat; its two message records remained soft-deleted. Searching its unique term returned no result. |
| Refusal, then reload | The category `general_harms` and fixture explanation returned from stored records. |
| Forced process kill | After the browser displayed `word3` on a slow reply, the isolated app process was killed. SQLite still held a streaming checkpoint containing `word1 `. Restart changed that row to interrupted with null usage and restored all earlier messages/settings. This confirms checkpoint recovery; it does not claim that uncheckpointed tokens survive a crash. |
| Retry after restart | Retry completed through `word80` while keeping six messages in the conversation, replacing only the interrupted assistant suffix. |
| 360 px layout | Document scroll width equalled the viewport width. Composer, mobile sidebar, search and Retry remained usable. |

No browser runtime errors or framework error overlays were observed after reload. Connection closure while deliberately killing the test server was expected.

## Scale measurement

The repository test seeds an in-memory SQLite database with 1,000 conversations and 100,000 representative text messages, then checks result ordering and page size. One measured run on this machine returned:

| Query | Time |
|---|---:|
| Sidebar, 100 summaries | 0.92 ms |
| Indexed substring, `needle` | 5.12 ms |
| Short substring scan, `ne` | 20.35 ms |
| Common substring, `message` | 343.48 ms |

These are query measurements on a synthetic in-memory dataset, not disk-backed browser latency percentiles or complete NFR acceptance. The test checks correctness and reports timing without a machine-dependent pass threshold.

## Operational notes

Restart the app when upgrading so new migrations and recovery run before serving requests. Soft-deletion cleanup catches up at first database access and runs hourly while the process is alive. Legacy chats receive fallback titles without retroactive model calls. Failed or crashed title attempts keep a fallback and are not automatically billed again.

Real-provider title quality, latency, API availability and cache economics remain unverified. M3 still owns cost accounting, edit-and-regenerate and the broader accessibility/performance acceptance work.
