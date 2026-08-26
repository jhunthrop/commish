# Commish — Design System

**Read this before building any user-visible surface**, alongside `docs/conventions.md`. Everything here is enforced by tests where it can be, and by review where it can't. Every claim below either names the test that enforces it, or says "review-enforced."

## Identity: the Sunday Standard

v3 (Phase 3.7) retones the product again, on top of v2's room-not-poster shell: the founder
rejected v2's mint-on-ink identity outright ("I don't like this at all") and approved the Sunday
Standard mock in its place (`docs/research/sunday-standard.html`, "this is better," 2026-08-24,
binding). v3 is **near-monochrome** — paper/graphite and ink, with color spent on exactly two
things: money (seats filling, a good outcome) and live (a clock, a failure). Six rules govern
every surface this doc describes; they are the spine the rest of this document hangs off:

1. **Color is meaning.** Green is money and seats filling, red is live and clocks, everything
   else is ink and paper.
2. **One face, earned weights.** Geist only; hierarchy from size and weight, not from a second
   typeface.
3. **No capitals anywhere.** Every `text-transform: uppercase` is gone — league names, eyebrows,
   section labels, all of it. `src/design/no-uppercase.source.test.ts` is the gate.
4. **Hairlines, not boxes.** Structure comes from thin rules and space, not card borders.
5. **One ink action per view.** One solid pill (ink fill, ground text) per view; every other
   action is a quiet outlined pill. `src/design/accent-budget.source.test.ts` is the gate on the
   two pill spellings; the *count* per view is a component-test/review law (see "Pill discipline"
   below).
6. **Only true things move.** The wire, draft clocks, seat meters and live pulses animate because
   something real happened; chrome never does. `prefers-reduced-motion` is honored globally and
   deliberately (see "Motion").

**Both themes are still first-class** (founder ruling, 2026-08-23, unrevisited by v3): dark is
the approved mocks' identity and light is **designed** to the same nineteen roles and the same
contrast thresholds, never inverted from dark by formula. `ThemeProvider` (`system | light |
dark`) is untouched by any of this; only the palette each theme paints with moved.

- **The room is still the hero.** v3 keeps v2's four-surface depth model (`surface` →
  `surfaceElevated` → `surfaceRaised` → `surfaceInset`); a panel earns its place by sitting at a
  different depth, not by drawing a heavier line around itself — rule 4 is this idea applied to
  the v3 palette.
- **One green, two jobs; one red, two jobs.** `accent`/`positive` (money, an outcome) share one
  hex, deliberately, exactly as v2 ruled; v3 gives `negative` the identical treatment — the live
  family (clocks, live chips, destructive) is one red, jobs separated by context. See "One
  pigment, two jobs" below.
- **A hairline separates; an edge bounds.** `line` is decorative (<3:1, never the boundary of a
  control) and `edge` is interactive (≥3:1, WCAG 1.4.11) — unchanged from v2.
- **One type family, two roles.** Geist for both `font-sans` and `font-display`; see "Type"
  below for v3's ramp.

Default theme is still `system`; both themes are designed and tested.

## Principles
- **Delightful, not merely functional.** The product thesis (strategy doc §4) is that this category feels flat and we won't. Optimistic UI, celebration moments, motion with intent (rule 6).
- **Both themes are first-class.** Every surface is designed and tested in light and dark. No color exists only in one theme.
- **Accessible by default.** WCAG 2.2 AA. Every input has a visible label. Every icon is decorative or labeled. Keyboard-operable primary flows. `prefers-reduced-motion` honored globally. `eslint-plugin-jsx-a11y`'s `strict` rule set runs on every `.tsx` file (`eslint.config.mjs`) as an author-time guard, alongside the runtime `axe` checks every component test already carries.
- **Never a dead end.** Empty and error states always offer an action.
- **Mobile-first.** Minimum viewport 360px.

## Tokens

Single source of truth: `src/design/tokens.ts` → generated `src/design/tokens.css` (`npm run tokens:build`; a test fails if they drift). The generated file declares namespaced source variables (`--commish-color-surface`, `--commish-pos-qb-sticker`, `--commish-space-4`, …) on `:root`; `src/app/globals.css`'s `@theme inline` block aliases each Tailwind theme variable (`--color-surface`, `--color-pos-qb`, `--text-display-lg`, …) to its `--commish-*` counterpart.

This two-layer scheme (generated `--commish-*` source vars → `@theme inline` Tailwind aliases → utility classes) exists because aliasing a theme variable to itself (`--color-surface: var(--color-surface);`) is a CSS custom-property cycle — it only resolved before because the unlayered token import happened to outrank `@layer theme` in the cascade, which is not a property to depend on.

**No raw hex, no raw px, no arbitrary values in feature code.** `src/design/tokens.ts` is the only file in the repo allowed to contain a color literal. The one sanctioned exception: `draft-room.tsx`'s collapsed chat toggle uses `lg:[writing-mode:vertical-rl]` to rotate its "Show chat" label — Tailwind has no `writing-mode` utility, so there is no non-arbitrary spelling available, and the rest of that button's classes still come from the spacing scale. A second sanctioned exception, narrower still: `.yard-lines`' repeating-gradient pitch in `globals.css` is a plain CSS value beside a comment naming the mock (self-ruling S5) — a fact of one class's geometry in a stylesheet, not feature code the sweep below walks.

The rule has been enforced by review since Phase 1; `src/design/no-raw-color.source.test.ts` (Phase 3.6, Task 1) is what enforces it by test — a directory-derived sweep of every `.tsx` under `src/components`, `src/league-room`, `src/draft-room`, `src/chat-room`, `src/account-room`, `src/admin-room` and `src/app`, failing on a hex literal, an `rgb(`/`rgba(` literal, or a Tailwind arbitrary-value bracket that contains one (the last is caught for free, since the first two patterns match inside a bracket exactly as they do anywhere else).

### The v3 palette: money and live, in daylight and at night

The mock names six colors, two grounds. Values live in exactly one place, `src/design/tokens.ts`
(`light`/`dark`) — this doc names the vocabulary, not a copy of the hexes, so a palette tune
never leaves it stale. As shipped (Task 1, plus fix round 1's WCAG corrections):

| the mock's word | role(s) | dark (night) | light (daylight) |
|---|---|---|---|
| graphite / paper | `surface` | `#0D0D0F` | `#FBFBFA` |
| card | `surfaceElevated` | `#161619` | `#FFFFFF` |
| — (derived) | `surfaceRaised` | `#1C1C20` | `#F8F8F6` |
| tickbg / — | `surfaceInset` | `#111114` | `#F3F3F1` |
| hairline | `line` | `#242428` | `#E8E8EA` |
| — (derived, no mock value) | `edge` | `#6A6A71` | `#8B8B91` |
| ink | `textPrimary` | `#F4F4F6` | `#1A1A1E` |
| quiet | `textMuted` | `#98989F` | `#68686D` |
| faint (retuned, see below) | `textFaint` | `#85858F` | `#6D6D76` |
| money | `accent` / `positive` | `#3ECF8E` | `#0B6B43` |
| live | `negative` | `#FF6B5E` | `#C23228` (retuned, see below) |
| — (retuned, demoted usage) | `warning` | `#AD7E0E` | `#846315` (retuned) |
| — (retuned, unnamed by the mock) | `info` | `#3E84EF` | `#4C69CD` |

Two corrections during Task 1's fix round, the same class of gap v2's own contrast corrections
were: `light.textMuted` and `light.negative`/`warning` measured a hair under 4.5:1 once composited
under the draft room's translucent `bg-negative/10` "hot" rail tint — a case the plain-surface
pair matrix never exercised. `tokens.test.ts`'s `"TOKENS.color bands"` describe block is the gate
added to catch this class of failure going forward: every text role is now also checked against
its own translucent band composited over each surface, in both themes.

**Money is a fill only when it is money or an action; live is text/glow/chip, never a solid
block outside its own destructive button.** The doubling rules from v2 carry forward exactly:
`accent`/`positive` share a hex because a live game and a live action are the same energy;
`negative` is now the whole "live" family (a draft clock tightening, a live chip's dot, a
destructive button) for the identical reason — one hue, jobs separated by context, never two
solid fills of the same color in one view meaning two different things.

**`warning`/`info` survive, retuned and demoted (self-ruling S1).** The nineteen-role set is
frozen — v3 does not remove a role, it retones values and, for `warning`, demotes *usage*: E5
moved the browse card's `when_full` reassurance sentence from `text-warning` to `text-text-muted`,
so amber is reserved for a clock that is actually tightening rather than every neutral scheduling
fact on the shelf.

**Type ramp:** `TOKENS.font.display.xl` moved 64 → 58 (the mock's display size); display tracking
moved −0.02em → −0.028em on display sizes only (self-ruling S3, `globals.css`'s `.font-display`
rule); body sizes are untouched. See "Type" below for the full ramp.

**Motion:** `TOKENS.motion.duration` gained `wire` (38 000ms, the ticker loop) and `pulse`
(1 600ms, the live chip's breath) — both consumed by name in `globals.css`, never a literal
duration at a call site.

### One pigment, two (or three) jobs

The palette is **six pigments**. Values live in exactly one place, `src/design/tokens.ts`
(`lightPigments`/`darkPigments`) — this doc names the roles, not the hexes, so a palette tune
never leaves it stale.

`accent` and `positive` remain a true doubling: the exact same hex, deliberately (see above) —
the product's identity is that a live game and a live action are the same energy. v3 extends the
doubling logic to `negative` (see above): one red, two jobs, separated by context rather than by
hue.

**RETONED (LED-2, founder-delegated design ruling, 2026-08-24) then RE-DERIVED for v3's grounds,
same date:** the position pigments (`whistle`/`leaf`/`marker`/`clay`/`grape`/`slate`) used to be a
straight doubling of a semantic role's own hex — `whistle` (QB) was literally `negative`, `leaf`
(RB) was `positive`, `marker` (WR) was `info`, `clay` (TE) was `warning`. The gauntlet named that
as the product's last old-software signal: a full-cell sticker fill at semantic-role saturation
reads as a spreadsheet, not a board. Position color stays as scanning information — the veteran
reads the position off the color before the letters — so the ruling did not remove the hue
relationship, only the saturation:

| pigment | position | derived from | relationship |
|---|---|---|---|
| whistle | QB | `negative` | same hue/lightness, 60% saturation |
| leaf | RB | `positive` (== `accent`) | same hue/lightness, 60% saturation |
| marker | WR | `info` | same hue/lightness (lightness retuned to clear 4.5:1 against v3's grounds) |
| clay | TE | `warning` | same hue/lightness (lightness retuned in dark to clear 4.5:1) |
| grape | K | — | its own pigment, unchanged by the v3 re-derivation |
| slate | DEF | — | unchanged — already the quiet one, no hue of its own |

Each of the four now has its **own hex**, no longer pinned to the semantic role's own value — a
position sticker and its one-time semantic twin move independently. `negative`/`positive`/`info`/
`warning` keep full saturation everywhere else in the product (an error state should not read as
quiet); the draft board's own fills read calmer. `tokens.test.ts`'s pairwise sticker matrix
(`"TOKENS.position"` describe block) is the gate this retone is proven against, in both themes:
every pair still clears 1.5:1 contrast or 30° of hue separation, and `marker`/`clay` — the two
that missed the floor once plugged into v3's near-monochrome grounds — had their lightness
retuned (never their hue or their saturation family) until they cleared.

The kinship is still deliberate: a real draft kit has one pack of markers dialed to a house tone,
and that shared hue family is what still makes the board and the chrome read as one object even
though the fills no longer match pixel-for-pixel. It stays safe for the same reason the doubling
always was — **a position color and a semantic color never share a context** — a position color
appears exclusively inside a `PositionBadge` or a draft-board sticker, and a semantic color never
appears inside either.

### Color roles

Values live in `src/design/tokens.ts` (`light`/`dark` palettes) — read them there, not here;
this table is the meaning of each role in v3, which is the part a doc can keep true across a
palette tune. The nineteen-role set (`COLOR_ROLES`) is frozen; v3 retones every value and changes
what two of the roles are *used for*.

| role | used for |
|---|---|
| `surface` | the page — the ground |
| `surfaceElevated` | a panel |
| `surfaceRaised` | a row hover, a field, a nested tile |
| `surfaceInset` | a track, a slot well, an unfilled meter, the wire's own band |
| `line` | the decorative hairline between two surfaces (<3:1 vs `surface` — NOT a control boundary) |
| `edge` | the boundary of a control a user must find (≥3:1 vs every surface) |
| `textPrimary` | primary text — also the ink pill's own fill (`bg-text-primary`, see "Pill discipline") |
| `textMuted` | secondary text |
| `textFaint` | tertiary text — card meta, step captions, table subs |
| `accent` | **money**: interactive links, focus rings, seat-meter fill. **Same hex as `positive`** |
| `accentText` | the label ON a money fill |
| `accentGlow` | a translucent money tint — the front door's floodlight, a highlighted row |
| `positive` | good outcome, as text/glow/meter fill only — **never a solid button fill** (see "One pigment, two jobs") |
| `negative` | **live**: a draft clock tightening, a live chip's dot, destructive actions — one red family, jobs separated by context |
| `negativeText` | the label ON a live/destructive fill |
| `warning` | caution, demoted usage in v3 (E5) — reserved for a clock genuinely tightening, never a neutral scheduling sentence |
| `warningGlow` | a translucent warning tint |
| `info` | informational — neutral notices, the WR sticker's semantic pairing |
| `scrim` | modal backdrop (used at `bg-scrim/50`) |

Tailwind aliases: `bg-surface`, `bg-surface-elevated`, `bg-surface-raised`, `bg-surface-inset`, `border-line`, `border-edge`, `text-text-primary`, `text-text-muted`, `text-text-faint`, `bg-accent text-accent-text`, `text-accent`, `bg-accent-glow`, `text-positive` / `text-negative` / `text-warning` / `text-info`, `bg-warning-glow`, `bg-scrim`.

**Semantic-on-fill:** when a semantic color is used as a fill (`bg-negative`), pair it with its `-text` role (`text-negative-text`) for the label — never a raw white or black.

### The caps charter: no capitals anywhere (rule 3)

**Every `text-transform: uppercase` is gone from the product.** League names, section headers,
eyebrows, wordmarks, chip labels, TV-board labels, the draft board's "You" marker — the 2026-08-24
UX remediation audit inventoried 43 sites (plus 7 `.toUpperCase()` data transforms, a separate
category, below); v3 removed every styled one.

**The allowlist is exactly two files, and it is data, not prose:** `position-badge.tsx` (a "QB"
sticker label) and `crest.tsx` (a two-letter crest tile like "BB"). These are semantically
capitals — acronym and initials *data* — not styled shouting, which is why the charter treats
them differently from `.toUpperCase()` elsewhere (initials fallbacks, crest-letter derivations):
a data transform that happens to produce capital letters is not the same claim as a CSS rule that
shouts prose, and the sweep below has no opinion about the former.

**Enforced by `src/design/no-uppercase.source.test.ts`**, built on the same `sourceFilesIn`
walker (`src/design/test-support.ts`) the hex sweep uses, over the identical seven directories.
It fails on the literal, case-sensitive string `uppercase` inside any swept `.tsx` file except
the two allowlisted ones — a second test in the same file asserts the allowlist entries still
exist and still carry the class, so an exemption that stops earning itself fails loudly instead
of rotting. `.toUpperCase()` never matches (the sweep is case-sensitive, by design — S6);
comments are **not** stripped here, unlike the hex sweep, because the charter bans one word and a
comment keeping that word alive is one paste away from a `className`.

**`EYEBROW`** (`src/components/ui/config.ts`) is the section-label register the sweep leaves
behind: `font-mono text-xs tracking-wide` — sentence case, mono, quiet. Every hand-rolled eyebrow
spelling that used to diverge (the admin queue, held-trade detail, resolution-form, the card's
fact labels, the step numerals) now routes through this one class constant; a caller supplies
its own color.

### Pill discipline and one ink action per view (rule 5)

**Two pill shapes, one primitive family, no third spelling.** `Button`
(`src/components/ui/button.tsx`) and its anchor form `ButtonLink`
(`src/components/ui/button-link.tsx`) share one class map, `buttonClassName(variant, size,
className)` — the single source of truth for what a button looks like, so the two elements can
never drift.

- **`primary` is the ink pill:** `rounded-pill bg-text-primary text-surface hover:opacity-90` —
  ink on ground, which is why v3 needed no new color role (self-ruling S2): the pill *is* the
  text color inverted. Hover is `opacity-90`, not a brightness shift — blending toward the ground
  reads at the same perceptual strength in both themes, where a brightness shift is asymmetric
  (Task 4 review finding, controller-ruled fix).
- **`secondary` is the quiet pill:** `rounded-pill border border-edge bg-transparent
  text-text-primary` — `edge`, not `line`, because a control boundary must clear 3:1.
- **`destructive`** keeps `bg-negative text-negative-text` and joins the pill radius family.
- **`ghost`** is unchanged, `rounded-md`.

**The one-ink-per-view law:** every view gets exactly one solid (ink) action; every other action
in that view is a quiet pill. This is a per-view *count*, which a source sweep structurally
cannot see (a sweep walks files, not rendered views) — so the law is enforced two ways:

1. **The spellings are banned outside their two homes**, by
   `src/design/accent-budget.source.test.ts`: `bg-text-primary` (the ink pill's own fill) may
   only appear in `button.tsx`/`button-link.tsx`, and `bg-accent` (a fill, not a text/ring/glow
   use) may only appear in the five sanctioned data primitives where green fills something that
   *means* money — `meter.tsx`, `seat-meter.tsx`, `celebration.tsx`, `avatar.tsx`,
   `budget-table.tsx`'s own-row tint. This is what makes hand-rolling a second ink pill or a
   thirteenth `bg-accent` CTA a compile-time-adjacent failure rather than a review-time guess —
   the eleven hand-rolled CTA class strings the audit found (E8) are gone by construction, not
   by diligence.
2. **The count itself is component-test-and-review-enforced.** Where a list owns the decision —
   `OpenLeagueShelf` picks exactly one `featuredLeagueId` across its whole merged list (nearest
   scheduled draft, else fewest seats remaining) and a component test asserts "at most one ink
   pill per rendered list" directly — the assertion lives with the component. Everywhere else
   (a page with one CTA, an error screen, a signed-in surface with one clearly primary action)
   it is review-enforced against this rule, the same way the persona checkpoint (Task 12) walks
   the rebuilt public surfaces against the founder's bar.

**Named single-ink surfaces, review-ruled (self-rulings applied):** the front door's nav "Take a
seat" is the front door's one ink pill, "Sign in" a quiet text link (E11); the locker room's one
ink action is the attention queue's top item — the surface's genuinely most urgent act (S10),
routed through `buttonClassName` so it can never drift into a hand-rolled fill; `league-board.tsx`'s
per-row fills became quiet pills, with only a needs-you row keeping the fill (E12); error/404
pages keep their single CTA as ink.

### The wire's honesty contract (rule 6)

`Wire` (`src/league-room/components/wire.tsx`), fed by `listWireItems`
(`src/league-service/wire.ts`), is the Sunday Standard's signature element — a ticker of real
product events under the public nav on `/` and `/browse` (signed out). Three commitments, each a
deliberate deviation from or extension of the mock, recorded so the next surface that wants a
ticker does not have to re-derive them:

- **Request-time truth, coarse timestamps, no anonymous SSE (deferral D4 stands).** Both
  consuming pages are `force-dynamic`; `listWireItems` runs once per render against that render's
  one clock instant. The scrolling is CSS (`animate-wire`), never a socket. This is the same
  honesty `seatCountsAsOfSentence` already words for the shelf's seat counts, applied to a second
  surface — a coarse "5 minutes ago" (via `formatCoarseDuration`) is what keeps a request-time
  sentence true for the whole life of a cached page, where a literal clock time would not be.
- **Real-or-nothing, never padded.** `listWireItems` returns `[]` when a source is quiet — no
  fabricated item, no placeholder row, ever ("no mock data on a real surface"). The component
  itself renders `null` entirely below `UI_CONFIG.wire.minItems` (3): a quiet product shows a
  clean hairline, never filler. The four sources are all reads already in the product
  (`audit_events` `member_joined` rows for `seat_claimed`; public leagues at capacity for
  `league_filled`; `'scheduled'` kickoffs inside the window for `draft_tonight`; `proofStats`'s
  own floored `leaguesFilled` for `season_count`) — one `Promise.all`, capped at
  `MATCHMAKING_CONFIG.wire.maxItems`, round-robined across kinds so a burst of claims never
  crowds the season count off the ticker.
- **Actor-free (S9, privacy self-ruling).** The mock's literal copy names a member ("Marcus
  claimed a seat"); this product does not put a display name on an anonymous marketing surface,
  so `seatClaimsQuery` never selects `actor_id` at all — the projection cannot leak what it never
  reads — and every sentence `Wire` renders is built from a league name, a count, or a coarse
  duration, never a person. Recorded as a deliberate deviation from the mock's literal copy, not
  from its idea.
- **The `draft_tonight` gate is CHOSEN kickoffs only** (Task 8 ruling, carried from `proof.ts`'s
  identical gate): a `when_full` league's stored `kickoff_at` is a placeholder until
  `fireWhenFullInTx` stamps it real, so the wire (and the scoreboard) only ever advertises a
  kickoff somebody actually chose (`start_trigger = 'scheduled'`) or the fill trigger actually
  set (`fill_fired_at IS NOT NULL`) — advertising the placeholder as a real time would be exactly
  the dressed-up claim this rule exists to refuse.

Accessibility: the visible marquee duplicates its item list once (the `-50%` keyframe loop needs
identical halves), with the duplicate `aria-hidden`; the one accessible form is a static
`role="list"` `aria-label="Recent activity"`, never a live region, never announced twice. Reduced
motion is a real branch, not a frozen marquee: the first `minItems` items render as a static row
and nothing scrolls or duplicates — both branches are asserted in `wire.test.tsx`.

### Type

Two faces, one family (v2, Task 1: `Barlow_Condensed` removed).

| face | variable | Tailwind | for |
|---|---|---|---|
| body | `--font-geist-sans` | `font-sans` (default) | everything you read in sentences |
| display | `--font-geist-sans` | `font-display` | board headers, sticker names, the clock, page titles, team names |
| mono | `--font-geist-mono` | `font-mono` | clock digits, tabular numbers, the wire, EYEBROW labels |

`font-display` resolves to the same Geist family as `font-sans`, distinguished by
`letter-spacing`. v3 moved that tracking from −0.02em to **−0.028em, on display sizes only**
(self-ruling S3, a plain CSS rule on `.font-display` in `globals.css`) — body tracking is
untouched. **Never set the display face on a paragraph.** It is a lettering face, not a reading
face.

`font-mono` carries `font-variant-numeric: tabular-nums` on `.font-mono` itself, so a score or a
countdown digit never shifts the column beside it.

**Display weight converged from `font-bold` (700) to `font-semibold` (600) at every display call
site (self-ruling S4)** — the mock's display ramp asks for 650, and 600 is the closest loaded
Geist weight without an arbitrary value. This was not a one-task edit: Task 3 moved the caps-sweep
call sites, and Task 9 closed the last five residual `font-bold` sites the audit's own inventory
missed (`room-rail.tsx` ×2, `tv-board.tsx`, `room-dock.tsx`, `matchup-scoreboard.tsx`) as part of
resolving a review MEDIUM — **`font-bold` is now zero occurrences across
`src/components`, `src/league-room`, `src/draft-room`, `src/chat-room`, `src/account-room`,
`src/admin-room` and `src/app`**, proven by grep repo-wide rather than claimed. (`page-title.tsx`
still contains the string `font-bold`, but only inside a comment recording this history — its
rendered class is `font-semibold`.)

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
**`xs` is for letter-spaced eyebrows only, never a sentence** — the mono, sentence-case `EYEBROW`
register above, not the uppercase treatment `xs` carried before the caps charter.

Display scale (`--text-display-*`): `sm 20 · md 28 · lg 44 · xl 58` (v3 moved `xl` 64 → 58, the
mock's own display size — self-ruling S3), with `leading-display` (1.06). A display size is
never a substitute for a body size at the same px. The v3 hero adopts the responsive step E6
demanded: `text-display-md sm:text-display-xl`, so a ten-word headline no longer wraps to ten
lines at 360px.

The mock's own ramp (display 58/650/−0.028em, title 22/650, card 16.5/600, body 15/400, detail
13/400, mono for data) lands inside the existing scale within a point at every named size: title
= dense `2xl` (22px), card = dense `lg` (15px, rendered `text-lg` on the desktop-density surfaces
that use it), body = `md` (15px), detail ≈ `sm` (13.5px) — no new scale was needed, only the
`xl` display move and the weight convergence above.

### Depth

| token | Tailwind | for |
|---|---|---|
| `shadow.card` | `shadow-card` | `Card`, `Modal`, toasts — paper lifted a hair off the page |
| `shadow.sticker` | `shadow-sticker` | a filled board cell — a sticker sitting proud of the board |

Shadows are theme-independent on purpose: a shadow is cast light, and on the dark surface the `line`/`edge` roles do the separating instead — a lightened "shadow" would read as a glow.

### Other scales
- Radii: `rounded-sm|md|lg|pill`. Stickers are `rounded-sm` — a sticker is a rectangle, not a pill. The mock's 980px pill radius is the existing `radius.pill` (999) — unchanged by v3.
- Spacing and font weight are Tailwind's own default scales, used as-is — deliberately NOT
  reflected in `TOKENS`. A scale that duplicated Tailwind's defaults inside `TOKENS` generated
  CSS variables nothing consumed (`@theme inline` had no alias for them), so it looked like a
  source of truth without being one. If either scale ever needs to diverge from Tailwind's
  default, it belongs in `TOKENS` AND in `@theme inline`'s alias block at the same time.

## The row shelf (Task 13, founder-ordered — postdates the v3 plan)

Mid-phase, reviewing the merged Cluster B build, the founder ordered a structural change the
original plan did not carry: **"horizontal row elements instead of these cards - my eyes don't
know where to focus"** (2026-08-24, binding — the audit's own Direction 2, "a lobby table,"
deferred in the plan as a second IA change stacked on the palette work, was made founder-ordered
by this feedback rather than staying deferred). Task 13 shipped it as the shelf's own responsive
form, not a new page or a new information architecture:

- **`OpenLeagueShelf`** (`src/league-room/components/public-league-list.tsx`) renders its merged
  house-then-member list **twice**, gated on the `lg` breakpoint by two sibling wrappers
  (`hidden lg:block` / `lg:hidden`) rather than a responsive grid-column count: on `lg`+
  viewports, a hairline-separated stack of horizontal `LeagueRow`s under one eyebrow column
  header (`LeagueRowsHeader`); below `lg`, the `OpenLeagueCard` grid — the form a six-column row
  cannot fit into at 360px. Both renderings exist at once in the DOM; CSS decides which is
  visible, so there is no client-side layout branch to desync from a server render.
- **The row's six columns** (`LEAGUE_ROW_GRID`, `league-row.tsx`): name + live chip + stake
  badge · format line · Drafts · Entry · Seats · action. Deliberately **not** in the row, per the
  founder's six columns: the card's Roster and Playoffs ledger rows, and the beginner
  escape-hatch paragraph — the format line's "newer players only" clause and the CTA's
  accessible name still carry that fact, just not as a seventh column.
- **Guided captions never render inline in a row, regardless of the viewer's stored preference.**
  `LeagueRow` calls `FormatLine` with `helpLevel="standard"` unconditionally and has no
  `helpLevel` prop of its own — the `InfoTip` triggers inside a row stay click-only for every
  visitor. This is a row-specific override of the `helpLevel` plumbing described under "Guided
  help" below, not a repeal of it: `OpenLeagueCard` below `lg` still resolves and honors a
  signed-in member's stored `"guided"` preference.
- **One shared-logic module, both forms.** `src/league-room/components/open-league-shared.tsx` is
  the one source both `LeagueRow` and `OpenLeagueCard` consume for every derived fact: the ledger
  clock (`useOpenLeagueLive`, `ScheduledDraftValue`, `DraftTimingNotes`), the live chip
  (`LiveChip`), badge authority (`stakeBadge`, E3 — a house league's title carries its rung by
  construction, so a house row/card never shows a rung badge; a member league's stake badge
  always shows), the format line (`FormatLine`), and the CTA (`OpenLeagueCta`,
  `ctaAccessibleName`). Extracted rather than copied, so a row and a card can never disagree
  about the same league — this is the "many small files, high cohesion" principle applied to a
  UI split, not just a code-organization one.
- **One ink per rendering, across the whole merged list.** `featuredLeagueId` (nearest scheduled
  draft, else fewest seats remaining) is computed once per render over the full house-then-member
  list and threaded into both the row and the card forms; only one of the two forms is ever
  visible at a given viewport, so the view still shows exactly one ink action regardless of which
  form CSS is showing.
- **The shelf head collapsed to one line** (also founder-ordered, same feedback): the three
  stacked explainer sentences (a section header, a floating guided caption, the house promise)
  became `HOUSE_SHELF_SENTENCE`, one full-row muted sentence beneath the title, plus
  `OPEN_LEAGUE_LEGEND` — one legend line above the grid pointing at the real `InfoTip`
  affordance ("Press any ⓘ for a plain answer").

## Signed-in surfaces and the draft room: retone only

The signed-in shell, the draft room and the TV board were already structurally disciplined before
v3 (the audit's own diagnosis: "the signed-in board, draft room, and profile already mostly hold
the bar"). v3's Cluster C sweep (Tasks 9–10) applied the palette, caps and pill rules above to
every remaining surface without restructuring bands, regions or animations — `Countdown`'s
`tone: "hot"` now reads live-red by token change alone, with no component-level edit.

## Guided help

`helpLevel: HelpLevel` (`"standard" | "guided"`) is a prop the caller decides, never a component
constant (D1/E7's fix — the pre-v3 product had `CARD_HELP_LEVEL`/`BROWSE_HELP_LEVEL` constants
that forced the same three glossary sentences onto every card unconditionally). Public,
signed-out pages pass `"standard"` — the `InfoTip` definitions stay one click away, beneath the
shelf's one legend line. A signed-in `/browse` resolves the member's own stored preference via
`readPreferences` (`@/identity-service/preferences`), so guided remains a signed-in preference
behavior a guided-preference member still gets, everywhere except inside a `LeagueRow` (see "The
row shelf" above, which never honors it by design).

## Layout: shell pages, rooms, public pages, and prose

Four shapes. A surface is exactly one of them — never a blend. (Unchanged by v3; carried from v2
verbatim.)

**A `(shell)` page is full-bleed.** `AppShell` (`src/components/app-shell/app-shell.tsx`),
rendered once by `src/app/app/(shell)/layout.tsx`, supplies the one `<main>` every page in that
route group renders into: a `px` gutter from the spacing scale, normal page scroll, and **no
`max-w-*` at all** — the founder's brief in one deletion. A page drops its own chrome and its
own container entirely; it returns its content alone. v3 extended this rule to the front door's
own shelf band (E2/W1) — the front door's two `max-w-6xl` sections are gone, full-width now.

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
these three render their own plain header (`PublicBar`) — never `AppShell`. `/browse` and
`/reviews` sit outside `/app` entirely, so when there IS a user they call `shellData` and render
`AppShell` themselves, the same function `(shell)/layout.tsx` calls, never a second bespoke read.

**Long-form reading is full-bleed frames, measured paragraphs.** A `(shell)` page's `<main>`
has no `max-w-*`, but a 2000px line of body text is not density — it is a defect. A surface
whose job is prose (the review feed, the glossary, a legal page) keeps a `max-w-prose` on its
own paragraph column only, never on the frame around it. The frame is always full-bleed; only
the words a person reads line-by-line ever get measured. **The measured-paragraph pages**, the
complete list: `/league-rules`, `/support`, `/legal/terms`, `/legal/privacy` (each a
`max-w-3xl` prose column — reading pages, the carve-out from the full-width rule), a review's
own body on `/reviews` (`max-w-prose` on the paragraph, never the feed frame — E9's fix contains
the whole review row, "Report" right-aligned inside it), and the review section of
`/app/profile`. `/league-rules` also dropped its seven inline `InfoTip` triggers (E10) —
a reading page reads; a term links to the glossary section on the same page instead. Everything
else is full-bleed.

## Signed-out chrome and the sign-in entry

- **`PublicBar`** (`src/components/app-shell/public-bar.tsx`) — the one signed-out header:
  wordmark → `/`, optional `nav?`/`action?` props, and a `SignInLink` carrying the page's own
  `intent`. The wordmark is sentence case ("Commish") as of the caps charter — it read
  "COMMISH" before. Rendered unconditionally by `error.tsx`, `not-found.tsx` and
  `global-error.tsx` too (a client boundary cannot know the session).
- **`PublicFooter`** (`public-footer.tsx`) — the four trust links (Terms · Privacy · Support ·
  League rules) on every public surface; its own test owns the every-target-resolves assertion.
- **`SignInLink`** (`sign-in-link.tsx`) — THE one way any surface renders "sign in"; takes
  `intent: string | null` and spells `/sign-in?returnTo=…`. See `docs/conventions.md`'s intent
  rule and `docs/decisions/auth-front-door.md`.
- **`SessionNotice`** (`session-notice.tsx`) — placed by chrome, never by page: `TopBar` under
  `AppShell`, `RoomRail` (`variant="room"`, a borderless pill beside `ConnectionBanner`),
  `PublicBar` never. Quiet strip for a failed background read, `Modal` for a failed write.

## Loading

The loading strategy is **four `loading.tsx` files, one per chrome, and no per-page skeleton**:

- `src/app/loading.tsx` → `AppShellSkeleton shape="public"` (front door, `/browse`, `/reviews`,
  the hold interstitial — everything above `/app`).
- `src/app/app/(shell)/loading.tsx` → `shape="content"` — suspends **only the content column**;
  the route-group layout keeps the real rail and top bar painted through every navigation.
- `src/app/app/(room)/drafts/[draftId]/loading.tsx` → `shape="room"` — the room's own bands;
  a room renders no shell.
- `src/app/app/(public)/join/[code]/loading.tsx` → `shape="public"` — the invite landing
  is signed-out reachable and must not be promised a rail.

**`AppShellSkeleton`** (`src/components/app-shell/app-shell-skeleton.tsx`) is the one component
behind all four: three `shape`s, announces exactly "Loading" (`aria-live="polite"`,
`aria-busy`), every visual rectangle `aria-hidden`. Its geometry is deliberately approximate —
per-page skeleton mimics are refused: a second copy of every page's layout, maintained by
nobody.

Three rules any future room follows:

1. **Bands are fixed height, regions are flexible.** A band whose height depends on its
   contents will move the thing the user is watching. Rail `lg:h-20`, dock `lg:h-24`.
2. **Full-bleed means full-bleed.** The route's `page.tsx` drops the container, and the room
   supplies its own `<h1>`. A room inside a centered container is a page wearing a costume.
3. **Below `lg`, linearize — never shrink.** Re-sequence the same regions into one scrolling
   column with `order-*` utilities. Rendering a second, narrow copy of a region is only
   justified when the two are genuinely different objects (`DraftBoard`'s grid and its
   per-round list are, and the inactive one is `display: none` so nothing is announced twice;
   the row shelf's row/card split above follows the identical pattern).

`RoomLayout`'s regions are rail, pool, stage, dock and an optional **aside** — the social band
down the right edge (league chat). It follows rule 1 (fixed width, scrolls inside itself) and
rule 3 (linearizes last on a phone, never shrinks), and it is optional because the TV board is
the same frame with nobody to talk to.

Widths come from the spacing scale (`lg:w-88` = 352px for the pool rail), never an arbitrary
value — `w-88` is Tailwind v4's on-demand spacing utility, not a bracket escape hatch. The pool
declares its own `lg:w-88` directly on `RoomLayout`'s frame; the aside's open/collapsed width
lives on its CONTENT instead (`lg:w-88` open, `lg:w-12` collapsed) so the frame never has to know
chat exists — but the frame still caps the band itself at `lg:max-w-88`, the same ceiling the
pool carries, so a wider descendant can never push the band (and the stage it starves) past the
viewport (founder live defect #2).

## Stacking
No z-index scale yet — three sanctioned layers exist by convention: a sticky board header/gutter is `z-10` (inside its own scroll container), the toast region is `z-40`, and `Modal` is `z-50` (always above toasts). Any new overlay must pick a value against these, not invent an unrelated one. (`DraftBoard` briefly had a `z-20` decorative edge-fade over the board's scroll edges; it painted unconditionally, tinting the last visible column's own sticker colors — founder live defect #2 — and was removed outright rather than made conditional, since the grid's native scrollbar is already the scroll affordance every other horizontally-scrolling surface in this app relies on.)

## Theming
`<ThemeProvider>` (in `layout.tsx`) manages `system | light | dark`, persisted, stamping `data-theme` on `<html>`. Default is system.

## Primitives (`src/components/ui`)
`Button` (variants primary/secondary/destructive/ghost — v3, Task 4: `primary` is the ink pill, `secondary` the quiet pill, see "Pill discipline" above; `loading` = aria-busy + disabled + spinner, label stays), **`ButtonLink`** (v3, Task 4 — the anchor form of `Button`, same `buttonClassName` source of truth; no `loading`/`disabled`, since an anchor has neither), `Input` (label required; error → `aria-invalid` + `aria-describedby`), `Textarea` (the multi-line sibling of `Input`, same `FieldShell` label/hint/error contract; an optional `maxLength` renders a live, `aria-live="polite"` remaining-character count wired into `aria-describedby` — `ReviewComposer` is the one caller today, backed by the same `validateReviewDraft` rule the server enforces, so the number on screen and the number the API accepts can never drift), `Select` (label required; native `<select>`; same error/hint contract as `Input`), `Card` (border + `shadow-card`), `Badge` (semantic tones; `glow` adds a tinted `ring-2` for a live/urgent tone, built on `accentGlow`/`warningGlow`; only `accent` and `warning` carry a glow token today), **`PositionBadge`** (`position` + `size: sm|md` — the sticker chip; the ONLY renderer of a position; one of the caps charter's two allowlisted files), **`SlotChip`** (`slot` — the bordered chip for a roster-slot letter that isn't itself a position, e.g. `FLEX`/`BENCH`), **`PageTitle`** (`size: md|xl` — the one `<h1>` treatment for a PAGE; `font-semibold`, not `font-bold`, as of Task 9; a room supplies its own `<h1>` instead, see "Layout" above), `Table` (semantic `<table>`; `caption` required — visually hidden unless `captionVisible`; `empty` node required; optional `rowAttributes` spreads plain attributes onto the `<tr>` itself, never a second wrapper element; scrolls horizontally inside its own wrapper at 360px; `density: comfortable|dense`, defaulting to `dense`, see `docs/decisions/design-v2.md` §4 for the full decision record), `Celebration` (`role="status"`; `emphasis: "self" | "peer"` picks the animation class and the accent treatment; renders with no animation class at all under reduced motion — the one primitive both `PickCelebration` and `MatchupCelebration` are built on), `Avatar` (`name` for the deterministic initials fallback, plus an `avatar` prop that is NOT a URL — it is the raw stored `AvatarRef` string (`users.avatar_url`), which `parseAvatarRef` (`@/identity/avatars.ts`) resolves into one of three renders: a preset tile — an `Icon` on one of `AvatarTone`'s five fills — for a `preset:<key>` value, an `<img>` for an `https://` URL, or the same initials fallback for anything else, including `null`, an unrecognized preset key, or a rejected scheme like `javascript:`/`data:`/`http:`; decorative unless given a `label`), `Modal` (renders nothing when closed; `role="dialog"` + `aria-modal`; focus moves in on open, cycles on Tab, returns to the opener on close; Esc closes), `ToastProvider`/`useToast` (one polite live region; `tone: "error"` toasts are also `role="alert"`; auto-dismiss after `UI_CONFIG.toast.dismissMs`, or `reducedMotionDismissMs` when the user prefers reduced motion; optional action button), `Skeleton` (aria-busy, announces "Loading…"), `EmptyState` / `ErrorState` (action required), `Icon` (curated `IconName` union; feature code never imports lucide directly), `InfoTip` (`term: TermKey`; click-to-reveal — never hover, per WCAG 2.2 1.4.13 — a real `<button>` with `aria-expanded`; the revealed `role="note"` sits in normal document flow, never a floating overlay, so it can never obscure the trigger; `helpLevel="guided"` additionally prints the glossary entry's short line inline, unhidden — the ONE way a `@/help/glossary` definition reaches the page, except inside a `LeagueRow`, which never passes `helpLevel` at all — see "The row shelf" above; `Escape` closes it while it holds focus), **`Countdown`** (`remainingMs`, `size: md|lg|xl`, `tone: default|hot` — the ticking-digits primitive, `aria-hidden`, paired with a plain-language `aria-live="polite"` sibling stating the same time coarsely via `formatCoarseRemaining`, e.g. "About 8 hours left"; display only — a countdown never decides anything, the server ticker owns clock expiry; `tone: "hot"` reads live-red by v3's token retone alone, no component change).

**Five v2 primitives (Task 3, Phase 3.6), each extracted at its own second caller rather than invented ahead of need**, joining `Badge`, `Table` and `Countdown` above as the three *existing* primitives v2 extended instead of forking:
- **`Panel`** (`title`, optional `meta`, `headingLevel: 2|3`) — the "eyebrow label, hairline, content" block, built on `Card` plus the shared `EYEBROW` class (now sentence-case mono, see "The caps charter" above). Two callers today (`seat-hold-panel.tsx`, `invite-panel.tsx`).
- **`Crest`** (`id`, `label`, `size?`) — a league's (or team's) two-letter tile, toned by `crestTone` (a re-export of `avatarTone`, so a league's crest and its members' avatars are drawn from one deterministic palette). The other of the caps charter's two allowlisted files (the letters are data, not shouting). Five callers today.
- **`SeatMeter`** (`filled`, `total`, `heldSeats?`, `srOnlySentence?`) — THE seat sentence for the whole product (F17): "9 of 12 seated", gaining a low-seats clause and a held-seats clause as each becomes true, composed rather than concatenated so a screen reader takes one pause, not several — **unchanged by v3, verbatim**. What changed is the visual bar beside it: v3 (Task 5) redesigned it from dots to the mock's segment bar — `total` equal flex segments, `filled` of them `bg-accent` (money = seats filling, rule 1), the rest `bg-surface-inset`, still `aria-hidden` beside the same sentence. `srOnlySentence` (Task 13) lets `LeagueRow` print its own visible tabular "{n} of {t} open" value while the one product seat sentence still speaks to assistive tech underneath it. Nine-plus callers, including `OpenLeagueCard`, `LeagueRow` and `WaitingRoom`.
- **`Meter`** (`label`, `value`, `max`) — a labeled fill bar that cannot be constructed without its own number beside it. Two callers today (`home-board.tsx`, `league-board.tsx`, both a matchup margin).
- **`StatPill`** (`label`, `tone?`, `glow?`) — a `Badge`, for the state-chip vocabulary (Live / Final / Fix lineup). v3 (Task 3) dropped its forced `uppercase` — the chips now read sentence case, the caps charter applied to a primitive that used to force the transform itself.

Two free-standing exports beside `Countdown` itself: `useCountdown(deadlineAt)` (the ticking hook — `UI_CONFIG.countdown.tickMs`, slowed to `reducedMotionTickMs` under reduced motion) and `formatCoarseDuration`/`formatCoarseRemaining` (the "5 minutes" / "About 2 hours left" building blocks a caller with its own sentence to build — `WaitingRoom`'s "Starts in …" and the wire's own item sentences both reuse this directly rather than writing a second minute/hour formatter).

Tunables for primitives live in `src/components/ui/config.ts` (`UI_CONFIG`, `EYEBROW`) — never inline in a component. v3 additions: `UI_CONFIG.frontDoor.shelfCap` (6 — how many member leagues the front door shows before handing off to `/browse`), `UI_CONFIG.openLeagueCard.clockWithinMs` (6h — the window inside which the Drafts value ticks), `UI_CONFIG.wire.minItems` (3), and `MATCHMAKING_CONFIG.wire.windowMs`/`maxItems`/`MATCHMAKING_CONFIG.proof.nextDraftWithinMs` (24h) alongside the pre-existing `MATCHMAKING_CONFIG`.

## Motion (rule 6: only true things move)

`TOKENS.motion` — fast 120ms / base 200ms / slow 320ms / **pulse 1 600ms / wire 38 000ms** (v3
additions), easings `standard` and `emphasized`. Use motion for state changes and moments that
matter (a pick landing, a win, a real event on the wire). Never decorative loops — every animation
below is driven by something that is actually true.

Ten sanctioned animations, all declared in `globals.css` against token variables — never a
literal duration:

| class | what it does | where |
|---|---|---|
| `animate-celebrate-peer` | 8px rise + fade, `base` | `Celebration`'s panel when the moment is someone else's (`emphasis="peer"`) — a pick that isn't yours, a league-mate's matchup |
| `animate-celebrate-self` | scale 0.96 → 1.03 → 1 settle, `slow`/`emphasized` | `Celebration`'s panel when the moment is yours (`emphasis="self"`) — your own drafted pick, your matchup win, a clinched playoff spot |
| `animate-sticker-slap` | scale 1.15 → 1 with a small rotate settle, `slow`/`emphasized` | the board cell for the pick that just landed |
| `animate-spotlight` | a slow opacity breath on the accent ring | the board cell that is on the clock |
| `animate-wire` | translateX marquee, `wire` (38s), linear, infinite | the front-door/`/browse` activity ticker (`Wire`) — real events only, see "The wire's honesty contract" above |
| `animate-pulse-live` | opacity 1 → .35 → 1 breath, `pulse` (1.6s) | the live chip's dot (`LiveChip`, `open-league-shared.tsx`) — rendered only while something on that league is genuinely live |
| `animate-rise` | opacity + 14px rise, `base`; `rise-1..4` stagger by 1–4× `fast` | the front-door hero's entrance (`.floodlight`/`.yard-lines` wrapper, Task 7) |

**One `Celebration` primitive, two callers.** `PickCelebration` (the draft room) and `MatchupCelebration` (the league room) are the same moment — "something worth announcing just happened" — said with different words. Both are built on `Celebration` + `useTransientVisibility` (`src/design/use-transient-visibility.ts`, keyed so a redelivered event never re-animates) rather than each rolling its own timer and markup. The board's sticker slap is a separate animation on the grid cell, independent of the panel's own self/peer treatment.

Reduced motion is honored twice over:
1. **Globally**, in `globals.css`: a `prefers-reduced-motion: reduce` block collapses every animation and transition to 0.01ms. This is the safety net — it applies to code that has never heard of the preference. It is what turns the wire's infinite marquee into a static, non-scrolling list for free.
2. **Deliberately**, via `usePrefersReducedMotion()` (`src/design/use-reduced-motion.ts`) whenever "less motion" should mean *different behavior*, not merely a faster animation: the landing sticker simply appears (no slap), the on-the-clock cell keeps a **static** accent ring instead of breathing, `Celebration`'s panel renders with no animation class at all (but still appears, and is still announced via `role="status"`), toasts dwell twice as long, the live chip's dot stops pulsing but the chip itself still shows, and the wire renders its first `minItems` items as a static row rather than a frozen mid-scroll marquee. Any component whose reduced-motion behavior is a real branch must have a test that asserts both branches.

## Copy

Plain language, active voice, specific. Errors say what happened and what to do next. No raw
exception/DB text ever reaches a user. Five surfaces phrasing one promise five ways is a
design-system failure, not a writing one — the rules below exist so nobody has to re-derive a
sentence this product already decided on. **Unchanged by v3** — the caps and pill rules govern
typography and layout, never the words themselves.

**The register is expanded: no contractions** (C1, ruled). "You do not have to wait here," never
"You don't." This product tells people things about money, seats and fairness, and the expanded
register is what keeps those sentences from reading as chat. **One named exception**: the
just-seated heading, `` `${leagueName} · You're in` `` (`waiting-room.tsx`, D1) — recorded as a
decision somebody made once, not a precedent the next writer generalizes from.

**The safety net is named once: "the room picks for you from your queue"** (C3). Every surface
that reassures a member about missing a draft quotes that exact phrase (`waiting-room.tsx`,
`src/help/glossary.ts`, `room-tour.tsx` — Phase 4.5, Task 9, whose first-ever rendered sweep
caught the tour's own pre-existing "autopick" wording, unswept since before that phase); no
surface invents "autopick," "auto-draft," or "we will draft for you."

**The when-full promise and every start-timing sentence are `describeStartTiming`'s** (F9), not
prose composed at the call site — `src/matchmaking/roll.ts` is the one function every surface
quotes: the browse card, the row, the waiting room, the draft-schedule panel, and the
`draft_kickoff_rolled` notice. It takes an `authority` of kind `StartTimingAuthority`
(`LeagueAuthority["kind"]`, never a hand-written second union) so the vocabulary can never drift
from the authority model itself. v3 moved its rendered color from `text-warning` to
`text-text-muted` (E5) but never touched its words.

**Two voice exemplars, quoted in full**, because a register is easier to copy than to define:

> "That seat went to someone else while you were signing in. Your spot in this league is gone,
> and nothing was charged." — `src/matchmaking/seat-hold.ts`

> "Nothing you typed was sent." — `src/components/app-shell/session-notice.tsx`

Both say what happened, what it means for the reader, and nothing else.

**The wire is actor-free** (S9, above) — the newest addition to this register: a product-events
ticker on an anonymous surface names a league, a count, or a duration, never a person.

**A record may carry typographic weight** (D5): one step up the type scale and a heavier weight
on a board, never a color, a badge or an animation.

## Checklist for every UI step (from `docs/conventions.md`)
Design review against this doc · light + dark verified · loading/empty/error/success states exist · `axe` clean + keyboard walkthrough · copy review · works at 360px · no `uppercase` outside the two allowlisted files · at most one ink pill per view.

Component tests run in happy-dom without a stylesheet, so the "both themes + axe" checks in `*.test.tsx` verify structural a11y (roles, labels, ARIA attributes) in each theme, not actual rendered color; real color contrast is verified numerically by `src/design/tokens.test.ts` — which covers the semantic roles, the translucent-band composites, and all fifteen sticker pairs in both themes — and browser-based visual contrast checks land with the e2e plan (Task 12's contrast spot-verification).
