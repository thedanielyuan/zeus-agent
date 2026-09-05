# Zeus Chat — Product Requirements Document

| Field | Value |
|---|---|
| Status | Draft v0.1 |
| Owner | Daniel Yuan |
| Last updated | 2026-09-05 |
| Related | [ARCHITECTURE.md](ARCHITECTURE.md), [README](../README.md) |

## 1. Summary

Zeus Chat is a self-hosted web chat interface that lets a user talk to any AI model through one consistent UI. Version 1 ships with a single provider and model, Claude Sonnet 5 (`claude-sonnet-5`), behind a provider abstraction so that additional models and vendors can be added without changing the chat experience.

The product is a personal tool first. It runs locally or on a single small server, uses the owner's own API keys, and stores conversations on disk. Multi-user accounts, billing, and team features are explicitly out of scope for v1.

## 2. Problem

Every model vendor ships its own chat client. Switching between models means switching apps, losing history, and re-learning UI. Third-party "all models in one" apps exist but route your keys and conversations through someone else's server, lag behind vendor API features, or lock the good parts behind subscriptions.

The owner wants one interface they control, that:

- talks to the model they choose today (Claude Sonnet 5) with first-class support for that model's features (streaming, thinking, prompt caching, long context),
- can be pointed at other models later without a rewrite,
- keeps every conversation local and exportable.

## 3. Goals and non-goals

### Goals (v1)

1. **Chat that feels instant.** Token-by-token streaming with a visible first token in under one second on a normal connection.
2. **Model-agnostic core.** The UI, storage, and transport never depend on a specific vendor. Adding a provider means implementing one adapter interface.
3. **Full Claude Sonnet 5 support.** Adaptive thinking with summarized display, effort control, 1M-token context, prompt caching, correct handling of every stop reason including `refusal`.
4. **Persistent, searchable history.** Conversations survive restarts and can be listed, renamed, searched, exported, and deleted.
5. **Secrets stay server-side.** API keys are read from the server environment and never reach the browser.
6. **Cheap to run.** Prompt caching on by default so long conversations do not bill the full history every turn.

### Non-goals (v1)

- Multi-user accounts, auth providers, or role-based access.
- Hosted or SaaS deployment; no billing, no quotas.
- Tool use, function calling, or agentic loops (planned for v2, and the architecture reserves room for it).
- File and image attachments (v1.1).
- Voice input or output.
- Mobile native apps. The web UI must be responsive but a native app is out of scope.
- Fine-tuning, RAG, or retrieval over the user's documents.

## 4. Users

| Persona | Description | Primary need |
|---|---|---|
| Owner (primary) | Solo developer running Zeus Chat on their own machine with their own API keys | Fast, reliable chat with the best model available, with history they own |
| Tinkerer (secondary) | Someone who clones the repo to add a provider or change the UI | Clear extension points and a codebase an AI coding agent can work in |

There is no "end user" who is not also the operator in v1.

## 5. User stories

Priority: P0 = must ship in v1, P1 = should ship in v1, P2 = later.

| ID | Priority | Story |
|---|---|---|
| US-1 | P0 | As the owner, I can type a message and see the model's reply stream in token by token. |
| US-2 | P0 | As the owner, I can stop a reply mid-stream and keep the partial text. |
| US-3 | P0 | As the owner, I can start a new conversation and return to any previous one from a sidebar. |
| US-4 | P0 | As the owner, I can see which model answered each message. |
| US-5 | P0 | As the owner, I can pick the model for a conversation from a dropdown; v1 lists one entry, Claude Sonnet 5. |
| US-6 | P0 | As the owner, I can set a system prompt per conversation. |
| US-7 | P0 | As the owner, I can see a clear error when the API key is missing, invalid, or rate limited, and retry. |
| US-8 | P1 | As the owner, I can expand a collapsed "Thinking" section on a reply to read the model's summarized reasoning. |
| US-9 | P1 | As the owner, I can choose an effort level (low / medium / high / xhigh / max) per conversation. |
| US-10 | P1 | As the owner, I can see token usage and estimated cost for each reply and for the whole conversation. |
| US-11 | P1 | As the owner, I can edit my last message and regenerate the reply. |
| US-12 | P1 | As the owner, I can regenerate the last assistant reply without editing. |
| US-13 | P1 | As the owner, I can rename, delete, and search conversations by title and content. |
| US-14 | P1 | As the owner, I can export a conversation as Markdown or JSON. |
| US-15 | P1 | As the owner, I can copy any message or any code block with one click. |
| US-16 | P1 | As the owner, I can switch between light and dark theme and the choice persists. |
| US-17 | P2 | As the owner, I can attach images and PDFs to a message. |
| US-18 | P2 | As the owner, I can switch the model mid-conversation and the history is carried over. |
| US-19 | P2 | As the owner, I can add a second provider (for example OpenAI or Gemini) by supplying its key. |
| US-20 | P2 | As the owner, I can enable web search for a conversation. |
| US-21 | P2 | As the owner, I can branch a conversation from any earlier message. |

## 6. Functional requirements

Requirement IDs are grouped by area. Each maps to one or more user stories.

### FR-C: Chat core

- **FR-C1** Send a user message and receive a streamed assistant reply. Text appears incrementally as the provider emits it. (US-1)
- **FR-C2** A Stop button cancels the in-flight request. The partial reply is kept and marked as interrupted. (US-2)
- **FR-C3** Assistant replies render Markdown: headings, lists, tables, links, inline code, and fenced code blocks with syntax highlighting. Raw HTML in model output is escaped, never rendered. (US-1)
- **FR-C4** Each message shows role, timestamp, and for assistant messages the model ID that produced it. (US-4)
- **FR-C5** Enter sends; Shift+Enter inserts a newline. The composer grows with content up to a cap, then scrolls. (US-1)
- **FR-C6** Edit-and-regenerate on the last user message truncates the conversation after that message and re-sends. (US-11)
- **FR-C7** Regenerate on the last assistant message re-sends the same history and replaces the reply. (US-12)
- **FR-C8** Copy buttons on messages and on every code block. (US-15)

### FR-M: Models and providers

- **FR-M1** A model registry lists available models with vendor, model ID, display name, context window, output cap, per-million-token prices, and capability flags (thinking, effort, vision, tools, caching). (US-5)
- **FR-M2** v1 registry contains exactly one entry: Claude Sonnet 5, `claude-sonnet-5`, 1M context, 128K max output, $2.00 input / $10.00 output per million tokens, thinking + effort + vision + caching supported. (US-5)
- **FR-M3** Each conversation stores its model ID. New conversations default to the last used model. (US-5)
- **FR-M4** Provider adapters implement one interface: given a normalized conversation and settings, return a stream of normalized events (see [ARCHITECTURE.md](ARCHITECTURE.md) §4). The chat core never imports a vendor SDK directly. (US-19)
- **FR-M5** The Anthropic adapter uses the official `@anthropic-ai/sdk`, adaptive thinking with `display: "summarized"`, `output_config.effort` from conversation settings, and streaming for every request. (US-8, US-9)
- **FR-M6** The Anthropic adapter enables prompt caching on every request: an explicit breakpoint on the system prompt plus top-level automatic caching for the conversation tail. (Goal 6)
- **FR-M7** The adapter surfaces every stop reason. `refusal` is shown to the user with the category and explanation from `stop_details`. `max_tokens` shows a "reply was cut off, continue?" affordance. (US-7)

### FR-S: Settings

- **FR-S1** Per-conversation settings: model, system prompt, effort level, max output tokens. Changes apply from the next message. (US-6, US-9)
- **FR-S2** Global settings: default model, default system prompt, default effort, theme. Stored server-side in the database. (US-16)
- **FR-S3** Effort options are exactly `low`, `medium`, `high`, `xhigh`, `max`. Default is `high`. (US-9)
- **FR-S4** Thinking summaries are shown collapsed by default under each reply, with a toggle to expand. A global setting hides them entirely. (US-8)

### FR-H: History

- **FR-H1** Conversations and messages persist in a local SQLite database. (US-3)
- **FR-H2** The sidebar lists conversations newest-first with title and relative time. (US-3)
- **FR-H3** The first assistant reply triggers an automatic title, generated by a short low-effort call to the same model. The title is editable. (US-13)
- **FR-H4** Search matches title and message text, case-insensitive, and returns conversations ranked by most recent match. (US-13)
- **FR-H5** Delete asks for confirmation and is soft-delete for 30 days, then hard-deleted by a cleanup job. (US-13)
- **FR-H6** Export a conversation as Markdown (readable transcript) or JSON (full records including usage and thinking summaries). (US-14)

### FR-U: Usage and cost

- **FR-U1** Every assistant message stores input tokens, output tokens, cache read tokens, cache write tokens, and the model ID. (US-10)
- **FR-U2** Cost per message is computed from the registry prices at the time of the call and stored with the message, so later price changes do not rewrite history. Cache reads bill at 10% of input price; cache writes at 125%. (US-10)
- **FR-U3** A conversation header shows running total tokens and cost. Hovering a message shows its breakdown. (US-10)

### FR-E: Errors and resilience

- **FR-E1** Missing API key: the UI shows a setup banner with the exact environment variable name before any message can be sent. (US-7)
- **FR-E2** Authentication, rate limit, overloaded, and server errors are mapped to distinct user-facing messages with a Retry button. The SDK's typed error classes are used; no string matching on messages. (US-7)
- **FR-E3** Network drop mid-stream: partial text is kept, the message is marked "interrupted", and Retry re-sends from the last user message. (US-2)
- **FR-E4** The server applies a request timeout of 10 minutes for streaming calls. (US-7)

### FR-X: Security and privacy

- **FR-X1** API keys are read from server environment variables only. They never appear in client bundles, responses, logs, or the database. (Goal 5)
- **FR-X2** The chat API route is only reachable from the app's own origin. In local mode the server binds to localhost by default. (Goal 5)
- **FR-X3** Model output is treated as untrusted content: rendered Markdown is sanitized, links open in a new tab with `rel="noopener"`. (FR-C3)
- **FR-X4** No telemetry or analytics leave the machine. (Goal 5)

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Latency | First streamed token visible within 1.0 s p50 / 2.5 s p95 after send, measured from click to first DOM update, excluding model thinking time |
| Rendering | Streaming updates batched so the UI stays above 50 fps on a 2020 laptop during a 10K-token reply |
| Scale | 1,000 conversations and 100,000 messages with sidebar load under 200 ms and search under 500 ms |
| Reliability | No data loss on process crash: each message is written before the response is streamed to the client |
| Portability | Runs on macOS and Linux with Node 24. One `pnpm dev` starts everything. No external services beyond the model API |
| Accessibility | Keyboard-navigable, visible focus rings, WCAG AA contrast in both themes, screen-reader labels on all controls |
| Responsiveness | Usable from 360 px wide to ultrawide; sidebar collapses under 768 px |
| Observability | Structured server logs with request ID, model, token counts, latency, and error class. Never log message content or keys at default log level |

## 8. UX outline

Three regions on desktop, collapsing to a single column on mobile.

1. **Sidebar (left).** New chat button, search box, conversation list grouped by Today / Yesterday / Previous 7 days / Older, settings link at the bottom.
2. **Conversation (center).** Header with editable title, model picker, effort picker, and usage summary. Scrollable message list. Assistant messages have a collapsed "Thinking" disclosure above the text when a summary exists, and a footer row with model ID, token counts, copy, and regenerate.
3. **Composer (bottom).** Auto-growing textarea, Send button that becomes Stop while streaming, character and token estimate on the right.

Empty state: a centered model picker and system prompt field with three example prompts.

States that must be designed: empty, streaming, interrupted, error with retry, refusal, cut-off with continue, missing API key.

### Chat interface implementation status (2026-09-05)

The ChatGPT-style interface uses the existing M0 streaming API. Conversation history and conversation settings currently live in the browser session; only the theme preference survives a reload. This interface slice does not complete the database-backed history milestones.

| Requirement | Status in this interface slice |
|---|---|
| FR-C1, FR-C2, FR-C4, FR-C5 | Implemented in the browser: streaming, Stop with partial text, role/model/timestamps, and an auto-growing keyboard composer. Live provider acceptance and durable message storage remain separate. |
| FR-C3, FR-X3 | Sanitized Markdown, tables, safe links, and fenced code with copy controls implemented. Syntax highlighting remains pending. |
| FR-C7, FR-C8 | Regenerate/Retry uses the last user turn without duplicating earlier context; message and code copying implemented. |
| FR-H2, FR-H4, FR-H6 | Sidebar groups, conversation switching, title/content search, renaming, and Markdown export implemented for session history. SQLite search, JSON export, and durable history remain pending. |
| FR-S1, FR-S3, FR-S4 | Per-conversation model, instructions, effort, and output limit controls implemented; thinking summaries are collapsed by default. The global hide-thinking preference remains pending. |
| FR-S2 | Light/dark appearance persists on the device. Database-backed global defaults remain pending. |
| FR-E1, FR-E2, FR-E3, FR-M7 | Missing-key setup, provider errors, interrupted replies, refusal details, and cut-off/Continue affordances implemented in the UI. |
| FR-H1, FR-H3, FR-H5, FR-C6, FR-U2, FR-U3 | Database persistence, generated titles, soft-delete retention, edit-and-regenerate, and cost accounting remain pending. Session deletion explicitly requires confirmation. |

Validation: offline browser fixtures exercise streaming, multi-turn context, Stop, Retry, and Continue. UI checks cover desktop/mobile layouts, theme, settings, and session navigation. No real model API calls are part of this interface validation.

## 9. Success metrics

Because v1 is a personal tool, metrics are about quality and cost rather than growth.

| Metric | Target |
|---|---|
| Time to first token (p50, excluding thinking) | Under 1.0 s |
| Cache read ratio on turn 3 and later of any conversation | Above 80% of input tokens |
| Streaming interruptions that lose text | 0 |
| Error states without a working Retry | 0 |
| Cold start (`pnpm dev` to usable UI) | Under 10 s |
| Time for a new provider adapter (measured when the second one is built) | Under one working day, no changes outside `src/lib/providers/` and the registry |

## 10. Release plan

| Milestone | Scope | Exit criteria |
|---|---|---|
| M0 Scaffold | Next.js app, SQLite schema, model registry, Anthropic adapter, one streaming round-trip in the browser | A message sent from the UI streams back from `claude-sonnet-5` |
| M1 Chat core | FR-C1 to C5, FR-M1 to M7, FR-E1 to E4, FR-X1 to X4 | All P0 stories pass manual QA; stop, retry, and refusal states work |
| M2 History | FR-H1 to H6, FR-S1 to S4 | Restart preserves everything; search and export work |
| M3 Polish | FR-C6 to C8, FR-U1 to U3, theme, accessibility pass | All P1 stories pass; NFR table verified |
| M4 Second provider | One non-Anthropic adapter behind the same interface, US-18, US-19 | Model switch mid-conversation works; adapter time metric recorded |

Each milestone is one or more small PRs. The architecture doc lists the modules each milestone touches.

## 11. Open questions

1. **Second provider choice.** OpenAI, Gemini, or a local model via Ollama? The adapter interface should be validated against at least one with a different streaming shape. Leaning toward an OpenAI-compatible adapter because it also covers many local servers.
2. **Attachment storage.** Files on disk next to the DB, or blobs in SQLite? Decide before M4.
3. **Auto-title cost.** One extra low-effort call per conversation is cheap but nonzero. Consider a client-side heuristic (first 6 words) with a "generate title" button instead.
4. **Compaction.** Server-side compaction (beta) can keep very long conversations under the context limit. Turn it on by default, or expose as a per-conversation toggle? Deferred to M3.
5. **Hosting.** If this ever runs on a shared host, auth becomes a P0. Keep an auth seam in the API layer so a single-password gate can be added without restructuring.

## 12. Assumptions

- Only the Anthropic API is available in v1. Bedrock, Vertex, and Foundry are not targeted, though the adapter could use the SDK's platform clients later.
- The owner has an Anthropic API key with access to `claude-sonnet-5`.
- Prices and model capabilities in the registry are maintained by hand and reviewed when a model is added.
- Node 24 and pnpm are the supported toolchain; other runtimes are untested.
