# Sovereign Console — UX Playbook

This is the short document that keeps the console feeling like a single
product instead of a pile of screens. Read it before you add a new view.

## North stars

1. **One visible state per control.** Every toggle, picker, and input has a
   single source of truth: the effective settings overlay or the active
   conversation. Never split the same concept across two different widgets.
2. **Live feedback over modal confirmation.** Theme changes, density changes,
   and accent changes apply immediately. Destructive actions (reset, delete
   conversation) use `window.confirm` — brief, skimmable, reversible where
   possible.
3. **Secrets are first-class citizens.** A field that holds a secret always
   shows *Stored* vs *Not set* at a glance, the "last updated" timestamp when
   available, and a dedicated *Clear* affordance. We never invite the user to
   paste a secret into a plain text input with no indication of its status.
4. **Everything routes through the pipeline.** The chat placeholder makes
   this obvious: the spinner says "Optimizing", not "Calling OpenAI". The
   pipeline is the product.

## Visual hierarchy

- **Display type** (`font-display`) → section titles, shell headers, logo.
  Never for body copy.
- **UI type** (`font-ui`) → nav labels, badges, microcopy. Always uppercase
  with wide tracking for all-caps labels.
- **Body type** (`font-body`) → message content, hints, descriptions.
- **Mono** → code blocks, token counts, file paths.

Colors stay within the `--color-loji-*` token set — no inline hex values in
components. When a view needs to express a new concept, add a token, don't
invent a one-off shade.

## Spacing

- Cards use `p-6` at comfortable density, `p-4` at compact.
- `Row` provides the canonical label-left / control-right split with 240px
  label column on desktop, stacked on mobile.
- Settings sections stack with `space-y-10` so section boundaries are
  obvious even when cards are tall.

## Icons

`lucide-react` only. One icon per concept — don't mix `Cloud` and `Server`
for the same idea in different pages. The sidebar rail uses 16px icons; inline
microcopy uses 10–12px.

## States

Every interactive component handles four states explicitly:

| State     | Treatment                                                     |
| --------- | ------------------------------------------------------------- |
| Default   | Neutral border, secondary text.                               |
| Hover     | Brighter border (`--color-loji-border-bright`), white text.   |
| Focus     | Accent ring via `focus-visible:ring-[var(--color-loji-accent)]/60`. |
| Disabled  | 50% opacity, `cursor-not-allowed`.                            |

Error state is a fifth mode and shows a red border + `text-red-400` message.

## Copy style

- **Sentence case** for buttons ("Save", "Reset", "New chat").
- **Title case** for nav labels ("Providers", "Routing", "Observability").
- **Microcopy under inputs** is a hint, not a requirement — keep it to one
  line, present tense, active voice.
- **Error messages** quote the failure verbatim from the server and
  prepend a short human sentence ("Could not save settings — …").

## Accessibility

- Every icon button has `aria-label`.
- `Switch` uses `role="switch"` + `aria-checked`.
- Color alone never conveys state — always pair with an icon or label.
- Focus order matches visual order; we don't reorder with `tabIndex` unless
  we have to.

## What to avoid

- Modal dialogs for routine work. The settings shell replaces what other
  tools would use three modals for.
- Toast storms. One toast per action, auto-dismissed at 4s. Errors get a
  longer lease if needed, never permanent.
- Custom scroll containers inside scroll containers. If you're nesting
  `overflow-auto`, something is off — redesign the layout.
- Reinventing primitives. If you need a new input shape, add it to
  `primitives.tsx` first, then use it.

## Review checklist

Before shipping a new view:

- [ ] Dark theme and light theme both legible.
- [ ] Keyboard-only traversal works start to finish.
- [ ] Empty / loading / error / populated states all drawn.
- [ ] Copy fits in Turkish and English (both languages ship in the console).
- [ ] No new hex colors; no new fonts; no new modal libs.
- [ ] Zustand subscriptions use `useShallow` when pulling multiple keys.
