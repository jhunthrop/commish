# Commish — Design System

**Read this before building any user-visible surface**, alongside `docs/conventions.md`. Everything here is enforced by tests where it can be, and by review where it can't.

## Principles
- **Delightful, not merely functional.** The product thesis (strategy doc §4) is that this category feels flat and we won't. Optimistic UI, celebration moments, motion with intent.
- **Both themes are first-class.** Every surface is designed and tested in light and dark. No color exists only in one theme.
- **Accessible by default.** WCAG 2.2 AA. Every input has a visible label. Every icon is decorative or labeled. Keyboard-operable primary flows. `prefers-reduced-motion` honored globally.
- **Never a dead end.** Empty and error states always offer an action.
- **Mobile-first.** Minimum viewport 360px.

## Tokens
Single source of truth: `src/design/tokens.ts` → generated `src/design/tokens.css` (`npm run tokens:build`; a test fails if they drift). The generated file declares namespaced source variables (`--commish-color-surface`, `--commish-space-4`, `--commish-radius-md`, …) on `:root`; `src/app/globals.css`'s `@theme inline` block aliases each Tailwind theme variable (`--color-surface`, `--radius-md`, `--text-md`, …) to its `--commish-*` counterpart. This two-layer scheme (generated `--commish-*` source vars → `@theme inline` Tailwind aliases → utility classes) exists because aliasing a theme variable to itself (`--color-surface: var(--color-surface);`) is a CSS custom-property cycle — it only resolved before because the unlayered token import happened to outrank `@layer theme` in the cascade, which is not a property to depend on. Use tokens via Tailwind aliases:
- Surfaces: `bg-surface`, `bg-surface-elevated`, `border-border`
- Text: `text-text-primary`, `text-text-muted`
- Accent: `bg-accent text-accent-text` (buttons/links), `text-accent`
- Semantic: `text-positive` / `text-negative` / `text-warning` (semantic color is *not* the accent)
- Semantic-on-fill: when a semantic color is used as a fill (e.g. `bg-negative`), pair it with its `-text` role (e.g. `text-negative-text`) for the label color, never a raw white/black.
- Overlay: `bg-scrim` (used at `bg-scrim/50` for the modal backdrop) — the token for "darken what's behind this," never a raw `bg-black`. Not a text/foreground role, so it is excluded from the token contrast tests.
- Radii: `rounded-sm|md|lg|pill`; spacing via Tailwind's default 4px scale (matches `TOKENS.space`)
- **No raw hex, no raw px in feature code.**

## Stacking
No z-index scale yet — two sanctioned layers exist by convention: the toast region is `z-40`, and `Modal` is `z-50` (always above toasts). Any new overlay must pick a value against these two, not invent an unrelated one.

## Theming
`<ThemeProvider>` (in `layout.tsx`) manages `system | light | dark`, persisted, stamping `data-theme` on `<html>`. Default is system.

## Primitives (`src/components/ui`)
`Button` (variants primary/secondary/destructive/ghost; `loading` = aria-busy + disabled + spinner, label stays), `Input` (label required; error → `aria-invalid` + `aria-describedby`), `Select` (label required; native `<select>`; same error/hint contract as `Input`), `Card`, `Badge`, `Table` (semantic `<table>`; `caption` required — visually hidden unless `captionVisible`; `empty` node required; scrolls horizontally inside its own wrapper at 360px), `Avatar` (deterministic initials fallback from the display name; decorative unless given a `label`), `Modal` (renders nothing when closed; `role="dialog"` + `aria-modal`; focus moves in on open, cycles on Tab, returns to the opener on close; Esc closes), `ToastProvider`/`useToast` (one polite live region; `tone: "error"` toasts are also `role="alert"`; auto-dismiss after `UI_CONFIG.toast.dismissMs`, or `reducedMotionDismissMs` when the user prefers reduced motion; optional action button), `Skeleton` (aria-busy, announces "Loading…"), `EmptyState` / `ErrorState` (action required), `Icon` (curated `IconName` union; feature code never imports lucide directly).

Tunables for primitives live in `src/components/ui/config.ts` (`UI_CONFIG`) — never inline in a component.

## Motion
`TOKENS.motion` — fast 120ms / base 200ms / slow 320ms, easings `standard` and `emphasized`. Use motion for state changes and moments that matter (a pick landing, a win). Never decorative loops.

Reduced motion is honored twice over:
1. **Globally**, in `globals.css`: a `prefers-reduced-motion: reduce` block collapses every animation and transition to 0.01ms. This is the safety net — it applies to code that has never heard of the preference.
2. **Deliberately**, via `usePrefersReducedMotion()` (`src/design/use-reduced-motion.ts`) whenever "less motion" should mean *different behavior*, not merely a faster animation: the pick-landing celebration renders a static highlight instead of an animated one, and toasts dwell twice as long. Any component whose reduced-motion behavior is a real branch must have a test that asserts both branches.

## Copy
Plain language, active voice, specific. Errors say what happened and what to do next. No raw exception/DB text ever reaches a user.

## Checklist for every UI step (from `docs/conventions.md`)
Design review against this doc · light + dark verified · loading/empty/error/success states exist · `axe` clean + keyboard walkthrough · copy review · works at 360px.

Component tests run in happy-dom without a stylesheet, so the "both themes + axe" checks in `*.test.tsx` verify structural a11y (roles, labels, ARIA attributes) in each theme, not actual rendered color; real color contrast is verified numerically by `src/design/tokens.test.ts`, and browser-based visual contrast checks land with the e2e plan.
