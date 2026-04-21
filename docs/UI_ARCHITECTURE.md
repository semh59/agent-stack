# Alloy UI Architecture

The Alloy console is a Vite + React 19 + Tailwind 4 SPA, served by the
gateway in production and by `vite dev` in development. This document is the
map for anyone who needs to touch the UI — what lives where, what state is
owned by whom, and the two or three rules that keep the console coherent.

## Top-level layout

```
AppLayout (persistent sidebar + header)
├── /chat         → AlloyChatShell         (full-bleed)
├── /dashboard    → DashboardView              (padded)
├── /pipeline/*   → PipelineHistoryView, ActivePipelineView, PlanApprovalView
├── /settings     → AlloySettingsShell     (full-bleed)
├── /settings/accounts → SettingsView          (legacy accounts panel)
└── /auth         → AuthPage                   (no layout)
```

Full-bleed routes opt out of the layout's padding/scroll container so they can
manage their own scrolling. The list of prefixes lives in `AppLayout.tsx` as
`FULL_BLEED_PREFIXES` — add a path there when you add a new full-bleed view.

## State stores

Two Zustand stores run side-by-side:

| Store               | Purpose                                                      |
| ------------------- | ------------------------------------------------------------ |
| `useAppStore`       | **Legacy.** Mission/pipeline/accounts/websocket. Existing UI keeps reading from this while we migrate. |
| `useAlloyStore` | **New.** Settings + chat. Persisted (chat) to localStorage.  |

Keeping them separate prevents the masterpiece UI from having to extend a
brittle legacy `AppState` interface. The two never cross-reference — anything
that needs data from both reads from them independently at the component layer.

### Settings slice

Lives in `store/slices/alloy/settingsSlice.ts`. Key ideas:

- `settings` — the server's redacted view, the canonical read model.
- `settingsDraftPatch` — in-memory diff the user is building. Deep-merged on
  top of `settings` by `useEffectiveSettings` to render form fields.
- `updateSettingsPath("providers.openai.api_key", "sk-…")` — mutates the
  draft using dotted paths so pages don't have to hand-merge trees.
- `saveSettingsDraft()` PATCHes and clears the draft on success.

### Chat slice

Lives in `store/slices/alloy/chatSlice.ts`. Key ideas:

- `conversations` — keyed by id, newest updates bubble to the top of
  `conversationOrder`.
- `sendMessage(text, opts)` — inserts a user message and a pending assistant
  placeholder, awaits `/api/optimize`, and swaps the placeholder in place so
  React keys stay stable.
- Session totals live on the slice (`sessionTokens`, `sessionCostUsd`) so the
  `CostFooter` updates without ad-hoc listeners.

## Component taxonomy

```
components/alloy/primitives.tsx   ← design-system atoms (Card, Row, Input,
                                         Switch, SecretInput, Badge, Button…)
components/alloy/Toast.tsx        ← ToastProvider + useToast hook
pages/alloy/settings/             ← Settings pages + shell
pages/alloy/chat/                 ← Chat shell + composer / list / picker
```

Rules that keep it coherent:

1. **Primitives are presentation-only.** No data fetching, no Zustand, no
   navigation. They take props and emit events.
2. **Pages own orchestration.** A settings page reads from the store, does
   local math (derived state, dotted-path reads), and wires primitives.
3. **One `--color-loji-*` token per concept.** When we rename to
   `--color-sov-*`, we'll do a single CSS sweep without touching components.
4. **No global markdown renderer.** Messages use a local renderer
   (`chat/components/message-format.tsx`) that handles code fences, bold,
   and inline code only — intentionally small, intentionally safe.

## Effective-settings overlay

Forms in Settings read through `useEffectiveSettings()`. It deep-merges
`settings + settingsDraftPatch` so that:

- a user typing in an input sees their change immediately,
- `Discard` clears the overlay and reverts all fields at once,
- `Save` promotes the overlay to the server and zeroes the draft.

Secret paths are never present as plaintext in `settings`. The overlay
preserves this: a field that has been cleared in the draft shows up as empty;
a field that hasn't been touched shows a "Stored" badge from the redacted
view.

## Routing and chat split

The chat surface is the new default (`/` redirects to `/chat`). This matches
what competing agent consoles ship and gives the user the shortest path from
"open the app" to "talk to a model". Legacy mission/pipeline views remain
reachable from the sidebar under their existing labels.

## Extending the console

Adding a new full-bleed page:

1. Create `pages/alloy/<thing>/<Thing>Shell.tsx` that returns
   `<div className="flex h-full min-h-0 flex-col">`.
2. Add the route in `App.tsx` wrapped in `<PageErrorBoundary>`.
3. Append the path prefix to `FULL_BLEED_PREFIXES` in `AppLayout.tsx`.
4. Add a nav item to `navItems` in `AppLayout.tsx`.

Adding a new settings page:

1. Add the page under `pages/alloy/settings/pages/<Thing>Page.tsx` using
   `Section` + `Card` + `Row` + primitives.
2. Register the `PageId`, nav icon, and route in `AlloySettingsShell.tsx`.

## Development loop

```
cd AGENT/ui
npm install
npm run dev       # Vite dev server
npm run build     # tsc -b && vite build
```

The console proxies to the gateway on `/api/*` — see `vite.config.ts`. The
gateway must be running (or at least the settings + optimize routes) for the
full console to render; without it, the settings shell shows
"Settings unavailable" and the chat shell surfaces the bridge error.
