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
- **Accessible by default.** WCAG 2.2 AA. Every input has a visible label. Every icon is decorative or labeled. Keyboard-operable primary flows. `prefers-reduced-motion` honored globally. `eslint-plugin-jsx-a11y`'s `strict` rule set runs on every `.tsx` file (`eslint.config.mjs`) as an author-time guard, alongside the runtime `axe` checks every component test already carries.
- **Never a dead end.** Empty and error states always offer an action.
- **Mobile-first.** Minimum viewport 360px.

## Tokens

Single source of truth: `src/design/tokens.ts` → generated `src/design/tokens.css` (`npm run tokens:build`; a test fails if they drift). The generated file declares namespaced source variables (`--commish-color-surface`, `--commish-pos-qb-sticker`, `--commish-space-4`, …) on `:root`; `src/app/globals.css`'s `@theme inline` block aliases each Tailwind theme variable (`--color-surface`, `--color-pos-qb`, `--text-display-lg`, …) to its `--commish-*` counterpart.

This two-layer scheme (generated `--commish-*` source vars → `@theme inline` Tailwind aliases → utility classes) exists because aliasing a theme variable to itself (`--color-surface: var(--color-surface);`) is a CSS custom-property cycle — it only resolved before because the unlayered token import happened to outrank `@layer theme` in the cascade, which is not a property to depend on.

**No raw hex, no raw px, no arbitrary values in feature code.** `src/design/tokens.ts` is the only file in the repo allowed to contain a color literal. The one sanctioned exception: `draft-room.tsx`'s collapsed chat toggle uses `lg:[writing-mode:vertical-rl]` to rotate its "Show chat" label — Tailwind has no `writing-mode` utility, so there is no non-arbitrary spelling available, and the rest of that button's classes still come from the spacing scale.

### One pigment, two jobs

The palette is **six pigments**, and four of them carry a semantic role as well as a position.
Values live in exactly one place, `src/design/tokens.ts` (`lightPigments`/`darkPigments`) — this
doc names the roles, not the hexes, so a palette tune never leaves it stale:

| pigment | position | semantic role |
|---|---|---|
| whistle | QB | `negative` |
| leaf | RB | `positive` |
| marker | WR | `accent` |
| clay | TE | `warning` |
| grape | K | — |
| slate | DEF | — |

The doubling is deliberate: a real draft kit has one pack of markers, and reusing them is what makes the board and the chrome look like one object. It is safe only because **the two uses never share a context** — a position color appears exclusively inside a `PositionBadge` or a draft-board sticker, and a semantic color never appears inside either. Breaking that rule (a red "Drafted" chip next to a red QB sticker) is what would make the doubling a bug instead of a system.

### Color roles

Values live in `src/design/tokens.ts` (`light`/`dark` palettes) — read them there, not here;
this table is the meaning of each role, which is the part a doc can keep true across a
palette tune.

| role | used for |
|---|---|
| `surface` | the page — poster stock / board wall |
| `surfaceElevated` | cards, tables, panels |
| `border` | the pencil hairline (≥3:1 vs `surface`) |
| `textPrimary` | ink / chalk |
| `textMuted` | secondary text |
| `accent` | interactive: links, primary buttons, focus rings |
| `accentText` | the label ON an accent fill |
| `positive` | good outcome (never the brand color) |
| `negative` | failure, destructive |
| `negativeText` | the label ON a negative fill |
| `warning` | caution — e.g. the clock tightening |
| `scrim` | modal backdrop (used at `bg-scrim/50`) |

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

In light, every sticker is a dark marker with a white label, and `text` equals `sticker`. In dark, five stickers are bright with a near-black label — but **DEF stays dark** (chalk label, and a brightened steel for its `text` variant — see `darkPositions.def` in `src/design/tokens.ts`), because DEF's meaning is "no color of its own" and a bright slate would be indistinguishable from the WR blue beside it.

**`PositionBadge` is the only way to render a position label; `Sticker` is the only way to render a position-pigmented tile.** `Sticker` (`src/components/ui/sticker.tsx`) owns the sticker look — rounded corner, `shadow-sticker`, fill via `positionStickerClass` — and is what `DraftBoard`'s pick cells and the landing page's showcase board both build on. Nothing else may reach for `bg-pos-*` directly. A bare `"QB"` string in a table cell is a bug.

**Carve-out: a native `<select>` option label.** An `<option>` cannot contain an element, so `lineup-editor.tsx`'s slot picker renders a position as plain text inside the option label. This is the one legitimate exception to the rule above — it is a markup constraint, not a lapse — and it does not license a bare position anywhere text CAN hold an element.

**Roster-slot letters** (`FLEX`, `BENCH` — slot types that are not themselves a position, so they cannot wear a `PositionBadge` sticker) use `SlotChip`, the bordered-chip counterpart to `PositionBadge`. Same rule: a bare slot letter in a table cell or list is the slot-letter version of the bug above.

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
- Spacing and font weight are Tailwind's own default scales, used as-is — deliberately NOT
  reflected in `TOKENS`. A scale that duplicated Tailwind's defaults inside `TOKENS` generated
  CSS variables nothing consumed (`@theme inline` had no alias for them), so it looked like a
  source of truth without being one. If either scale ever needs to diverge from Tailwind's
  default, it belongs in `TOKENS` AND in `@theme inline`'s alias block at the same time.

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

`RoomLayout`'s regions are rail, pool, stage, dock and an optional **aside** — the social band
down the right edge (league chat). It follows rule 1 (fixed width, scrolls inside itself) and
rule 3 (linearizes last on a phone, never shrinks), and it is optional because the TV board is
the same frame with nobody to talk to.

Widths come from the spacing scale (`lg:w-88` = 352px for the pool rail), never an arbitrary
value — `w-88` is Tailwind v4's on-demand spacing utility, not a bracket escape hatch.

## Stacking
No z-index scale yet — four sanctioned layers exist by convention: a sticky board header/gutter is `z-10` (inside its own scroll container), `DraftBoard`'s edge fades are `z-20` (must paint over the sticky `z-10` gutter beneath them), the toast region is `z-40`, and `Modal` is `z-50` (always above toasts). Any new overlay must pick a value against these, not invent an unrelated one.

## Theming
`<ThemeProvider>` (in `layout.tsx`) manages `system | light | dark`, persisted, stamping `data-theme` on `<html>`. Default is system.

## Primitives (`src/components/ui`)
`Button` (variants primary/secondary/destructive/ghost; `loading` = aria-busy + disabled + spinner, label stays), `Input` (label required; error → `aria-invalid` + `aria-describedby`), `Textarea` (the multi-line sibling of `Input`, same `FieldShell` label/hint/error contract; an optional `maxLength` renders a live, `aria-live="polite"` remaining-character count wired into `aria-describedby` — `ReviewComposer` is the one caller today, backed by the same `validateReviewDraft` rule the server enforces, so the number on screen and the number the API accepts can never drift), `Select` (label required; native `<select>`; same error/hint contract as `Input`), `Card` (border + `shadow-card`), `Badge` (semantic tones), **`PositionBadge`** (`position` + `size: sm|md` — the sticker chip; the ONLY renderer of a position), **`SlotChip`** (`slot` — the bordered chip for a roster-slot letter that isn't itself a position, e.g. `FLEX`/`BENCH`), **`PageTitle`** (`size: md|xl` — the one `<h1>` treatment for a PAGE; a room supplies its own `<h1>` instead, see "Layout: pages vs. rooms"), `Table` (semantic `<table>`; `caption` required — visually hidden unless `captionVisible`; `empty` node required; optional `rowAttributes` spreads plain attributes onto the `<tr>` itself, never a second wrapper element; scrolls horizontally inside its own wrapper at 360px), `Celebration` (`role="status"`; `emphasis: "self" | "peer"` picks the animation class and the accent treatment; renders with no animation class at all under reduced motion — the one primitive both `PickCelebration` and `MatchupCelebration` are built on), `Avatar` (`name` for the deterministic initials fallback, plus an `avatar` prop that is NOT a URL — it is the raw stored `AvatarRef` string (`users.avatar_url`), which `parseAvatarRef` (`@/identity/avatars.ts`) resolves into one of three renders: a preset tile — an `Icon` on one of `AvatarTone`'s five fills — for a `preset:<key>` value, an `<img>` for an `https://` URL, or the same initials fallback for anything else, including `null`, an unrecognized preset key, or a rejected scheme like `javascript:`/`data:`/`http:`; decorative unless given a `label`), `Modal` (renders nothing when closed; `role="dialog"` + `aria-modal`; focus moves in on open, cycles on Tab, returns to the opener on close; Esc closes), `ToastProvider`/`useToast` (one polite live region; `tone: "error"` toasts are also `role="alert"`; auto-dismiss after `UI_CONFIG.toast.dismissMs`, or `reducedMotionDismissMs` when the user prefers reduced motion; optional action button), `Skeleton` (aria-busy, announces "Loading…"), `EmptyState` / `ErrorState` (action required), `Icon` (curated `IconName` union; feature code never imports lucide directly — Phase 2 Plan C added `info` for `InfoTip`'s trigger glyph plus seven avatar-preset glyphs, `shield`/`flame`/`anchor`/`rocket`/`crown`/`bolt`/`clover`, keyed under the product's own names rather than lucide's, e.g. `bolt` maps to lucide's `Zap`; the eighth preset, `trophy`, reused an icon that already existed), `InfoTip` (`term: TermKey`; click-to-reveal — never hover, per WCAG 2.2 1.4.13 — a real `<button>` with `aria-expanded`; the revealed `role="note"` sits in normal document flow, never a floating overlay, so it can never obscure the trigger; `helpLevel="guided"` additionally prints the glossary entry's short line inline, unhidden — the ONE way a `@/help/glossary` definition reaches the page; `Escape` closes it while it holds focus).

Tunables for primitives live in `src/components/ui/config.ts` (`UI_CONFIG`, `EYEBROW` — the small-caps section-label class string shared by the board header, the roster/queue headings and the board's sticky column header) — never inline in a component.

## Motion
`TOKENS.motion` — fast 120ms / base 200ms / slow 320ms, easings `standard` and `emphasized`. Use motion for state changes and moments that matter (a pick landing, a win). Never decorative loops.

Four sanctioned animations, all declared in `globals.css` against token variables — never a literal duration:

| class | what it does | where |
|---|---|---|
| `animate-celebrate-peer` | 8px rise + fade, `base` | `Celebration`'s panel when the moment is someone else's (`emphasis="peer"`) — a pick that isn't yours, a league-mate's matchup |
| `animate-celebrate-self` | scale 0.96 → 1.03 → 1 settle, `slow`/`emphasized` | `Celebration`'s panel when the moment is yours (`emphasis="self"`) — your own drafted pick, your matchup win, a clinched playoff spot |
| `animate-sticker-slap` | scale 1.15 → 1 with a small rotate settle, `slow`/`emphasized` | the board cell for the pick that just landed |
| `animate-spotlight` | a slow opacity breath on the accent ring | the board cell that is on the clock |

**One `Celebration` primitive, two callers.** `PickCelebration` (the draft room) and `MatchupCelebration` (the league room) are the same moment — "something worth announcing just happened" — said with different words. Both are built on `Celebration` + `useTransientVisibility` (`src/design/use-transient-visibility.ts`, keyed so a redelivered event never re-animates) rather than each rolling its own timer and markup. The board's sticker slap is a separate animation on the grid cell, independent of the panel's own self/peer treatment.

Reduced motion is honored twice over:
1. **Globally**, in `globals.css`: a `prefers-reduced-motion: reduce` block collapses every animation and transition to 0.01ms. This is the safety net — it applies to code that has never heard of the preference.
2. **Deliberately**, via `usePrefersReducedMotion()` (`src/design/use-reduced-motion.ts`) whenever "less motion" should mean *different behavior*, not merely a faster animation: the landing sticker simply appears (no slap), the on-the-clock cell keeps a **static** accent ring instead of breathing, `Celebration`'s panel renders with no animation class at all (but still appears, and is still announced via `role="status"`), and toasts dwell twice as long. Any component whose reduced-motion behavior is a real branch must have a test that asserts both branches.

## Copy
Plain language, active voice, specific. Errors say what happened and what to do next. No raw exception/DB text ever reaches a user.

## Checklist for every UI step (from `docs/conventions.md`)
Design review against this doc · light + dark verified · loading/empty/error/success states exist · `axe` clean + keyboard walkthrough · copy review · works at 360px.

Component tests run in happy-dom without a stylesheet, so the "both themes + axe" checks in `*.test.tsx` verify structural a11y (roles, labels, ARIA attributes) in each theme, not actual rendered color; real color contrast is verified numerically by `src/design/tokens.test.ts` — which covers the semantic roles *and* all fifteen sticker pairs in both themes — and browser-based visual contrast checks land with the e2e plan.
