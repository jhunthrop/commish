# Commish — Design System

**Read this before building any user-visible surface**, alongside `docs/conventions.md`. Everything here is enforced by tests where it can be, and by review where it can't.

## Identity: the Poster Board

Commish looks like **the draft board** — the physical draft-kit poster taped to a wall, with a colored sticker for every pick. That is the product's one visual idea, and everything else follows from it:

- **Light is the identity.** Off-white poster stock, near-black ink, a pencil hairline rule. The color in the interface comes almost entirely from the position stickers; the chrome stays quiet so they can shout.
- **Dark is the same board at night.** A warm-neutral charcoal wall, chalk lettering, the same six markers brightened until they read against it. Not an inversion — the same object under different light.
- **The board is the hero.** `DraftBoard` is the largest, loudest thing in the draft room. Everything else (pool, rosters, history) is support.
- **Condensed display type is the board's voice.** Barlow Condensed for anything that would be hand-lettered on a poster: board headers, sticker names, the clock, page and team titles.

Default theme is still `system`; both themes are first-class and both are tested.

## Principles
- **Delightful, not merely functional.** The product thesis (strategy doc §4) is that this category feels flat and we won't. Optimistic UI, celebration moments, motion with intent.
- **Both themes are first-class.** Every surface is designed and tested in light and dark. No color exists only in one theme.
- **Accessible by default.** WCAG 2.2 AA. Every input has a visible label. Every icon is decorative or labeled. Keyboard-operable primary flows. `prefers-reduced-motion` honored globally.
- **Never a dead end.** Empty and error states always offer an action.
- **Mobile-first.** Minimum viewport 360px.

## Tokens

Single source of truth: `src/design/tokens.ts` → generated `src/design/tokens.css` (`npm run tokens:build`; a test fails if they drift). The generated file declares namespaced source variables (`--commish-color-surface`, `--commish-pos-qb-sticker`, `--commish-space-4`, …) on `:root`; `src/app/globals.css`'s `@theme inline` block aliases each Tailwind theme variable (`--color-surface`, `--color-pos-qb`, `--text-display-lg`, …) to its `--commish-*` counterpart.

This two-layer scheme (generated `--commish-*` source vars → `@theme inline` Tailwind aliases → utility classes) exists because aliasing a theme variable to itself (`--color-surface: var(--color-surface);`) is a CSS custom-property cycle — it only resolved before because the unlayered token import happened to outrank `@layer theme` in the cascade, which is not a property to depend on.

**No raw hex, no raw px, no arbitrary values in feature code.** `src/design/tokens.ts` is the only file in the repo allowed to contain a color literal.

### One pigment, two jobs

The palette is **six pigments**, and four of them carry a semantic role as well as a position:

| pigment | position | semantic role | light | dark |
|---|---|---|---|---|
| whistle | QB | `negative` | `#C8102E` | `#FF6B5E` |
| leaf | RB | `positive` | `#0B7A3E` | `#5EC77E` |
| marker | WR | `accent` | `#1D4ED8` | `#7AA5FF` |
| clay | TE | `warning` | `#B45309` | `#E5B054` |
| grape | K | — | `#6D28D9` | `#B48CFF` |
| slate | DEF | — | `#2F3742` | `#3E4650` |

The doubling is deliberate: a real draft kit has one pack of markers, and reusing them is what makes the board and the chrome look like one object. It is safe only because **the two uses never share a context** — a position color appears exclusively inside a `PositionBadge` or a draft-board sticker, and a semantic color never appears inside either. Breaking that rule (a red "Drafted" chip next to a red QB sticker) is what would make the doubling a bug instead of a system.

### Color roles

| role | light | dark | used for |
|---|---|---|---|
| `surface` | `#F6F5F1` | `#17181A` | the page — poster stock / board wall |
| `surfaceElevated` | `#FFFFFF` | `#202225` | cards, tables, panels |
| `border` | `#8E8A7E` | `#66676C` | the pencil hairline (≥3:1 vs `surface`) |
| `textPrimary` | `#16181D` | `#F2EFE9` | ink / chalk |
| `textMuted` | `#5A5E66` | `#A8A69F` | secondary text |
| `accent` | `#1D4ED8` | `#7AA5FF` | interactive: links, primary buttons, focus rings |
| `accentText` | `#FFFFFF` | `#14161A` | the label ON an accent fill |
| `positive` | `#0B7A3E` | `#5EC77E` | good outcome (never the brand color) |
| `negative` | `#C8102E` | `#FF6B5E` | failure, destructive |
| `negativeText` | `#FFFFFF` | `#14161A` | the label ON a negative fill |
| `warning` | `#B45309` | `#E5B054` | caution — e.g. the clock tightening |
| `scrim` | `#16181D` | `#000000` | modal backdrop (used at `bg-scrim/50`) |

Tailwind aliases: `bg-surface`, `bg-surface-elevated`, `border-border`, `text-text-primary`, `text-text-muted`, `bg-accent text-accent-text`, `text-accent`, `text-positive` / `text-negative` / `text-warning`, `bg-scrim`.

**Semantic-on-fill:** when a semantic color is used as a fill (`bg-negative`), pair it with its `-text` role (`text-negative-text`) for the label — never a raw white or black.

### Position stickers

`TOKENS.position[theme][role]` — three values per position, per theme:

| field | CSS var | Tailwind alias | rule enforced by test |
|---|---|---|---|
| `sticker` | `--commish-pos-<role>-sticker` | `bg-pos-<role>` | the six fills are pairwise distinguishable (contrast ≥1.5 **or** hue ≥30°) |
| `stickerText` | `--commish-pos-<role>-sticker-text` | `text-pos-<role>-on` | ≥4.5:1 against its own `sticker` |
| `text` | `--commish-pos-<role>-text` | `text-pos-<role>-text` | ≥4.5:1 against **both** surfaces |

`<role>` is `qb | rb | wr | te | k | def`.

In light, every sticker is a dark marker with a white label, and `text` equals `sticker`. In dark, five stickers are bright with a near-black label — but **DEF stays dark** (chalk label, and a brightened steel `#A8B0BC` for its `text` variant), because DEF's meaning is "no color of its own" and a bright slate would be indistinguishable from the WR blue beside it.

**`PositionBadge` is the only way to render a position.** Nothing else may reach for `bg-pos-*`, except `DraftBoard`'s own sticker cells (which are `PositionBadge`-colored fills at cell scale). A bare `"QB"` string in a table cell is a bug.

### Type

Two faces, one rule.

| face | variable | Tailwind | for |
|---|---|---|---|
| body | `--font-geist-sans` | `font-sans` (default) | everything you read in sentences |
| display | `--font-barlow-condensed` | `font-display` | board headers, sticker names, the clock, page titles, team names |
| mono | `--font-geist-mono` | `font-mono` | clock digits, tabular numbers |

**Never set the display face on a paragraph.** It is a lettering face, not a reading face.

Body scale (`--text-*`): `xs 12 · sm 14 · md 16 · lg 18 · xl 22 · 2xl 28 · 3xl 36`.
Display scale (`--text-display-*`), a deliberately separate scale: `sm 20 · md 28 · lg 40 · xl 64`, with `leading-display` (1.05). A display size is never a substitute for a body size at the same px.

### Depth

| token | Tailwind | for |
|---|---|---|
| `shadow.card` | `shadow-card` | `Card`, `Modal`, toasts — paper lifted a hair off the page |
| `shadow.sticker` | `shadow-sticker` | a filled board cell — a sticker sitting proud of the board |

Shadows are theme-independent on purpose: a shadow is cast light, and on the dark wall the border does the separating instead — a lightened "shadow" would read as a glow.

### Other scales
- Radii: `rounded-sm|md|lg|pill`. Stickers are `rounded-sm` — a sticker is a rectangle, not a pill.
- Spacing via Tailwind's default 4px scale (matches `TOKENS.space`).

## Layout: pages vs. rooms

Two shapes, and a surface is one or the other — never a blend.

**A page is a document.** Centered `max-w-*` container, normal page scroll, one `<h1>`,
content flowing down it. Everything under `/app/**` except the draft room is a page.

**A room is a frame.** A `100dvh`, `overflow-hidden` grid of fixed bands and scrolling
regions; the page itself never scrolls, every region that can outgrow its band scrolls inside
itself, and nothing reflows when state changes. The draft room and the TV board are the only
rooms today (`RoomLayout`, `docs/draft-room.md`).

Three rules any future room follows:

1. **Bands are fixed height, regions are flexible.** A band whose height depends on its
   contents will move the thing the user is watching. Rail `lg:h-20`, dock `lg:h-24`.
2. **Full-bleed means full-bleed.** The route's `page.tsx` drops the container, and the room
   supplies its own `<h1>`. A room inside a centered container is a page wearing a costume.
3. **Below `lg`, linearize — never shrink.** Re-sequence the same regions into one scrolling
   column with `order-*` utilities. Rendering a second, narrow copy of a region is only
   justified when the two are genuinely different objects (`DraftBoard`'s grid and its
   per-round list are, and the inactive one is `display: none` so nothing is announced twice).

Widths come from the spacing scale (`lg:w-88` = 352px for the pool rail), never an arbitrary
value — `w-88` is Tailwind v4's on-demand spacing utility, not a bracket escape hatch.

## Stacking
No z-index scale yet — three sanctioned layers exist by convention: a sticky board header/gutter is `z-10` (inside its own scroll container), the toast region is `z-40`, and `Modal` is `z-50` (always above toasts). Any new overlay must pick a value against these, not invent an unrelated one.

## Theming
`<ThemeProvider>` (in `layout.tsx`) manages `system | light | dark`, persisted, stamping `data-theme` on `<html>`. Default is system.

## Primitives (`src/components/ui`)
`Button` (variants primary/secondary/destructive/ghost; `loading` = aria-busy + disabled + spinner, label stays), `Input` (label required; error → `aria-invalid` + `aria-describedby`), `Select` (label required; native `<select>`; same error/hint contract as `Input`), `Card` (border + `shadow-card`), `Badge` (semantic tones), **`PositionBadge`** (`position` + `size: sm|md|lg` — the sticker chip; the ONLY renderer of a position), `Table` (semantic `<table>`; `caption` required — visually hidden unless `captionVisible`; `empty` node required; scrolls horizontally inside its own wrapper at 360px), `Avatar` (deterministic initials fallback from the display name; decorative unless given a `label`), `Modal` (renders nothing when closed; `role="dialog"` + `aria-modal`; focus moves in on open, cycles on Tab, returns to the opener on close; Esc closes), `ToastProvider`/`useToast` (one polite live region; `tone: "error"` toasts are also `role="alert"`; auto-dismiss after `UI_CONFIG.toast.dismissMs`, or `reducedMotionDismissMs` when the user prefers reduced motion; optional action button), `Skeleton` (aria-busy, announces "Loading…"), `EmptyState` / `ErrorState` (action required), `Icon` (curated `IconName` union; feature code never imports lucide directly).

Tunables for primitives live in `src/components/ui/config.ts` (`UI_CONFIG`) — never inline in a component.

## Motion
`TOKENS.motion` — fast 120ms / base 200ms / slow 320ms, easings `standard` and `emphasized`. Use motion for state changes and moments that matter (a pick landing, a win). Never decorative loops.

Three sanctioned animations, all declared in `globals.css` against token variables — never a literal duration:

| class | what it does | where |
|---|---|---|
| `animate-pick-landed` | 8px rise + fade, `base` | `PickCelebration`'s announcement panel |
| `animate-sticker-slap` | scale 1.15 → 1 with a small rotate settle, `slow`/`emphasized` | the board cell for the pick that just landed |
| `animate-spotlight` | a slow opacity breath on the accent ring | the board cell that is on the clock |

**The emphasis lives on the board, not on the panel.** A pick's moment is the sticker slapping onto the grid; the announcement panel is the quiet caption beneath it.

Reduced motion is honored twice over:
1. **Globally**, in `globals.css`: a `prefers-reduced-motion: reduce` block collapses every animation and transition to 0.01ms. This is the safety net — it applies to code that has never heard of the preference.
2. **Deliberately**, via `usePrefersReducedMotion()` (`src/design/use-reduced-motion.ts`) whenever "less motion" should mean *different behavior*, not merely a faster animation: the landing sticker simply appears (no slap), the on-the-clock cell keeps a **static** accent ring instead of breathing, the celebration panel renders without its animation class, and toasts dwell twice as long. Any component whose reduced-motion behavior is a real branch must have a test that asserts both branches.

## Copy
Plain language, active voice, specific. Errors say what happened and what to do next. No raw exception/DB text ever reaches a user.

## Checklist for every UI step (from `docs/conventions.md`)
Design review against this doc · light + dark verified · loading/empty/error/success states exist · `axe` clean + keyboard walkthrough · copy review · works at 360px.

Component tests run in happy-dom without a stylesheet, so the "both themes + axe" checks in `*.test.tsx` verify structural a11y (roles, labels, ARIA attributes) in each theme, not actual rendered color; real color contrast is verified numerically by `src/design/tokens.test.ts` — which covers the semantic roles *and* all fifteen sticker pairs in both themes — and browser-based visual contrast checks land with the e2e plan.
