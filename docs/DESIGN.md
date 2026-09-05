# Zeus Chat UI design

Design plan for the M3 visual and interaction pass. Requirements are in [PRD.md](PRD.md); this file says how they look and behave. Read it before changing anything under `src/components/`, `src/hooks/` or the stylesheets.

Direction: **plain CSS, one token system, neutral monochrome.** No UI library, no Tailwind.

## 1. Principles

1. **Content is the interface.** The reply text is the hero. Chrome is hairlines and quiet text.
2. **One neutral scale.** No accent colour. Emphasis comes from weight (400/500/600), size and space. Red is reserved for destructive and error states.
3. **Nothing decorative.** Every element maps to a requirement or a task. Remove the rest.
4. **One place for each thing.** Conversation-level actions in the header. Next-message settings in the composer. Global defaults in Settings.
5. **Calm motion.** 120–180 ms opacity/colour transitions only. No lifts, no scale, no bounce. Reduced-motion disables all of it.
6. **Keyboard and screen reader first.** Every control reachable, labelled and focus-visible in both themes.

## 2. Foundations

Tokens move from `.chat-app` to `:root`, with `html[data-theme="dark"]` overrides. `layout.tsx` reads settings and sets `data-theme` on `<html>`, so `<body>`, dialogs and menus are themed and there is no flash. Hard-coded hex values elsewhere in the stylesheet are replaced by tokens.

### 2.1 Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#ffffff` | `#212121` | Canvas, composer, dialogs |
| `--bg-sidebar` | `#f7f7f7` | `#171717` | Sidebar |
| `--bg-elevated` | `#f2f2f2` | `#2b2b2b` | User bubble, code blocks, inline code, kbd, form fields |
| `--bg-hover` | `rgba(0,0,0,.05)` | `rgba(255,255,255,.06)` | Hover on rows, ghost buttons |
| `--bg-active` | `rgba(0,0,0,.08)` | `rgba(255,255,255,.10)` | Active row, pressed |
| `--fg` | `#1a1a1a` | `#ececec` | Text, primary button fill, focus ring |
| `--fg-muted` | `#6b6b6b` | `#a6a6a6` | Secondary text, meta, labels |
| `--fg-faint` | `#858585` | `#7a7a7a` | Icons and disabled controls. Never text, including placeholders, timestamps and shortcut hints |
| `--line` | `#e5e5e5` | `#333333` | Hairlines, dividers |
| `--line-strong` | `#c9c9c9` | `#4d4d4d` | Focused composer, input borders |
| `--danger` | `#b42318` | `#f28b82` | Error text/icons, Delete |
| `--danger-bg` | `#fef3f2` | `#352321` | Error note background |
| `--selection` | `#dcdcdc` | `#4a4a4a` | Text selection |
| `--backdrop` | `rgba(0,0,0,.28)` | `rgba(0,0,0,.5)` | Dialog backdrop |
| `--shadow-raised` | `0 1px 3px rgba(0,0,0,.12)` | `0 1px 3px rgba(0,0,0,.4)` | Jump-to-bottom, selected segment |
| `--shadow-overlay` | `0 12px 40px rgba(0,0,0,.14)` | `0 12px 40px rgba(0,0,0,.5)` | Dialogs and menus only |

Measured contrast (WCAG AA needs 4.5:1 for text, 3:1 for UI):

| Pair | Light | Dark |
|---|---|---|
| `fg` on `bg` | 17.4 | 13.6 |
| `fg-muted` on `bg` / `bg-sidebar` / `bg-elevated` | 5.3 / 5.0 / 4.8 | 6.6 / 7.4 / 5.8 |
| `fg-faint` on `bg` / `bg-elevated` (UI only) | 3.7 / 3.3 | 3.8 / 3.3 |
| `danger` on `bg` / `danger-bg` | 6.6 / 6.1 | 6.7 / 6.2 |
| Send icon (`bg` on `fg`) | 17.4 | 13.6 |

### 2.2 Type

System stack stays (`--font`, `--mono`). Weights: **400, 500, 600 only.**

| Token | Size / line | Use |
|---|---|---|
| `--text-xs` | 11 / 16 | kbd hints, char count, disclaimer |
| `--text-sm` | 12 / 16 | Meta rows, timestamps, group headings, menu shortcuts |
| `--text-ui` | 13 / 20 | Sidebar rows, buttons, menus, notes |
| `--text-base` | 14 / 20 | Dialog body, inputs, settings |
| `--text-body` | 15 / 1.65 | Messages, composer |
| `--text-md` | 16 / 24 | Markdown h2, composer text on mobile (stops iOS zoom) |
| `--text-lg` | 18 / 24 | Dialog titles |
| `--text-display` | 26 / 32, weight 500, tracking -0.01em | Empty-state heading |
| `--text-code` | 13.5 / 1.7, mono | Code blocks |

Markdown inside replies: h1 `--text-lg`, h2 `--text-md`, h3 `--text-body`, all 600; body 15; code `--text-code`; tables `--text-base` with `--line` rules. Headings inside chat stay small on purpose.

### 2.3 Space, radius, size

| Scale | Values |
|---|---|
| Space `--s-1..--s-12` | 4, 8, 12, 16, 20, 24, 32, 48 |
| Radius | `--r-sm` 6 (inline code, kbd, small controls) · `--r-md` 10 (buttons, rows, inputs, code blocks, notes) · `--r-lg` 16 (composer, user bubble, dialogs) · `--r-full` |
| Layout | `--sidebar-w` 260 · `--content-w` 740 · `--header-h` 52 |
| Controls | Ghost/menu buttons 28 · default buttons and inputs 32 · send 32 · sidebar row 34 (40 on touch) |

### 2.4 Elevation and motion

- No shadows on in-page elements. Composer is a 1px `--line` box; `:focus-within` switches to `--line-strong`. Dialogs and menus use `--shadow-overlay`. Jump-to-bottom uses a 1px border and `0 1px 3px rgba(0,0,0,.12)`.
- `--ease: cubic-bezier(.2,0,0,1)`, `--t-fast: 120ms` (hover, fade), `--t-med: 180ms` (dialog, composer relocation). `prefers-reduced-motion` sets both to 0.
- Focus ring: `2px solid var(--fg)`, offset 2px, everywhere. Same in both themes.

### 2.5 Icons

Keep the hand-rolled set in `components/ui/icon.tsx`. Three sizes only: 16 (inline, menus, notes), 18 (composer toolbar, header), 20 (sidebar nav). Stroke 1.5. Colour `currentColor`; icon-only buttons use `--fg-faint` at rest and `--fg` on hover.

## 3. Layout

Three regions on desktop. Messages and composer share `--content-w` so their edges align.

```
┌─ sidebar 260 ─────┬─ main ──────────────────────────────────────────┐
│ ◇ Zeus         ⟨  │ Title                     12.4k tokens · $0.03 ⋯ │ 52
│                   │                                                  │
│ + New chat   ⇧⌘O  │      ◇ Zeus                                      │
│ ⌕ Search      ⌘K  │      Reply text in a 740px column …              │
│                   │      ⧉ ↻ · claude-sonnet-5 · 1.2k tokens          │
│ Today             │                                                  │
│  Title        2h  │                          ┌───────────────────┐   │
│  Title        5h  │                          │ user message      │   │
│ Yesterday         │                          └───────────────────┘   │
│  Title            │                                                  │
│                   │   ┌────────────────────────────────────────────┐ │
│                   │   │ Message Zeus                               │ │
│                   │   │ Claude Sonnet 5 ▾  High ▾              ↑   │ │
│ ⚙ Settings        │   └────────────────────────────────────────────┘ │
│                   │              Zeus can make mistakes.             │
└───────────────────┴──────────────────────────────────────────────────┘
```

### 3.1 Sidebar

- **Brand row (48px).** Zeus mark + "Zeus" at 15/600, collapse button on the right. Replaces the 78px brand block.
- **Nav.** "New chat" and "Search" as 34px ghost rows with 20px icons. Search is styled as a field (magnifier, "Search", `⌘K` on the right) and opens the search dialog. Shortcut hints are visible at rest in `--fg-muted`, not on hover only.
- **List.** Group headings at 12/500 `--fg-muted`, sentence case, 20px top margin. Rows: 34px, 13px title single-line ellipsis, relative time right-aligned in `--fg-muted` (FR-H2). Active row: `--bg-active`, no bold. On hover or focus-within the time fades out and a `⋯` button fades in with a menu: Rename, Export Markdown, Export JSON, Delete. Rename in the sidebar edits inline in the row.
- **Footer.** One row: gear + "Settings" (PRD §8 "settings link at the bottom"). Removes the fake workspace switcher and the "History saved on this server" note.
- **Collapse.** Collapsed = hidden. State persists in `localStorage` (per-device convenience). When collapsed, the header shows a sidebar toggle at the far left and the Zeus mark.

### 3.2 Header

52px, hairline bottom border. Left: sidebar toggle (collapsed only), then the **title** as a ghost button. Clicking it swaps to an inline input (Enter saves, Esc cancels, blur saves, max 200 chars, blank rejected). No rename dialog. While the title is `generating`, show the fallback title in `--fg-muted` with a small shimmer; on arrival, crossfade.

Right: **usage summary** in 12px `--fg-muted` ("12.4k tokens · $0.03", tokens only until FR-U2 lands) that opens a popover with input / output / cache read / cache write / cost. Then a `⋯` **conversation menu**: Rename, Instructions (per-conversation system prompt), Export Markdown, Export JSON, Delete. Header actions are disabled while the conversation is streaming (the API returns 409).

Deviation from PRD §8: model and effort pickers move from the header to the composer (see 3.4) because they govern the next message. PRD §8 is updated in the same PR.

### 3.3 Messages

32px (`--s-8`) between turns. Column max 740px, 24px side padding.

**Assistant.** No avatar column, no bubble. A meta row (16px Zeus mark + "Zeus" at 12/500 `--fg-muted`, timestamp appears on hover) then the Markdown body at 15/1.65. Below the body, the **action row** at 12px: copy, regenerate, then `claude-sonnet-5 · 1.2k tokens` in `--fg-muted`. The row is always visible on the last reply and hover/focus-revealed on older ones. Token text opens the same breakdown popover as the header (FR-U3).

**Thinking** (FR-S4) sits above the body as a single 13px row: sparkle icon + "Thinking" + chevron. Collapsed by default; expanded content is 13px `--fg-muted` pre-wrap text with a 2px `--line` left rule, not a `<pre>`. While thinking deltas stream the label reads "Thinking…" with the streaming dot. Hidden entirely when the global `hideThinking` setting is on.

**User.** Right-aligned bubble, `--bg-elevated`, `--r-lg`, max-width 80%, 12px 16px padding, 15/1.65. Role is conveyed by the bubble and an sr-only "You" label; no visible label. On hover/focus a quiet row under the bubble shows timestamp, copy and (last user message only) **Edit** (FR-C6): the bubble becomes a textarea with Cancel / Send buttons; Send truncates after it and re-sends.

**Streaming.** An 8px `--fg` dot after the last character. Action row hidden until terminal. No layout shift: meta row and thinking row reserve their height from the first frame. rAF batching in `use-chat-stream.ts` is untouched.

**Jump to bottom.** 32px circle, `--bg` with `--line` border, 16px above the composer. Offset comes from `--composer-h`, set by a `ResizeObserver` on the composer, replacing the magic 158px.

**State notes.** One `MessageNote` component, rendered under the body, 13px with a 16px icon:

| State | Variant | Copy | Action |
|---|---|---|---|
| Stopped | info | "You stopped this response." | Retry |
| Connection lost / crash | info | "The connection ended before the reply finished." | Retry |
| Timeout | info | "The response timed out after 10 minutes. The partial reply was saved." | Retry |
| Provider error (FR-E2) | danger | Copy from `ui-message.ts`; "Please retry" reworded to "Retry" | Retry when `retryable` |
| Refusal (FR-M7) | info | "Zeus declined to answer." then `category · explanation` in `--fg-muted` | Retry |
| Cut off (FR-M7) | info | "Reached the output limit." | Continue |
| Context exceeded | info | "This conversation is too long for the model." | New chat |

Info notes have no background. Danger notes get `--danger-bg` and `--r-md`. Actions are text buttons inline with the note. Interrupted replies show "usage unknown", never zero.

### 3.4 Composer

- Box: `--bg`, 1px `--line`, `--r-lg`, padding 12px 16px. `:focus-within` border `--line-strong`. No double box-shadow.
- Textarea: 15/1.65, placeholder "Message Zeus", 1 line minimum, grows to 8 lines then scrolls (FR-C5). 16px on mobile to stop iOS zoom.
- Footer row (28px controls): left **Model ▾** and **Effort ▾** ghost menu buttons at 12px. Right: character count (only when non-empty, `--text-xs`, tabular) and the 32px **Send** circle (`--fg` fill, `--bg` arrow) that becomes **Stop** (square icon) while streaming.
- Model is locked once the conversation has messages: the button renders as a plain label with `aria-disabled` and title "Model is fixed for this conversation". With one registry entry this is the common case.
- Removed: the "Settings" button, the display-only effort pill, the keyboard-hint footer. Enter/Shift+Enter behaviour moves into an `aria-describedby` sr-only text.
- Under the box: one line, `--text-xs` `--fg-faint`, "Zeus can make mistakes."
- Banners above the box: **SetupBanner** (FR-E1) as a bordered card naming `ANTHROPIC_API_KEY` in mono, composer disabled; "A reply is running in another tab." info note, composer disabled.

### 3.5 Empty state

```
                     ◇
            What can I help with?

   ┌──────────────────────────────────────┐
   │ Message Zeus                         │
   │ Claude Sonnet 5 ▾  High ▾        ↑   │
   └──────────────────────────────────────┘

   Explain a concept   Draft an email   Review some code
              Set instructions for this chat
```

Vertically centred column: 24px Zeus mark, display heading, the composer itself (so model and effort are the "centred model picker" of PRD §8), three monochrome example prompts as 13px ghost buttons that fill the composer without sending, and a text link that expands a per-conversation instructions textarea above the composer. On first send the composer moves to the bottom with a `--t-med` transition (instant under reduced motion). Removed: the eyebrow line, the four coloured chips.

### 3.6 Overlays

| Surface | Kind | Notes |
|---|---|---|
| Search | `<dialog>` 610px | Borderless input on top, results with title + snippet, "Show more" pagination, states: idle hint, searching, empty, error + Retry |
| Settings | `<dialog>` 520px | Sections: Defaults (model, effort, instructions, "Use for new chats"), Appearance (Light / Dark / System), Thinking (show/hide). Export and delete leave this dialog |
| Delete | `<dialog>` 400px | "Delete this chat?" / "It is removed permanently after 30 days." Cancel + red Delete (FR-H5) |
| Menus | new `ui/menu.tsx` | One primitive for sidebar row, header, model, effort. `role="menu"`, roving tabindex, ↑↓ Home End, Enter, Esc, click-outside; positioned relative to the trigger; `--shadow-overlay`, `--r-md`, 13px items, shortcut hints right-aligned |
| Popover | same primitive, `role="dialog"` | Usage breakdown |

"System" theme adds `"system"` to the settings enum in `src/lib/settings.ts` and resolves via `matchMedia` on the client; the settings row is a JSON blob, so no migration.

## 4. Mobile (< 768px)

- Sidebar becomes the existing drawer dialog, 285px, with the same content. Header: menu button, title (truncated), `⋯`.
- Rows grow to 40px; row menus open on tap of a visible `⋯`.
- Composer footer: model and effort collapse to icon buttons; ≤ 390px hides the character count. Bottom padding includes `env(safe-area-inset-bottom)`.
- Message action rows are always visible (no hover).
- 360px is the tested minimum (PRD §7).

## 5. Keyboard and accessibility

| Key | Action |
|---|---|
| `⌘K` | Search |
| `⇧⌘O` | New chat |
| `⌘B` | Toggle sidebar |
| `Enter` / `⇧Enter` | Send / newline (FR-C5) |
| `Esc` | Close menu or dialog; with the composer focused while streaming, Stop |
| Menus | `↑ ↓ Home End Enter Esc`, click outside |

Keep: skip link, `aria-label` on every icon button, `role="status"` on notes and `role="alert"` on errors, sr-only streaming announcer, `aria-live="polite"` on search results, `aria-current="page"` on the active row, focus restore on dialog close. Add: focus restore after inline rename, `aria-describedby` on the textarea, hit targets ≥ 32px (40 on touch), contrast table above verified in both themes.

## 6. Copy

Sentence case. No exclamation marks, no "Please". Product name in UI is "Zeus". Placeholder "Message Zeus". Heading "What can I help with?". Buttons are verbs: Retry, Continue, Delete, Rename, Send, Stop.

## 7. Component map

`Chat.tsx` keeps state and wiring only (target under 300 lines). Everything else splits out:

```
src/app/layout.tsx                  reads settings → <html data-theme>, imports styles
src/components/layout/AppShell.tsx  sidebar + main grid, collapse state, ⌘B
src/components/sidebar/Sidebar.tsx  brand, nav, list, settings row
src/components/sidebar/ConversationRow.tsx   row + inline rename + row menu
src/components/sidebar/ConversationList.tsx  (existing) grouping, load more
src/components/sidebar/SearchDialog.tsx      (existing) restyled
src/components/chat/ChatHeader.tsx  title inline edit, usage, conversation menu
src/components/chat/EmptyState.tsx  heading, example prompts, instructions
src/components/chat/MessageList.tsx (existing) scroll, jump, live region
src/components/chat/Message.tsx     UserMessage, AssistantMessage, action rows
src/components/chat/ThinkingDisclosure.tsx
src/components/chat/MessageNote.tsx state notes (table in 3.3)
src/components/chat/Composer.tsx    (existing) new footer, --composer-h
src/components/chat/ModelMenu.tsx, EffortMenu.tsx
src/components/chat/SetupBanner.tsx
src/components/chat/SettingsDialog.tsx (existing) restyled
src/components/chat/DeleteDialog.tsx
src/components/chat/UsagePopover.tsx (M3, FR-U3)
src/components/ui/dialog.tsx        (existing)
src/components/ui/menu.tsx          new primitive
src/components/ui/icon.tsx          (existing)
```

Stylesheet split, all global, same class conventions, imported from `layout.tsx`. PR 1 creates `tokens.css` and `base.css`; each later PR moves the rules it restyles out of `src/app/globals.css`, which shrinks to nothing:

```
src/styles/tokens.css   §2 tokens, light + dark
src/styles/base.css     reset, focus, sr-only, kbd, buttons (.btn, .btn-ghost, .btn-primary, .btn-danger, .icon-btn)
src/styles/sidebar.css
src/styles/chat.css     header, messages, notes, empty state
src/styles/markdown.css
src/styles/composer.css
src/styles/overlays.css dialogs, menus, popover
```

## 8. Implementation order

One PR each, branch from `main`, FR in the title. Every PR: `pnpm lint && pnpm typecheck && pnpm test`, then the browser check in §9 with Send, Stop and Retry exercised. Check `git status` and recent branches first; Codex and Cursor edit this repo concurrently.

| # | PR | Scope | Requirement |
|---|---|---|---|
| 1 | `ui: token scale and themed root` | `tokens.css` on `:root`, `data-theme` on `<html>` from `layout.tsx`, type/space/radius tokens applied to existing classes, hard-coded hex removed. No behaviour change | M3 theme |
| 2 | `ui: split Chat.tsx into shell, sidebar, header, empty state` | Pure refactor, no visual change | M3 |
| 3 | `sidebar: brand row, search field, row menu, settings row` | §3.1 | FR-H2, FR-H5, FR-H6 |
| 4 | `chat: inline rename and conversation menu` | §3.2, delete dialog, export moves here | FR-H3, FR-H6 |
| 5 | `composer: model and effort menus` | §3.4, `ui/menu.tsx`, `--composer-h`, PRD §8 line update | FR-S1, FR-S3 |
| 6 | `chat: message layout, thinking, state notes` | §3.3, `markdown.css` scale | FR-C4, FR-S4, FR-M7, FR-E2, FR-E3 |
| 7 | `chat: empty state` | §3.5 | PRD §8 |
| 8 | `settings: restyled dialog and system theme` | §3.6 | FR-S2 |
| 9 | `chat: edit-and-regenerate` | Edit affordance on the last user message. Needs a truncate-then-send path; if it touches `src/app/api/chat/`, plan mode first | FR-C6 |
| 10 | `usage: cost and usage popover` | `lib/cost.ts`, populate `cost_usd` in `run-turn.ts`, header summary, popover | FR-U2, FR-U3 |

PRs 1–2 change no pixels the user cares about and unblock the rest. PRs 3–8 are the visible redesign. PRs 9–10 are M3 features built on it.

## 9. Verification recipe

- **Servers.** `pnpm mock` (:8787) and `pnpm dev:mock` (:3001). Steer states with message text: `slow` (streaming + Stop), `refuse`, `cut off`, `code`, `auth error`, `rate limit`, `error`, `retry once`. Never `pnpm test:live`.
- **Screenshot matrix.** Light and dark × 1280px and 360px × states: empty, streaming, interrupted, error, refusal, cut off, missing key. Missing key: run without `ANTHROPIC_API_KEY`.
- **Contrast.** Recompute the §2.1 table with a one-off node script whenever a token changes; every text pair ≥ 4.5, every UI pair ≥ 3.
- **Keyboard.** Tab order sidebar → header → messages → composer; `⌘K`, `⇧⌘O`, `⌘B`, Esc-to-stop; menu arrow keys; inline rename Enter/Esc; focus visible in both themes.
- **Motion.** Emulate `prefers-reduced-motion` and confirm no transitions.
- **Performance.** rAF batching untouched; a `slow` reply stays smooth.
- **Browser pane caveat.** The in-app tab reports `visibilityState: hidden`, so rAF-batched text paints at the end of the stream. Judge streaming with `curl -N` against the route, not screenshots.

## 10. Out of scope

Tailwind or any UI library, icon rail when collapsed, attachments and vision UI, tool-use rendering, toasts, a standalone settings or search page, retention-cleanup UI, native apps.
