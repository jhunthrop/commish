# Commish — Design System

**Read this before building any user-visible surface**, alongside `docs/conventions.md`. Everything here is enforced by tests where it can be, and by review where it can't.

## Identity: the room, not the poster

v2 (Phase 3.6) retones the product: dark is now the flagship identity, a room at night rather
than a poster in daylight — a near-black ground, cool-neutral panels stepping up in depth, one
green that means both "live" and "good," six re-derived position pigments. **Both themes are
still first-class** (founder ruling, 2026-08-23): the plan that shipped v2 briefly ruled the
product dark-only, and the founder overruled it directly — dark is the approved mocks' identity,
and light is **designed** to the same nineteen roles and the same contrast thresholds, never
inverted from dark by formula. `ThemeProvider` (`system | light | dark`) is unchanged by any of
this; only the palette each theme paints with is new.

- **The room is the hero.** Depth comes from four surface steps (`surface` → `surfaceElevated` →
  `surfaceRaised` → `surfaceInset`) rather than from a single card border; a panel earns its
  place by sitting at a different depth, not by drawing a heavier line around itself.
- **One green, two jobs.** `accent` (an action) and `positive` (a good outcome) are the exact
  same hex in both themes, deliberately — see "One pigment, two jobs" below for the rule that
  keeps the doubling from becoming a bug.
- **A hairline separates; an edge bounds.** `line` is decorative (<3:1, never the boundary of a
  control) and `edge` is interactive (≥3:1, WCAG 1.4.11) — two roles where v1 only had one.
- **One type family, two roles.** Geist for both `font-sans` and `font-display`; the display
  face is distinguished by a tighter letter-spacing, not a different typeface. See "Type" below.

Default theme is still `system`; both themes are designed and tested.

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

The rule has been enforced by review since Phase 1; `src/design/no-raw-color.source.test.ts` (Phase 3.6, Task 1) is what enforces it by test — a directory-derived sweep of every `.tsx` under `src/components`, `src/league-room`, `src/draft-room`, `src/chat-room`, `src/account-room`, `src/admin-room` and `src/app`, failing on a hex literal, an `rgb(`/`rgba(` literal, or a Tailwind arbitrary-value bracket that contains one (the last is caught for free, since the first two patterns match inside a bracket exactly as they do anywhere else).

### One pigment, two (or three) jobs

The palette is **six pigments**. Values live in exactly one place, `src/design/tokens.ts`
(`lightPigments`/`darkPigments`) — this doc names the roles, not the hexes, so a palette tune
never leaves it stale.

`accent` and `positive` remain a true doubling: the exact same hex, deliberately (see "Color
roles" below) — the product's identity is that a live game and a live action are the same
energy.

**RETONED (LED-2, founder-delegated design ruling, 2026-08-24):** the other four pigments used to
be a straight doubling of a semantic role's own hex too — `whistle` (QB) was literally
`negative`, `leaf` (RB) was `positive`, `marker` (WR) was `info`, `clay` (TE) was `warning`. The
gauntlet named that as the product's last old-software signal: a full-cell sticker fill at
semantic-role saturation reads as a spreadsheet, not a board. Position color stays as scanning
information — the veteran reads the position off the color before the letters — so the ruling
did not remove the hue relationship, only the saturation:

| pigment | position | derived from | relationship |
|---|---|---|---|
| whistle | QB | `negative` | same hue/lightness, 60% saturation |
| leaf | RB | `positive` (== `accent`) | same hue/lightness, 60% saturation |
| marker | WR | `info` | same hue/lightness, 60% saturation |
| clay | TE | `warning` | same hue/lightness, 60% saturation |
| grape | K | — | its own pigment, 60% saturation of its prior self |
| slate | DEF | — | unchanged — already the quiet one, no hue of its own |

Each of the four now has its **own hex**, no longer pinned to the semantic role's own value — a
position sticker and its one-time semantic twin move independently. `negative`/`positive`/`info`/
`warning` keep full saturation everywhere else in the product (an error state should not read as
quiet); the draft board's own fills read calmer. `tokens.test.ts`'s pairwise sticker matrix is
the gate this retone is proven against, in both themes: every pair still clears 1.5:1 contrast or
30° of hue separation.

The kinship is still deliberate: a real draft kit has one pack of markers dialed to a house tone,
and that shared hue family is what still makes the board and the chrome read as one object even
though the fills no longer match pixel-for-pixel. It stays safe for the same reason the doubling
always was — **a position color and a semantic color never share a context** — a position color
appears exclusively inside a `PositionBadge` or a draft-board sticker, and a semantic color never
appears inside either. `marker` (WR) still cannot double `accent` outright: sharing a hex with
`leaf` (RB) would make the two stickers indistinguishable, which the pairwise sticker test exists
to catch, so it derives from `info` instead.

**Green is a fill only when it is an action.** The `accent`/`positive` doubling has its own
sharper rule, because unlike the position doubling, `accent` and `positive` CAN appear in the
same view: a positive outcome is green as text, a glow (`accentGlow`) or a meter fill — never as
a solid button-shaped block. A `bg-positive` chip beside a `bg-accent` button is exactly the bug
this rule exists to prevent, because a viewer would read both as the same action.

### Color roles

Values live in `src/design/tokens.ts` (`light`/`dark` palettes) — read them there, not here;
this table is the meaning of each role, which is the part a doc can keep true across a
palette tune. v2 (Phase 3.6, Task 1) retoned every role and added seven: `surfaceRaised`,
`surfaceInset`, `edge`, `textFaint`, `accentGlow`, `warningGlow`, `info`. **`border` is renamed
to `line`** — a compile-forced sweep across every `border-border` utility, because v2 needs two
boundary concepts a single name could not carry: a decorative hairline (`line`, <3:1) and an
interactive edge (`edge`, ≥3:1, WCAG 1.4.11). Leaving the old name on the decorative role would
have every future control's boundary quietly fail contrast.

| role | used for |
|---|---|
| `surface` | the page — the ground |
| `surfaceElevated` | a panel |
| `surfaceRaised` | a row hover, a field, a nested tile |
| `surfaceInset` | a track, a slot well, an unfilled meter |
| `line` | the decorative hairline between two surfaces (<3:1 vs `surface` — NOT a control boundary) |
| `edge` | the boundary of a control a user must find (≥3:1 vs every surface) |
| `textPrimary` | primary text |
| `textMuted` | secondary text |
| `textFaint` | tertiary text — card meta, step captions, table subs |
| `accent` | interactive: links, primary buttons, focus rings. **Same hex as `positive`** |
| `accentText` | the label ON an accent fill |
| `accentGlow` | a translucent accent tint — a live-state ring, a highlighted row |
| `positive` | good outcome, as text/glow/meter fill only — **never a solid fill** (see "One pigment, two jobs") |
| `negative` | failure, destructive |
| `negativeText` | the label ON a negative fill |
| `warning` | caution — e.g. the clock tightening |
| `warningGlow` | a translucent warning tint |
| `info` | informational — neutral notices, the WR sticker's semantic pairing |
| `scrim` | modal backdrop (used at `bg-scrim/50`) |

Tailwind aliases: `bg-surface`, `bg-surface-elevated`, `bg-surface-raised`, `bg-surface-inset`, `border-line`, `border-edge`, `text-text-primary`, `text-text-muted`, `text-text-faint`, `bg-accent text-accent-text`, `text-accent`, `bg-accent-glow`, `text-positive` / `text-negative` / `text-warning` / `text-info`, `bg-warning-glow`, `bg-scrim`.

**Semantic-on-fill:** when a semantic color is used as a fill (`bg-negative`), pair it with its `-text` role (`text-negative-text`) for the label — never a raw white or black.

### Position stickers

`TOKENS.position[theme][role]` — three values per position, per theme:

| field | CSS var | Tailwind alias | rule enforced by test |
|---|---|---|---|
| `sticker` | `--commish-pos-<role>-sticker` | `bg-pos-<role>` | the six fills are pairwise distinguishable (contrast ≥1.5 **or** hue ≥30°) |
| `stickerText` | `--commish-pos-<role>-sticker-text` | `text-pos-<role>-on` | ≥4.5:1 against its own `sticker` |
| `text` | `--commish-pos-<role>-text` | `text-pos-<role>-text` | ≥4.5:1 against **both** surfaces |

`<role>` is `qb | rb | wr | te | k | def`.

In light, five stickers are dark, saturated markers with a white label, and `text` equals `sticker`. In dark, the same five are bright with a near-black label. **DEF is the quiet one in both, inverted:** in dark it stays a dark, muted fill with a chalk label and a separate brightened `text` variant (raw fill too dark to read as text); in light it is a pale, muted fill with a dark label and a separate darkened `text` variant (raw fill too light to read as text) — see `darkPositions.def`/`lightPositions.def` in `src/design/tokens.ts`. DEF's meaning is "no color of its own," and giving it the same treatment as the other five would make it indistinguishable from whichever sticker sits beside it.

**`PositionBadge` is the only way to render a position label; `Sticker` is the only way to render a position-pigmented tile.** `Sticker` (`src/components/ui/sticker.tsx`) owns the sticker look — rounded corner, `shadow-sticker`, fill via `positionStickerClass` — and is what `DraftBoard`'s pick cells and the landing page's showcase board both build on. Nothing else may reach for `bg-pos-*` directly. A bare `"QB"` string in a table cell is a bug.

**Carve-out: a native `<select>` option label.** An `<option>` cannot contain an element, so `lineup-editor.tsx`'s slot picker renders a position as plain text inside the option label. This is the one legitimate exception to the rule above — it is a markup constraint, not a lapse — and it does not license a bare position anywhere text CAN hold an element.

**Roster-slot letters** (`FLEX`, `BENCH`, and `SUPERFLEX` as of Phase 3.5 Task 1 — slot types that are not themselves a position, so they cannot wear a `PositionBadge` sticker) use `SlotChip`, the bordered-chip counterpart to `PositionBadge`. Same rule: a bare slot letter in a table cell or list is the slot-letter version of the bug above. `SUPERFLEX` needed no new component or icon — it renders through the identical `SlotChip` every other non-position slot already uses.

### Type

Two faces, one family (v2, Task 1: `Barlow_Condensed` is removed — the condensed poster face was
the single strongest "this is a prototype" signal in the pre-v2 product).

| face | variable | Tailwind | for |
|---|---|---|---|
| body | `--font-geist-sans` | `font-sans` (default) | everything you read in sentences |
| display | `--font-geist-sans` | `font-display` | board headers, sticker names, the clock, page titles, team names |
| mono | `--font-geist-mono` | `font-mono` | clock digits, tabular numbers |

`font-display` **keeps its name and every call site** from before the retone — it now resolves to
the same Geist family as `font-sans`, distinguished only by `letter-spacing: -0.02em` (a plain
CSS rule on `.font-display` in `globals.css`, since Tailwind's generated font-family utility
carries no tracking of its own). **Never set the display face on a paragraph.** It is a
lettering face, not a reading face.

`font-mono` gained one rule the mocks apply everywhere and the pre-v2 product applied nowhere:
`font-variant-numeric: tabular-nums` is on `.font-mono` itself, so a score that changes never
shifts the column beside it.

**The type scale has two emissions from one source of truth**, `TOKENS.font.size` /
`TOKENS.font.sizeDense` — the mocks are 13–14px dense on desktop, and that density is deliberate,
but a 13px body on a 360px phone is not. `renderTokensCss` emits `size` on `:root` and
`sizeDense` a second time inside `@media (min-width: UI_CONFIG.shell.denseFromPx)`, so a
component never writes `text-sm lg:text-xs` — density is a property of the viewport, expressed
once, in the generated stylesheet. Both scales carry the same keys; a key present in one and
missing from the other is a size that silently stops responding, and `generate-css.test.ts`
asserts they match.

Body scale (`--text-*`): `xs 12 · sm 13.5 · md 15 · lg 17 · xl 20 · 2xl 26 · 3xl 34`, densifying
at `UI_CONFIG.shell.denseFromPx` to `xs 11 · sm 12.5 · md 13.5 · lg 15 · xl 17 · 2xl 22 · 3xl 30`.
**`xs` is for letter-spaced uppercase eyebrows only, never a sentence** — the rule joins the
display-face rule it resembles.

Display scale (`--text-display-*`), a deliberately separate scale: `sm 20 · md 28 · lg 44 · xl 64`, with `leading-display` (1.06). A display size is never a substitute for a body size at the same px.

### Depth

| token | Tailwind | for |
|---|---|---|
| `shadow.card` | `shadow-card` | `Card`, `Modal`, toasts — paper lifted a hair off the page |
| `shadow.sticker` | `shadow-sticker` | a filled board cell — a sticker sitting proud of the board |

Shadows are theme-independent on purpose: a shadow is cast light, and on the dark surface the `line`/`edge` roles do the separating instead — a lightened "shadow" would read as a glow.

### Other scales
- Radii: `rounded-sm|md|lg|pill`. Stickers are `rounded-sm` — a sticker is a rectangle, not a pill.
- Spacing and font weight are Tailwind's own default scales, used as-is — deliberately NOT
  reflected in `TOKENS`. A scale that duplicated Tailwind's defaults inside `TOKENS` generated
  CSS variables nothing consumed (`@theme inline` had no alias for them), so it looked like a
  source of truth without being one. If either scale ever needs to diverge from Tailwind's
  default, it belongs in `TOKENS` AND in `@theme inline`'s alias block at the same time.

## Layout: shell pages, rooms, public pages, and prose

Four shapes. A surface is exactly one of them — never a blend.

**A `(shell)` page is full-bleed.** `AppShell` (`src/components/app-shell/app-shell.tsx`),
rendered once by `src/app/app/(shell)/layout.tsx`, supplies the one `<main>` every page in that
route group renders into: a `px` gutter from the spacing scale, normal page scroll, and **no
`max-w-*` at all** — the founder's brief in one deletion. A page drops its own chrome and its
own container entirely; it returns its content alone. Nine pages live here today (the locker
room, `/app/leagues`, a league's home, its activity, its trades, a week's matchups, the profile,
the operator queue, a flag's detail).

**A room is a frame.** A `100dvh`, `overflow-hidden` grid of fixed bands and scrolling
regions; the page itself never scrolls, every region that can outgrow its band scrolls inside
itself, and nothing reflows when state changes. A room renders no shell at all — the draft room
(`src/app/app/(room)/drafts/[draftId]`) and the TV board decline `(shell)/layout.tsx` by living
outside its route group entirely, because `RoomRail`'s own full-height header IS the room's
chrome, and two chromes stacked would break the no-page-scroll contract (`RoomLayout`,
`docs/draft-room.md`).

**A signed-out public page carries its own slim chrome, not the shell.** `/browse`,
`/reviews` and `/app/join/[code]` are reachable without a session; a signed-in shell around a
page a stranger can land on would be chrome nobody signed out can use, and the rail's leagues
would be somebody's private list drawn beside a link anyone with the URL can open. Signed out,
these three render their own plain header (`PublicBar`, shipped by the addendum's Task 16) —
never `AppShell`. `/browse` and `/reviews` sit outside `/app` entirely, so when there IS a user
they call `shellData` and render `AppShell` themselves, the same function `(shell)/layout.tsx`
calls, never a second bespoke read.

**Long-form reading is full-bleed frames, measured paragraphs.** A `(shell)` page's `<main>`
has no `max-w-*`, but a 2000px line of body text is not density — it is a defect. A surface
whose job is prose (the review feed, the glossary, a legal page) keeps a `max-w-prose` on its
own paragraph column only, never on the frame around it. The frame is always full-bleed; only
the words a person reads line-by-line ever get measured. **The measured-paragraph pages**, the
complete list: `/league-rules`, `/support`, `/legal/terms`, `/legal/privacy` (each a
`max-w-3xl` prose column — reading pages, the carve-out from the full-width rule), a review's
own body on `/reviews` (`max-w-prose` on the paragraph, never the feed frame), and the review
section of `/app/profile`. Everything else is full-bleed.

## Signed-out chrome and the sign-in entry (addendum Task 16)

- **`PublicBar`** (`src/components/app-shell/public-bar.tsx`) — the one signed-out header:
  wordmark → `/`, optional `nav?`/`action?` props (the front door passes its three links and
  the Take a seat CTA; `/browse`, `/reviews` and `/app/join/[code]` render it bare), and a
  `SignInLink` carrying the page's own `intent`. Rendered unconditionally by `error.tsx`,
  `not-found.tsx` and `global-error.tsx` too (F14 — a client boundary cannot know the session).
- **`PublicFooter`** (`public-footer.tsx`) — the four trust links (Terms · Privacy · Support ·
  League rules) on every public surface; its own test owns the every-target-resolves assertion.
- **`SignInLink`** (`sign-in-link.tsx`) — THE one way any surface renders "sign in"; takes
  `intent: string | null` and spells `/sign-in?returnTo=…`. See `docs/conventions.md`'s intent
  rule and `docs/decisions/auth-front-door.md`.
- **`SessionNotice`** (`session-notice.tsx`) — placed by chrome, never by page: `TopBar` under
  `AppShell`, `RoomRail` (`variant="room"`, a borderless pill beside `ConnectionBanner`),
  `PublicBar` never. Quiet strip for a failed background read, `Modal` for a failed write.

## Loading (addendum Task 21, ruling 31)

The loading strategy is **four `loading.tsx` files, one per chrome, and no per-page skeleton**:

- `src/app/loading.tsx` → `AppShellSkeleton shape="public"` (front door, `/browse`, `/reviews`,
  the hold interstitial — everything above `/app`).
- `src/app/app/(shell)/loading.tsx` → `shape="content"` — suspends **only the content column**;
  the route-group layout keeps the real rail and top bar painted through every navigation.
- `src/app/app/(room)/drafts/[draftId]/loading.tsx` → `shape="room"` — the room's own bands;
  a room renders no shell.
- `src/app/app/(public)/join/[code]/loading.tsx` → `shape="public"` (F7) — the invite landing
  is signed-out reachable and must not be promised a rail.

**`AppShellSkeleton`** (`src/components/app-shell/app-shell-skeleton.tsx`) is the one component
behind all four: three `shape`s, announces exactly "Loading" (`aria-live="polite"`,
`aria-busy`), every visual rectangle `aria-hidden`. Its geometry is deliberately approximate —
per-page skeleton mimics are refused (D19): a second copy of every page's layout, maintained by
nobody.

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
`Button` (variants primary/secondary/destructive/ghost; `loading` = aria-busy + disabled + spinner, label stays), `Input` (label required; error → `aria-invalid` + `aria-describedby`), `Textarea` (the multi-line sibling of `Input`, same `FieldShell` label/hint/error contract; an optional `maxLength` renders a live, `aria-live="polite"` remaining-character count wired into `aria-describedby` — `ReviewComposer` is the one caller today, backed by the same `validateReviewDraft` rule the server enforces, so the number on screen and the number the API accepts can never drift), `Select` (label required; native `<select>`; same error/hint contract as `Input`), `Card` (border + `shadow-card`), `Badge` (semantic tones; `glow` — v2, Task 3 — adds a tinted `ring-2` for a live/urgent tone, built on `accentGlow`/`warningGlow`, the "an outcome is a glow, never a solid block" rule applied to a chip; only `accent` and `warning` carry a glow token today), **`PositionBadge`** (`position` + `size: sm|md` — the sticker chip; the ONLY renderer of a position), **`SlotChip`** (`slot` — the bordered chip for a roster-slot letter that isn't itself a position, e.g. `FLEX`/`BENCH`), **`PageTitle`** (`size: md|xl` — the one `<h1>` treatment for a PAGE; a room supplies its own `<h1>` instead, see "Layout: pages vs. rooms"), `Table` (semantic `<table>`; `caption` required — visually hidden unless `captionVisible`; `empty` node required; optional `rowAttributes` spreads plain attributes onto the `<tr>` itself, never a second wrapper element; scrolls horizontally inside its own wrapper at 360px; `density: comfortable|dense` — v2, Task 3, defaulting to `dense` as of Task 12 Step 3c once every consumer in the product converged on it, see `docs/decisions/design-v2.md` §4 for the full, twice-moved decision record), `Celebration` (`role="status"`; `emphasis: "self" | "peer"` picks the animation class and the accent treatment; renders with no animation class at all under reduced motion — the one primitive both `PickCelebration` and `MatchupCelebration` are built on), `Avatar` (`name` for the deterministic initials fallback, plus an `avatar` prop that is NOT a URL — it is the raw stored `AvatarRef` string (`users.avatar_url`), which `parseAvatarRef` (`@/identity/avatars.ts`) resolves into one of three renders: a preset tile — an `Icon` on one of `AvatarTone`'s five fills — for a `preset:<key>` value, an `<img>` for an `https://` URL, or the same initials fallback for anything else, including `null`, an unrecognized preset key, or a rejected scheme like `javascript:`/`data:`/`http:`; decorative unless given a `label`), `Modal` (renders nothing when closed; `role="dialog"` + `aria-modal`; focus moves in on open, cycles on Tab, returns to the opener on close; Esc closes), `ToastProvider`/`useToast` (one polite live region; `tone: "error"` toasts are also `role="alert"`; auto-dismiss after `UI_CONFIG.toast.dismissMs`, or `reducedMotionDismissMs` when the user prefers reduced motion; optional action button), `Skeleton` (aria-busy, announces "Loading…"), `EmptyState` / `ErrorState` (action required), `Icon` (curated `IconName` union; feature code never imports lucide directly — Phase 2 Plan C added `info` for `InfoTip`'s trigger glyph plus seven avatar-preset glyphs, `shield`/`flame`/`anchor`/`rocket`/`crown`/`bolt`/`clover`, keyed under the product's own names rather than lucide's, e.g. `bolt` maps to lucide's `Zap`; the eighth preset, `trophy`, reused an icon that already existed; v2's Task 3 added the one new icon this phase needed, `plus`), `InfoTip` (`term: TermKey`; click-to-reveal — never hover, per WCAG 2.2 1.4.13 — a real `<button>` with `aria-expanded`; the revealed `role="note"` sits in normal document flow, never a floating overlay, so it can never obscure the trigger; `helpLevel="guided"` additionally prints the glossary entry's short line inline, unhidden — the ONE way a `@/help/glossary` definition reaches the page; `Escape` closes it while it holds focus), **`Countdown`** (`remainingMs`, `size: md|lg|xl`, `tone: default|hot` — the ticking-digits primitive, `aria-hidden`, paired with a plain-language `aria-live="polite"` sibling stating the same time coarsely via `formatCoarseRemaining`, e.g. "About 8 hours left"; display only — a countdown never decides anything, the server ticker owns clock expiry; extracted into `src/components/ui/` at its THIRD caller, Phase 3.5 Task 8 — `RoomRail` and `DraftSchedulePanel` each used to own a private version and were refactored onto this one in the same commit `WaitingRoom` became the third; `size: "xl"` — v2, Task 12 — is the TV board's own display scale, `RoomRail`/`DraftBoard` variant `"tv"`).

**Five v2 primitives (Task 3), each extracted at its own second caller rather than invented ahead of need**, joining `Badge`, `Table` and `Countdown` above as the three *existing* primitives v2 extended instead of forking:
- **`Panel`** (`title`, optional `meta`, `headingLevel: 2|3`) — the "uppercase label, hairline, content" block the mocks repeat, built on `Card` plus the shared `EYEBROW` class. Two callers today (`seat-hold-panel.tsx`, `invite-panel.tsx`).
- **`Crest`** (`id`, `label`, `size?`) — a league's (or team's) two-letter tile, toned by `crestTone` (a re-export of `avatarTone`, so a league's crest and its members' avatars are drawn from one deterministic palette). Extracted at its second real caller (`LeagueRail`, which carried an interim copy of the same hash and markup until this landed); five callers today.
- **`SeatMeter`** (`filled`, `total`, `heldSeats?`) — THE seat sentence for the whole product (F17, the UX coherence review): "9 of 12 seated", gaining a low-seats clause and a held-seats clause as each becomes true, composed rather than concatenated so a screen reader takes one pause, not several. Nine callers today, including `OpenLeagueCard`'s public browse card and `WaitingRoom`.
- **`Meter`** (`label`, `value`, `max`) — a labeled fill bar that cannot be constructed without its own number beside it, generalizing `public-league-list.tsx`'s own pre-v2 "no bar without a number" ruling. Two callers today (`home-board.tsx`, `league-board.tsx`, both a matchup margin).
- **`StatPill`** (`label`, `tone?`, `glow?`) — a forced-uppercase `Badge`, for the state-chip vocabulary the mocks use (LIVE / FINAL / FIX LINEUP). **Currently down to its ONE caller** (`WeekStatusBadge`) as of Task 13's fix round, which rebuilt `LiveStatePill` — `StatPill`'s original second caller — as an icon-only shape to fit the 360px top-bar budget; see the Task 14 inert-deliverable sweep note in `docs/decisions/design-v2.md` for the disposition (not removed: the addendum's Tasks 17 and 19, queued next in the ruled execution order, are already-written consumers).

Two free-standing exports beside `Countdown` itself: `useCountdown(deadlineAt)` (the ticking hook — `UI_CONFIG.countdown.tickMs`, slowed to `reducedMotionTickMs` under reduced motion) and `formatCoarseDuration`/`formatCoarseRemaining` (the "5 minutes" / "About 2 hours left" building blocks a caller with its own sentence to build, e.g. `WaitingRoom`'s "Starts in …", reuses directly rather than writing a second minute/hour formatter).

Tunables for primitives live in `src/components/ui/config.ts` (`UI_CONFIG`, `EYEBROW` — the small-caps section-label class string shared by the board header, the roster/queue headings and the board's sticky column header) — never inline in a component.

## Motion
`TOKENS.motion` — fast 120ms / base 200ms / slow 320ms, easings `standard` and `emphasized`. Use motion for state changes and moments that matter (a pick landing, a win). Never decorative loops.

Seven sanctioned animations, all declared in `globals.css` against token variables — never a literal duration:

| class | what it does | where |
|---|---|---|
| `animate-celebrate-peer` | 8px rise + fade, `base` | `Celebration`'s panel when the moment is someone else's (`emphasis="peer"`) — a pick that isn't yours, a league-mate's matchup |
| `animate-celebrate-self` | scale 0.96 → 1.03 → 1 settle, `slow`/`emphasized` | `Celebration`'s panel when the moment is yours (`emphasis="self"`) — your own drafted pick, your matchup win, a clinched playoff spot |
| `animate-sticker-slap` | scale 1.15 → 1 with a small rotate settle, `slow`/`emphasized` | the board cell for the pick that just landed |
| `animate-spotlight` | a slow opacity breath on the accent ring | the board cell that is on the clock |
| `animate-wire` | translateX marquee, `wire` (38s), linear, infinite | *stub — v3 Task 2; consumer is Task 8's activity ticker under the nav* |
| `animate-pulse-live` | opacity 1 → .35 → 1 breath, `pulse` (1.6s) | *stub — v3 Task 2; consumer is Task 5/8's live chip dot* |
| `animate-rise` | opacity + 14px rise, `base`; `rise-1..4` stagger by 1–4× `fast` | *stub — v3 Task 2; consumer is Task 7's front door hero entrance* |

**One `Celebration` primitive, two callers.** `PickCelebration` (the draft room) and `MatchupCelebration` (the league room) are the same moment — "something worth announcing just happened" — said with different words. Both are built on `Celebration` + `useTransientVisibility` (`src/design/use-transient-visibility.ts`, keyed so a redelivered event never re-animates) rather than each rolling its own timer and markup. The board's sticker slap is a separate animation on the grid cell, independent of the panel's own self/peer treatment.

Reduced motion is honored twice over:
1. **Globally**, in `globals.css`: a `prefers-reduced-motion: reduce` block collapses every animation and transition to 0.01ms. This is the safety net — it applies to code that has never heard of the preference.
2. **Deliberately**, via `usePrefersReducedMotion()` (`src/design/use-reduced-motion.ts`) whenever "less motion" should mean *different behavior*, not merely a faster animation: the landing sticker simply appears (no slap), the on-the-clock cell keeps a **static** accent ring instead of breathing, `Celebration`'s panel renders with no animation class at all (but still appears, and is still announced via `role="status"`), and toasts dwell twice as long. Any component whose reduced-motion behavior is a real branch must have a test that asserts both branches.

## Copy

Plain language, active voice, specific. Errors say what happened and what to do next. No raw
exception/DB text ever reaches a user. Five surfaces phrasing one promise five ways is a
design-system failure, not a writing one — the rules below exist so nobody has to re-derive a
sentence this product already decided on.

**The register is expanded: no contractions** (C1, ruled). "You do not have to wait here," never
"You don't." This product tells people things about money, seats and fairness, and the expanded
register is what keeps those sentences from reading as chat. **One named exception**: the
just-seated heading, `` `${leagueName} · You're in` `` (`waiting-room.tsx`, D1) — recorded as a
decision somebody made once, not a precedent the next writer generalizes from.

**The safety net is named once: "the room picks for you from your queue"** (C3). Every surface
that reassures a member about missing a draft quotes that exact phrase (`waiting-room.tsx`,
`src/help/glossary.ts`); no surface invents "autopick," "auto-draft," or "we will draft for you."

**The when-full promise and every start-timing sentence are `describeStartTiming`'s** (F9), not
prose composed at the call site — `src/matchmaking/roll.ts` is the one function every surface
quotes: the browse card, the waiting room, the draft-schedule panel, and the
`draft_kickoff_rolled` notice. It takes an `authority` of kind `StartTimingAuthority`
(`LeagueAuthority["kind"]`, never a hand-written second union) so the vocabulary can never drift
from the authority model itself. The next surface that needs a start-timing sentence imports the
function; it does not write a new one.

**Two voice exemplars, quoted in full**, because a register is easier to copy than to define:

> "That seat went to someone else while you were signing in. Your spot in this league is gone,
> and nothing was charged." — `src/matchmaking/seat-hold.ts`

> "Nothing you typed was sent." — `src/components/app-shell/session-notice.tsx`

Both say what happened, what it means for the reader, and nothing else.

**A record may carry typographic weight** (D5): one step up the type scale and a heavier weight
on a board, never a color, a badge or an animation.

## Checklist for every UI step (from `docs/conventions.md`)
Design review against this doc · light + dark verified · loading/empty/error/success states exist · `axe` clean + keyboard walkthrough · copy review · works at 360px.

Component tests run in happy-dom without a stylesheet, so the "both themes + axe" checks in `*.test.tsx` verify structural a11y (roles, labels, ARIA attributes) in each theme, not actual rendered color; real color contrast is verified numerically by `src/design/tokens.test.ts` — which covers the semantic roles *and* all fifteen sticker pairs in both themes — and browser-based visual contrast checks land with the e2e plan.
