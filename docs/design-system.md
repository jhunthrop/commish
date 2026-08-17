# Commish — Design System

**Read this before building any user-visible surface**, alongside `docs/conventions.md`. Everything here is enforced by tests where it can be, and by review where it can't.

## Principles
- **Delightful, not merely functional.** The product thesis (strategy doc §4) is that this category feels flat and we won't. Optimistic UI, celebration moments, motion with intent.
- **Both themes are first-class.** Every surface is designed and tested in light and dark. No color exists only in one theme.
- **Accessible by default.** WCAG 2.2 AA. Every input has a visible label. Every icon is decorative or labeled. Keyboard-operable primary flows. `prefers-reduced-motion` honored globally.
- **Never a dead end.** Empty and error states always offer an action.
- **Mobile-first.** Minimum viewport 360px.

## Tokens
Single source of truth: `src/design/tokens.ts` → generated `src/design/tokens.css` (`npm run tokens:build`; a test fails if they drift). Use tokens via Tailwind aliases:
- Surfaces: `bg-surface`, `bg-surface-elevated`, `border-border`
- Text: `text-text-primary`, `text-text-muted`
- Accent: `bg-accent text-accent-text` (buttons/links), `text-accent`
- Semantic: `text-positive` / `text-negative` / `text-warning` (semantic color is *not* the accent)
- Semantic-on-fill: when a semantic color is used as a fill (e.g. `bg-negative`), pair it with its `-text` role (e.g. `text-negative-text`) for the label color, never a raw white/black.
- Radii: `rounded-sm|md|lg|pill`; spacing via Tailwind's default 4px scale (matches `TOKENS.space`)
- **No raw hex, no raw px in feature code.**

## Theming
`<ThemeProvider>` (in `layout.tsx`) manages `system | light | dark`, persisted, stamping `data-theme` on `<html>`. Default is system.

## Primitives (`src/components/ui`)
`Button` (variants primary/secondary/destructive/ghost; `loading` = aria-busy + disabled + spinner, label stays), `Input` (label required; error → `aria-invalid` + `aria-describedby`), `Card`, `Badge`, `Skeleton` (aria-busy, announces "Loading…"), `EmptyState` / `ErrorState` (action required), `Icon` (curated `IconName` union; feature code never imports lucide directly).

## Motion
`TOKENS.motion` — fast 120ms / base 200ms / slow 320ms. Use motion for state changes and moments that matter (a pick landing, a win). Never decorative loops. Reduced-motion is globally respected in `globals.css`.

## Copy
Plain language, active voice, specific. Errors say what happened and what to do next. No raw exception/DB text ever reaches a user.

## Checklist for every UI step (from `docs/conventions.md`)
Design review against this doc · light + dark verified · loading/empty/error/success states exist · `axe` clean + keyboard walkthrough · copy review · works at 360px.
