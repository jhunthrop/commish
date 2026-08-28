# Gameday — Commish Design System v4

**Read this before building any user-visible surface**, alongside `docs/conventions.md`. Everything here is enforced by tests where it can be, and by review where it can't. Every claim below either names the test that enforces it, or says "review-enforced."

**Status:** Gameday replaces Sunday Standard (v3) across the whole product, founder-directed 2026-08-28. The argument is `docs/design/2026-08-28-gameday-spec.md`; the approved compositions are the two applied screens in its rendered artifact. This document is the binding form.

## Identity: Gameday

Sunday Standard was built on restraint, and restraint is a magazine's value system. It produced a calm, well-set document, and the founder's verdict on it was exact: *"It feels like a legal website and not a fantasy site."*

An earlier pass tried amending it — three rules bent, five phases, every change individually defensible — and produced *"little changes here and there"* rather than a step change, because **six rules that each forbid a thing cannot be patched into a system that affords one.** So this replaces v3 rather than amending it.

**Fantasy is not calm.** Six laws govern every surface this document describes; they are the spine the rest of it hangs off. Each replaces a v3 rule and is exactly as strict — they simply forbid different things.

1. **Colour is a legend.** Six channels, each with exactly one meaning: **money**, **live**, **magnitude**, **position**, **team**, **tier**. Nothing else carries pigment. A manager should read state without reading words.
   *Replaces v3 rule 1's "colour is meaning" as scarcity, which left every screen grey and forced you to read everything.*
2. **The number is the hero.** One typeface, a **7.6x** scale range. A score is 84px; its label is 11px. Digits are tabular everywhere. If the largest thing on a screen is not a number or a name, the screen is wrong.
   *Replaces v3 rule 2's hierarchy-from-weight capped at 600, which produced a 2x range and nothing for the eye to hold. The cap itself does not move — see "The 600 cap holds" below.*
3. **A player is an object.** Face, team colour, position, number — every surface showing a player shows all four. Players, matchups and leagues are things you act on, drawn as things.
   *Replaces v3 rule 4's "hairlines, not boxes", which rendered every object as a line of text.*
4. **Density is respect.** A manager on Sunday wants more true facts per screen, not fewer. Tight leading, real tables, no decorative whitespace. Space separates kinds of information; it never exists to calm.
   *New. v3 had no density position, so every surface drifted airy by default.*
5. **The verb is obvious.** The action a screen exists for is the loudest thing on it, however many times it repeats. A draft board has a Draft on every row.
   *Replaces v3 rule 5's "one ink action per view", which hid the primary verb on exactly the screens built to repeat it.*
6. **Motion reports, never performs.** Nothing animates on mount, scroll or hover. Motion is permitted only where a real value changed, a real clock is running, or a real event arrived. Nothing eases longer than 250ms. Reduced-motion removes all of it and loses nothing.
   *Sharpens v3 rule 6's "only true things move" — which was right, never spent, and silent on the tacky failure modes.*

### The razor

**Turn every animation off. If the product feels dead, the aliveness was fake.**

Real aliveness in a sports interface comes from four things and none of them is motion: **numbers that change because the world changed**, **colour that encodes state so you read the screen without reading words**, **density of true facts**, and **the manager's own identity present on every screen**. Motion's only job is to make a change legible. It never announces itself.

### What survives from v3, unchanged

- **One typeface.** Geist only. Range comes from size, never from a second family.
- **Sentence case in prose.** Uppercase survives only in mono micro-labels, where every sports interface has always put it. See "The caps charter" below, which is unchanged in strictness and now has exactly one address.
- **Every accessibility gate.** Contrast in both themes; magnitude never carried by hue alone.
- **Both themes.** Dark is the flagship; light is **designed** to the same roles and the same thresholds, never inverted from dark by formula. `ThemeProvider` (`system | light | dark`) is untouched; only the palette each theme paints with moved. Default theme is still `system`.
- **Honesty.** No invented data, no tint without a stated population, no motion without a real event.
- **A hairline separates; an edge bounds.** `line` is decorative (<3:1, never the boundary of a control) and `edge` is interactive (≥3:1, WCAG 1.4.11).

### The 600 cap holds

Law 2 asks for range and gets it from **size only**. `weight-cap.source.test.ts` still bans `font-bold`/`font-extrabold`/`font-black` across seven directories with no allowlist, and `font-semibold` (600) is still the ceiling. A bigger number is the answer; a heavier face is not. Law 2's own gate in `tokens.test.ts` pins the two values the law names — display `2xl` at 84 and `xs` at 11 — so the 7.6x claim above cannot quietly stop being true.

## The rule concordance: v3 numbers to v4 laws

v3's six rules are cited **by number** in eighty-eight source and test files, and the numbering moved. This table is what makes those citations resolve; it is not decoration. A comment saying "rule 4" was written about hairlines-not-boxes and must not be read as law 4, which is density.

| v3 rule | v4 law | What changed |
|---|---|---|
| 1 — Colour is meaning | **1 — Colour is a legend** | Same channels, opposite posture. v3 spent colour scarcely; Gameday names six channels and requires them. The fun-pass amendments (magnitude, tier, team) are absorbed wholesale, not repealed. |
| 2 — One face, earned weights | **2 — The number is the hero** | The typeface and the 600 cap survive verbatim. The range widens from 2x to 7.6x, and it comes from size. |
| 3 — No capitals anywhere | *(not a numbered law)* | Demoted to "What survives", with one carve-out: mono micro-labels. `no-uppercase.source.test.ts` is unchanged in strictness. |
| 4 — Hairlines, not boxes | **3 — A player is an object** | Reversed. v3's amended test (*act on or compare = card; read down a column = row*) survives as the boundary, but the default flipped: an object is drawn as a thing. |
| 5 — One ink action per view | **5 — The verb is obvious** | Reversed. v3's "named exceptions" for repeated-action surfaces become the general case. See "Pill discipline" for what replaces the count. |
| 6 — Only true things move | **6 — Motion reports, never performs** | Sharpened, not replaced. v3 said what may move; law 6 also says what may never move (mount, scroll, hover) and caps the duration. |
| *(none)* | **4 — Density is respect** | New. |

**Migrating a citation is the route tracks' work, not a licence to ignore it.** Until a file is migrated, read "rule N" in a v3-era comment against the left column.

## The fun-pass amendments (2026-08-27) — absorbed into Gameday

Kept as a section because eighteen source files cite it by name, and because Gameday **absorbs** these amendments rather than repealing them. The founder's complaint that produced them — *"It feels like a legal website and not a fantasy site"* — is the same complaint Gameday answers at larger scale. The full argument is `docs/design/2026-08-27-fun-pass-spec.md`.

What the amendments added to v3's rule 1 is now simply what law 1 **is**: three of Gameday's six channels arrived here first.

- **Magnitude.** Where a number falls in a **stated** population. The tint is never permitted without one — a percentile across three quarterbacks is arithmetic dressed as a fact, which is the thing this amendment exists to forbid. `Stat` is the only component allowed to name a magnitude colour (`magnitude-budget.source.test.ts`).
  - **Where magnitude is deliberately NOT spent.** A standings record, because the table is sorted by it and position already says it. Anything on the storefront, because a shelf has no honest population to rank a league inside — colouring an empty room red would be a judgement about a league rather than a fact about one.
  - **The exclusion on a matchup's score STANDS, and the approved mock is the thing that gives way.** The mock paints the leading score in the magnitude ramp's `strong` ink, and `Scoreboard` declines to reproduce it. The population a matchup hero has to hand is "the two teams in this matchup", which is not a population but a pair: a percentile inside a set of two is fully determined by who is ahead — the leader is 1.0 and the trailer 0.0, whether the margin is 0.2 points or 60. That would paint a one-point lead in the same ink as a blowout and announce *"Top 1% of the two teams in this matchup"* to a screen reader. The percentile floors were tuned against real distributions of many players; a coin flip dressed in them is a lie with a legend attached, which is worse than a plain number. The lead is carried instead by the channels that are true — the larger figure, a "Leading" micro-label, and `data-winning`. A caller that genuinely holds a wider population ("all twelve teams this week") passes a `comparison` and the tint means something. **Honesty beats matching the mock**, which is the one place in this whole version where that trade came due.
- **Tier grade.** S/A/B bands as coloured bars, once the projection engine makes tiers real. Parked until then; this amendment already covers it, so no second ruling is needed when it lands.
  **It has landed.** `players.adp` carries a real average draft position for 476 of the 1,646 players in the pool, and a tier band is a gap between adjacent ADPs — measured, not drawn. `TOKENS.tier` is the palette this amendment already sanctioned, and `TierDivider` renders it. A grade is a fact or it is not drawn.
- **Team identity.** A team's own colour, behind a player's face only. Never on a surface, never behind text. Tokens: `TOKENS.team`, thirty-two club colours keyed by the abbreviation the stats feed emits, theme-independent (a club's colour is the club's, in daylight and at night alike). Renderer: `PlayerFace` — one decorative, `aria-hidden` tile exactly the size of the face, with the `Avatar` on top of it. It is the ONE palette here that reaches the DOM as an inline `style` rather than a CSS variable, because it is keyed by DATA and a Tailwind class the static scanner cannot see ships no rule at all; that is also why the values live in `tokens.ts`, the one file allowed to hold a colour literal. A team we have no colour for renders the bare face rather than a grey rectangle pretending to be somebody's colours.

Green still means money and red still means live. Magnitude reuses those hues deliberately — good is green because good is the same feeling as money.

**The colourblind rule, which is a gate and not a nicety.** Green versus red is the worst available pair for deuteranopia, which affects roughly one man in twelve, and this product's audience is overwhelmingly men. The reference product's heat map fails this and we do not copy the failure. **Magnitude colour is never the only channel.** Every heat-coloured value carries a second encoding: its own numeric value read plainly, and — where the value is judged rather than merely reported — a caret naming which side of the population it fell on and a weight step naming how far. A manager who sees no colour at all must still rank the column correctly. Three enforcements, at three levels:

1. `stat.test.tsx` asserts the value renders as text in every state, that each verdict step carries its caret and its weight step, and that a neutral carries neither.
2. `tokens.test.ts` orders the ramp by **contrast against the ground** rather than by hue, so the sequence survives with the hue channel switched off entirely. (Ordering by contrast is also direction-free across themes: louder is brighter at night and darker in daylight.)
3. `tokens.test.ts` also holds every step to 4.5:1 on **all four** surfaces in both themes, not the two the semantic roles are checked against — a heat-coloured number lands in a table row and an inset well as readily as on the page ground.

A heat map that fails this is worse than no heat map, because it silently misinforms one manager in twelve.

**The tier ladder's colourblind channel is the LETTER, not a caret.** Adjacent rungs are close in hue on purpose (red, amber, gold — a warmth that cools as the grade falls), which is what makes the four read as one ladder rather than four unrelated stickers. So `tokens.test.ts` does not hold tier pairs to the position stickers' pairwise-hue rule: a position sticker is a CATEGORY and must be told apart from every other, while a grade is an ORDER and always prints its own letter on it. What the gate does check is that the ladder's ends are far apart, that every badge is findable against the row it divides, and that every letter is readable on its own badge — in both themes.

**Rule 4's amended test survives law 3.** **A thing you act on or compare against its neighbours may be a card; a thing you read down a column stays a row.** What changed is the default, not the boundary: law 3 says a player, a matchup and a league are objects and are drawn as things, so the card is now where those start. Standings tables, pick logs and rosters stay hairline-separated rows, because scanning a column is what they are for. In code this is `Card`'s `interactive` prop, which spends `surfaceRaised` on `hover`/`focus-within` — depth, never a heavier line. `line` stays decorative and `edge` stays a control boundary; a card takes no `role` and no `tabindex`.

**The amendment says MAY, and a founder ruling outranks a permission.** The open-league shelf reads as horizontal rows at lg+ because the founder ordered exactly that on 2026-08-24 ("horizontal row elements instead of these cards - my eyes don't know where to focus"). Neither the amendment nor law 3 reopens it. Read a "may" as a licence to relitigate a ruling and this document stops being a record of decisions.

**Rule 5's named exceptions became law 5.** v3 held "one ink action per view" everywhere except surfaces whose entire purpose is repeated action — the draft room, and later waivers and trades. Gameday promotes the exception to the rule: the verb is obvious wherever it repeats. What survives from the narrow version is the discipline that made it safe — **the loud action belongs to ACTS only.** `snake-room.test.tsx` walks every ink pill in the rendered room and requires each one to be a Draft or a Confirm; every filter, toggle and way out stays quiet. That test is the shape of law 5's enforcement everywhere, and it is why law 5 is not "the draft room may be loud."

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

### The Gameday palette: six channels, in daylight and at night

Values live in exactly one place, `src/design/tokens.ts` (`light`/`dark`) — this doc names the
vocabulary, not a copy of the hexes, so a palette tune never leaves it stale. The dark ramp is the
approved artifact's own; light is designed to the same roles and thresholds.

| Gameday's word | role(s) | dark (flagship) | light (daylight) |
|---|---|---|---|
| page | `surface` | `#1A1A21` | `#FBFBFA` |
| surface | `surfaceElevated` | `#23252E` | `#FFFFFF` |
| raised | `surfaceRaised` | `#2C2F3A` | `#F8F8F6` |
| well | `surfaceInset` | `#1F1F27` | `#F3F3F1` |
| line | `line` | `#383C4A` | `#E8E8EA` |
| edge (re-solved, see below) | `edge` | `#70788E` | `#8B8B91` |
| ink | `textPrimary` | `#EDEEF2` | `#1A1A1E` |
| muted | `textMuted` | `#A0A5B4` | `#68686D` |
| faint (re-solved, see below) | `textFaint` | `#9196A3` | `#6D6D76` |
| money | `accent` / `positive` | `#3ECF8E` | `#0B6B43` |
| live | `negative` | `#FF6B5E` | `#C23228` |
| — (demoted usage) | `warning` | `#BA9335` | `#846315` |
| — (unnamed by the mock) | `info` | `#5F99F2` | `#4C69CD` |

**Four grounds, not the artifact's nominal five.** The mock declares a fifth step above `raised`
(`--overlay: #363A47`) and never paints it — neither approved screen contains a modal. Shipping it
costs a text role: at that luminance `textFaint` must brighten to `#9FA4AF` to clear 4.5:1, which
is **1.02:1** from `textMuted` — the two quiet inks become literally the same colour, product-wide,
to gain a ground nothing draws on. The magnitude ramp fails harder still (`bad` measures 4.11:1
there and cannot be fixed without collapsing the heat map upward into `weak`). So the fourth step
is spent on the **well**, which is the step both approved screens actually use — the matchup's
points-share track, the draft room's meters. A modal keeps `surfaceElevated`: a scrim already
separates it from the page, so it needs no brighter ground of its own.

**Two values from the mock could not ship as drawn**, and both failures are the same kind — a
static page has no controls to bound and no quiet captions to place, so nothing in it exercised
the gate. Each is re-solved along its own hue, moving only as far as the gate requires:

- `edge` — the mock's `#5A6072` measures **2.13:1** on a raised row, missing WCAG 1.4.11's 3:1
  floor for the boundary of a control a user has to find. Brightened to `#70788E` (3.03:1 on the
  binding ground).
- `textFaint` — the mock's `#767C8C` measures **3.20:1** on a raised row, below the 4.5:1 text
  floor on every ground in the ramp. Brightened to `#9196A3` (4.51:1 on the binding ground).

**The position channel reverses v3's desaturation.** v3 took these six to 60% of their semantic
parent's saturation on a 2026-08-24 ruling that a full-saturation sticker "reads as a spreadsheet".
Law 1 reverses it in one line: **a badge you have to read is not a badge.** A manager reads QB off
the colour before his eye reaches the letters, and a pigment quiet enough to be polite is a pigment
you have to read.

| position | dark sticker | light sticker |
|---|---|---|
| QB | `#F2685E` | `#E32012` |
| RB | `#35C98A` | `#23835A` |
| WR | `#4E9BF0` | `#1372DC` |
| TE | `#E0A340` | `#9C6A19` |
| K | `#B98BF5` | `#924BEF` |
| DEF (re-solved) | `#616D83` | `#535963` |

Five ship the artifact's values verbatim on its near-black ink. **DEF is re-solved because the
mock's `#6C7A93` clears no label at all** — it is a mid steel, measuring 4.20:1 under dark ink and
4.34:1 under white, so both miss the 4.5:1 floor. It darkens to `#616D83`, the first value at which
the product's own ink clears it, which also restores what DEF is for: its meaning is "no colour of
its own", and a mid steel sitting between WR's blue and nothing in particular was never that. Its
fill is too dark to double as text on a surface, so it keeps a separately brightened `text` variant.

In daylight all six walk down their own hue until white ink clears them and the pigment itself
clears 4.5:1 as text on paper. Hues land within 2° of the mock's in every case, so switching themes
shows the same six colours rather than a second palette. `def` carries one extra constraint in
daylight that it does not need at night: WR and DEF sit 6° apart in hue (both blues), so their
pairwise gate is carried by **contrast**, and `def` darkens until it is 1.5:1 from `wr`.

**The tier ladder** (`TOKENS.tier`, four grades best-first) is also keyed by data rather than by
role, but unlike `TOKENS.team` it is emitted as per-theme CSS variables and consumed as Tailwind
classes. The difference is not the one it looks like: a team code arrives at RUNTIME off the stats
feed and is unbounded, so a class for it is one the static scanner cannot see and therefore ships
no rule at all; a grade is one of four literals, so a component writes all four class names out and
Tailwind sees every one. That is a requirement, not a convenience — an inline style would have to
choose between the two designed palettes in React, and nothing rendering a band can read the
resolved theme, so it would have shipped dark's bright pigments onto the light theme's near-white
ground. Dark carries the mock's values verbatim (`S #FF7A6E`, `A #F5A248`,
`B #E8CF5A`, `C #6FA8DC`) on near-black ink; light re-derives the same four hues dark enough to be
findable, with white ink. A grade badge has two jobs and the gate checks both: the letter is
readable ON the badge (4.5:1) and the badge is findable AGAINST the row it divides (3:1).

**Money is a fill only when it is money or an action; live is text/glow/chip, never a solid block
outside its own destructive button.** The doubling rules carry forward exactly: `accent`/`positive`
share a hex because a live game and a live action are the same energy; `negative` is the whole
"live" family (a draft clock tightening, a live chip's dot, a destructive button) for the identical
reason — one hue, jobs separated by context, never two solid fills of the same colour in one view
meaning two different things.

Law 1 adds the one clause that makes the `verb` button legal: **money is also the fill of the verb,
because pressing it is how money moves.** That is a widening of "an action", not a new channel.

**`warning`/`info` survive, retuned and demoted (self-ruling S1).** The role set does not shrink —
Gameday retones values and, for `warning`, demotes *usage*: amber is reserved for a clock that is
actually tightening rather than every neutral scheduling fact on a shelf.

**Composite bands.** A role can clear 4.5:1 against a plain surface and still miss it once a
translucent 10% wash of a semantic hue is mixed into that same ground. `tokens.test.ts`'s
`"TOKENS.color bands"` block checks every text role against its own translucent band composited
over each surface, in both themes — the gate that caught `light.textMuted`, `light.negative` and
`light.warning` under the draft room's "hot" rail tint.

### One pigment, two (or three) jobs

The position palette is **six pigments**. Values live in exactly one place, `src/design/tokens.ts`
(`lightPositions`/`darkPositions`) — this doc names the roles, not the hexes, so a palette tune
never leaves it stale.

`accent` and `positive` remain a true doubling: the exact same hex, deliberately (see above) —
the product's identity is that a live game and a live action are the same energy. v3 extends the
doubling logic to `negative` (see above): one red, two jobs, separated by context rather than by
hue.

**GAMEDAY REVERSES v3's DESATURATION, and the reversal is law 1.** From 2026-08-24 until now the
six position pigments carried an indirection — a `Pigments` record (`whistle`/`leaf`/`marker`/
`clay`/`grape`/`slate`) holding each hue at 60% of the saturation of a semantic role it used to
double, on a ruling that a full-saturation sticker "reads as a spreadsheet, not a board".

Law 1 answers that in one line: **a badge you have to read is not a badge.** The whole point of a
position sticker is that a manager reads QB off the colour before his eye reaches the letters, and
a pigment quiet enough to be polite is a pigment you have to read. The stickers are now the
approved artifact's own saturated values, listed in "The Gameday palette" above.

The `Pigments` indirection is **gone**, not merely retuned. It existed to express "60% of the
saturation of `negative`", and with the derivation retired the layer was a name for a relationship
that no longer holds — `darkPositions`/`lightPositions` now hold their own values directly. Any
comment in the repo still naming `whistle`, `leaf`, `marker`, `clay`, `grape` or `slate` is
describing a structure that no longer exists.

**What survives from the old ruling is the safety argument, and it survives intact:** a position
colour and a semantic colour never share a context. A position colour appears exclusively inside a
`PositionBadge`, a `Sticker` or a draft-board cell; a semantic colour never appears inside any of
them. That is why QB may be a red neighbouring `negative`, and RB a green neighbouring `accent`,
without either being mistakable for the other — the same contextual separation that has always
made `accent`/`positive` safe as one hex.

`tokens.test.ts`'s pairwise sticker matrix (`"TOKENS.position"`) is the gate the saturated set is
proven against, in both themes: every one of the fifteen pairs clears 1.5:1 contrast or 30° of hue
separation, every sticker's own label clears 4.5:1 on it, and every pigment clears 4.5:1 used as
text on a surface.

### Color roles

Values live in `src/design/tokens.ts` (`light`/`dark` palettes) — read them there, not here;
this table is the meaning of each role, which is the part a doc can keep true across a palette
tune. The role set (`COLOR_ROLES`) is frozen; Gameday retones every value and adds no role.

**The role NAMES predate Gameday and its ramp words map onto them.** Gameday says page / surface /
raised; the tokens say `surface` / `surfaceElevated` / `surfaceRaised`. The names were not renamed
because `bg-surface-elevated` alone appears in forty-three route files owned by other tracks, and a
rename would deliver forty-three conflicting diffs and zero visual change. Read the first column as
the ramp:

| role | Gameday's word | used for |
|---|---|---|
| `surface` | page | the page — the ground |
| `surfaceElevated` | surface | a card, a row, a panel |
| `surfaceRaised` | raised | a row hover, a field, a nested tile, a meter track |
| `surfaceInset` | well | a track, a slot well, an unfilled meter, the wire's own band |
| `line` | line | the decorative hairline between two surfaces (<3:1 vs `surface` — NOT a control boundary) |
| `edge` | edge | the boundary of a control a user must find (≥3:1 vs every surface) |
| `textPrimary` | ink | primary text — also the ink pill's own fill (`bg-text-primary`, see "Pill discipline") |
| `textMuted` | muted | secondary text |
| `textFaint` | faint | tertiary text — card meta, step captions, table subs |
| `accent` | money | **money**: interactive links, focus rings, seat-meter fill. **Same hex as `positive`** |
| `accentText` | money | the label ON a money fill |
| `accentGlow` | money | a translucent money tint — the front door's floodlight, a highlighted row |
| `positive` | money | good outcome, as text/glow/meter fill only — **never a solid button fill** (see "One pigment, two jobs") |
| `negative` | live | **live**: a draft clock tightening, a live chip's dot, destructive actions — one red family, jobs separated by context |
| `negativeText` | live | the label ON a live/destructive fill |
| `warning` | — | caution, demoted usage in v3 (E5) — reserved for a clock genuinely tightening, never a neutral scheduling sentence |
| `warningGlow` | — | a translucent warning tint |
| `info` | — | informational — neutral notices, the WR sticker's semantic pairing |
| `scrim` | — | modal backdrop (used at `bg-scrim/50`) |

Tailwind aliases: `bg-surface`, `bg-surface-elevated`, `bg-surface-raised`, `bg-surface-inset`, `border-line`, `border-edge`, `text-text-primary`, `text-text-muted`, `text-text-faint`, `bg-accent text-accent-text`, `text-accent`, `bg-accent-glow`, `text-positive` / `text-negative` / `text-warning` / `text-info`, `bg-warning-glow`, `bg-scrim`.

**Semantic-on-fill:** when a semantic color is used as a fill (`bg-negative`), pair it with its `-text` role (`text-negative-text`) for the label — never a raw white or black.

### The caps charter: no capitals in prose (v3 rule 3, kept)

**Every `text-transform: uppercase` is gone from the product.** League names, section headers,
eyebrows, wordmarks, chip labels, TV-board labels, the draft board's "You" marker — the 2026-08-24
UX remediation audit inventoried 43 sites (plus 7 `.toUpperCase()` data transforms, a separate
category, below); v3 removed every styled one.

**GAMEDAY'S ONE CARVE-OUT.** "What survives from v3" reads: *"Sentence case in prose. Uppercase
survives only in mono micro-labels, where every sports interface has always put it."* That is the
approved mock's `.lbl` — 11px Geist Mono, 0.11em tracking, faint ink — on the things a scoreboard
has always shouted quietly: a column header, a slot name, `248 LEFT`, `Q3`, the eyebrow over a
stat block.

**The sweep does not relax; the carve-out has exactly one address.** No `.tsx` may spell the class,
as before. The sanctioned register is `MICRO_LABEL` in `src/components/ui/config.ts` — a `.ts`
module the sweep does not walk because it renders nothing. A component that wants shouted capitals
imports the constant; a component that hand-rolls the class still fails. The charter's real target
was forty-three treatments drifting apart from one another, and routing every one of them through
a single constant is the opposite of that rather than a hole in it. `no-uppercase.source.test.ts`
pins `MICRO_LABEL`'s existence and its spelling, so the carve-out cannot rot into "uppercase is
fine again" by the constant being deleted or quietly de-capitalised.

`MICRO_LABEL` is distinct from `EYEBROW` on purpose: an eyebrow is a **sentence-case label above a
block**, a micro-label is a **shouted key beside data**. Both are mono and small; only one is
capitals, and collapsing them would put capitals back on the prose labels the charter cleared.

**The data allowlist is still exactly two files, and it is data, not prose:** `position-badge.tsx`
(a "QB" sticker label) and `crest.tsx` (a two-letter crest tile like "BB"). These are semantically
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

### Pill discipline and the obvious verb (law 5)

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
- **`verb` is the repeated action (Gameday, law 5):** `rounded-md bg-accent text-accent-text
  hover:opacity-90`. Money-filled, because law 1 says money is *"also the fill of the verb, because
  pressing it is how money moves"*; `rounded-md` rather than a pill, because shape is what keeps it
  from reading as a second `primary`. **`primary` is ceremonial — one per view, the thing a page
  exists to do once** (create the league, confirm the trade). **`verb` is the thing a board does
  forty times** (Draft, Claim, Accept). A board of forty rows cannot spend its one ink pill on row
  one and leave thirty-nine quiet outlines behind it, which is precisely how v3's rule 5 hid the
  primary verb on the screens built to repeat it.
  `button.tsx` is on `accent-budget.source.test.ts`'s fill allowlist for exactly this variant: green
  fills one control primitive, and a call site that hand-rolls the class still fails the sweep —
  which was always the real failure mode (E8 was eleven copies of one CTA class string drifting
  apart, not one primitive owning it).
- **`destructive`** keeps `bg-negative text-negative-text` and joins the pill radius family.
- **`ghost`** is unchanged, `rounded-md`.

**What replaces the count.** v3 enforced "at most one ink action per view" on every audited route
(`e2e/page-audit.spec.ts`). Law 5 removes the count and keeps the discipline that made it safe:
**the loud action belongs to ACTS only.** A filter, a toggle, a sort control and a way out are
quiet on every surface, however loud the verb beside them is. `snake-room.test.tsx` is the shape of
that enforcement — it walks every loud action in the rendered room and requires each one to be a
Draft or a Confirm.

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

### The room wire and the composed TV surface (the 2026-08-26 composition pass)

The draft room carries the wire's second life: `PickWire` (`src/draft-room/components/pick-wire.tsx`)
renders the last six REAL picks as one fixed-height mono line under the rail (room, `text-xs`) and
between the TV spotlight and the board (`text-base`) — newest first, only the newest player name in
ink, no animation (the celebration owns the landing moment; the wire whispers history). The band's
`h-8` slot is always reserved: inside the room frame, the nothing-reflows law beats the
nothing-to-say law (the D2 precedent), so an empty pre-first-pick band is an empty band, never a
layout shift. The TV board is composed as a TV surface: the spotlight band owns the party's ONE
clock (`spotlightClockTone` — time-hot inside the final 30s, rule 1: a clock in its final seconds
is red for everyone), the rail prints no in-progress countdown of its own, and rounds beyond
active+2 collapse to one sticky-pinned "N rounds ahead" line. Reveal-on-intent is the pass's
quieting idiom, documented in full in `ReactionBar`'s docblock: controls that are offers (unused
reaction prompts, queue chip reorder/remove, Report) gate on `@media(hover:hover)` and reveal on
their row's hover/focus — touch keeps everything always-on, landed counts are information and
never hide, and everything stays in the DOM at full accessible name. The tour is anchored coach
marks by default (`CoachMarks`), degrading to the untouched modal under reduced motion or wherever
an anchor target does not exist; the whole anchored decision resolves in ONE pre-paint layout
effect so no audience ever sees the wrong presentation flash first. Board tallies (review R4) were
adjudicated and REFUSED: the position color field already tells the draft's story, and 48 mono
digits at 12-team density read as texture, not information.

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
  clean hairline, never filler. The three sources are all reads already in the product
  (`audit_events` `member_joined` rows for `seat_claimed`; public leagues at capacity for
  `league_filled`; `proofStats`'s own floored `leaguesFilled` for `season_count`) — one
  `Promise.all`, capped at `MATCHMAKING_CONFIG.wire.maxItems`, round-robined across kinds so a
  burst of claims never crowds the season count off the ticker.
- **Actor-free (S9, privacy self-ruling).** The mock's literal copy names a member ("Marcus
  claimed a seat"); this product does not put a display name on an anonymous marketing surface,
  so `seatClaimsQuery` never selects `actor_id` at all — the projection cannot leak what it never
  reads — and every sentence `Wire` renders is built from a league name, a count, or a coarse
  duration, never a person. Recorded as a deliberate deviation from the mock's literal copy, not
  from its idea.
- **`draft_tonight` is RETIRED (storefront review R1, 2026-08-27).** The kind used to gate on a
  CHOSEN kickoff — `start_trigger = 'scheduled'`, or the fill trigger's own `fill_fired_at`
  stamp — but every `HOUSE_CATALOG` rung is `when_full` now (`docs/decisions/formats-and-lobby.md`,
  "The whole shelf is sit-and-go"), so a sit-and-go room has no chosen kickoff left to announce
  and the source starved by construction. `seat_claimed` (already tinted live the instant a claim
  leaves a room urgently short of seats) and `league_filled` tell this world's own "filling"
  story honestly; no replacement kind was added. `proof.ts`'s own scoreboard chip was repointed
  the same way, onto `roomsFillingQuery`/`tightestRoomQuery` — see that module for the fill-based
  facts that replaced the scheduled-kickoff ones.

Accessibility: the visible marquee duplicates its item list once (the `-50%` keyframe loop needs
identical halves), with the duplicate `aria-hidden`; the one accessible form is a static
`role="list"` `aria-label="Recent activity"`, never a live region, never announced twice. Reduced
motion is a real branch, not a frozen marquee: the first `minItems` items render as a static row
and nothing scrolls or duplicates — both branches are asserted in `wire.test.tsx`.

### The practice wire — a second surface honoring the same contract (R3)

`MockWire` (`src/league-room/components/mock-wire.tsx`), fed by `listMockWireItems`
(`src/mock-draft-service/wire.ts`), is the mock lobby's own signed-in sibling of the wire above —
the lobby design review's R3 finding ("no wire, no density, no live event... the one move that
turns an empty lobby from a dead form into a place"). It honors the same three commitments
(request-time truth, real-or-nothing, actor-free) but is a deliberate SIBLING component, never an
extension of `WireItem`, for a reason worth recording so the next ticker on this product does not
re-litigate it:

- **A separate type, not a bigger union.** `WireItem` already names a specific real-league,
  signed-out disclosure surface (`ENFORCED_LEAGUE_SQL`'s public-only join); a mock room's own
  vocabulary — no money, no seats, no league name at all — has nothing to do with that contract,
  and folding it in would make `Wire`'s `toneOf`/`sentenceOf` responsible for a lane they never
  render. `MockWireItem` (two kinds: `mock_filled`, `mocks_running`) lives beside its own reader
  in `src/mock-draft-service/wire.ts`.
- **The presentational shell IS shared, verbatim.** `Ink`, `TONE_CLASS` and
  `WIRE_BAND_CLASSNAME` are exported from `./wire` and imported by `./mock-wire` unchanged — DRY
  on the visuals, separate on the words, rather than two copies of the same three lines of
  Tailwind and the same money/live color pair.
- **No scroll, ever (RULED).** The front door's `animate-wire` marquee serves an anonymous public
  nav; a signed-in practice lobby is not a broadcast. `MockWire` renders ONE static, truncating
  line, newest-first, with no `animate-wire` track and no duplicated accessible list.
- **Real-or-nothing at one item, not `UI_CONFIG.wire.minItems` (3).** The front door's floor of
  three exists because a two-item non-scrolling row would read as "barely anything happened"; a
  static single line has no such tell, so `MockWire` renders as soon as there is exactly one true
  fact to say, never holding back a genuinely live count to wait for company.
- **`mocks_running` leads.** It carries no age — always current by construction — so it sits
  first regardless of how recent the newest `mock_filled` item is; only the newest `mock_filled`
  item carries `Ink`, since a static always-visible line has no scroll to hide the other items'
  plainness behind.
- **A third item, `seat_taken`, was in the original vocabulary and was never built.** A claim on
  a mock room writes no audit event (ruling 2's carve-out) and `teams` carries no claim
  timestamp for any league, mock or real — there is no honest, cheap read that answers "was a
  seat taken here in the last 10 minutes." Real-or-nothing forbids inventing one. `MockWireItem`'s
  own docblock carries the full argument for the next implementer who reaches for this item.

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

Body scale (`--text-*`): `xs 11 · sm 13 · md 15 · lg 17 · xl 20 · 2xl 26 · 3xl 34`, densifying at
`UI_CONFIG.shell.denseFromPx` to `xs 11 · sm 12 · md 13.5 · lg 15 · xl 17 · 2xl 22 · 3xl 30`.
**`xs` is for micro-labels and eyebrows only, never a sentence.** Gameday moved `xs` from 12 to
**11** because 11 is the denominator of law 2's stated range and the size the approved mock sets
every micro-label at.

Display scale (`--text-display-*`): `sm 20 · md 28 · lg 44 · xl 58 · 2xl 84 · 3xl 116`, with
`leading-display`. Gameday moved `2xl` 82 → **84**: that is the scoreboard step, and law 2 names it
by value. A display size is never a substitute for a body size at the same px.

**Law 2's ratio is pinned, not described.** *"A score is 84px; its label is 11px"* — 7.6x.
`tokens.test.ts` asserts `display["2xl"] === 84`, `size.xs === 11` and the ratio between them, so
the sentence above cannot drift out from under the scale. That is a separate gate from the ≥9x
dynamic-range check below, which measures the TV board's 116px top step and would still pass if the
scoreboard step vanished.

**The scale carries ~10x of dynamic range, and that is a gate.** The fun pass's third named cause
of "it feels like a legal website" is uniform hierarchy: *"sports interfaces live on roughly 10x
scale contrast — a huge number, a tiny label. We are at about 2x."* The scale topped out at 58
against a 12px `EYEBROW`, which is 4.8x, and no amount of care at a call site invents range the
scale does not carry. `tokens.test.ts` now asserts the top of the display scale is at least 9x
`size.xs` in **both** emissions (116 over 12 is 9.7x on a phone, over 11 is 10.5x at desktop
density). **The range comes from size and only from size** — rule 2's ≤600 weight cap did not
move, and `src/design/weight-cap.source.test.ts` is what stops the next author reaching for a
heavier face instead of a bigger one: `font-bold`/`font-extrabold`/`font-black` are banned across
the same seven directories the caps and accent sweeps walk, with no allowlist, because no surface
in this product has earned 700. (That claim used to be a repo-wide grep recorded in this doc; a
grep at a moment in time is not a gate.) `2xl`/`3xl` are deliberately **not** densified: 116px is
a TV board or a matchup hero, so a call site steps down responsively (`text-display-lg
sm:text-display-3xl`, the idiom E6 established for the hero) rather than shipping it at 360px.
`Stat` (see Primitives) is the primitive that spends this range. The v3 hero adopts the responsive step E6
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

**Historical, and superseded by Gameday's execution doctrine.** Kept because several research
documents cite this section by name.

Under v3 this section recorded a deliberate limit: the signed-in shell, the draft room and the TV
board were already structurally disciplined (the audit's own diagnosis: "the signed-in board,
draft room, and profile already mostly hold the bar"), so v3's Cluster C sweep applied the palette,
caps and pill rules to every remaining surface **without restructuring** bands, regions or
animations — `Countdown`'s `tone: "hot"` read live-red by token change alone, with no
component-level edit.

**Gameday reverses that limit**, and the reversal is the point of the whole version. Laws 1 and 3
require the position, team and tier channels on every surface that draws a player, which is most of
them; law 2 changes a type scale the whole product reads from; law 4 tightens every table. The
spec's own words: *"It is a system replacement, not a repaint, and it should be built as one piece
with the screens as the acceptance criterion rather than as phased amendments."* A retone-only pass
is exactly the mistake that produced "little changes here and there".

**The acceptance criterion is a screenshot, not a rule check.** Every screen track ends by
rendering the real page, putting it beside the approved composition, naming the differences and
closing them. The previous pass verified tests, contrast ratios and rule compliance, and shipped
surfaces nobody had ever looked at.

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
`Button` (variants primary/verb/secondary/destructive/ghost — `primary` is the ceremonial ink pill, `verb` is Gameday's money-filled repeated action (law 5), `secondary` the quiet pill, see "Pill discipline and the obvious verb" above; `loading` = aria-busy + disabled + spinner, label stays), **`ButtonLink`** (v3, Task 4 — the anchor form of `Button`, same `buttonClassName` source of truth; no `loading`/`disabled`, since an anchor has neither), `Input` (label required; error → `aria-invalid` + `aria-describedby`), `Textarea` (the multi-line sibling of `Input`, same `FieldShell` label/hint/error contract; an optional `maxLength` renders a live, `aria-live="polite"` remaining-character count wired into `aria-describedby` — `ReviewComposer` is the one caller today, backed by the same `validateReviewDraft` rule the server enforces, so the number on screen and the number the API accepts can never drift), `Select` (label required; native `<select>`; same error/hint contract as `Input`), **`Card`** (border + `shadow-card`; `interactive` is **rule 4's amended test in code** — *a thing you act on or compare against its neighbours may be a card; a thing you read down a column stays a row* — and it spends `surfaceRaised` on `hover`/`focus-within`, the depth role the palette had always named "a row hover" and no surface had ever used. Depth, never a heavier line: `line` stays decorative, `edge` stays a control boundary, and a card is not a control — it takes no `role` and no `tabindex`, so the action inside it is still the view's one ink action. A card that lifts with nothing inside to press is decoration and rule 6 rejects it), `Badge` (semantic tones; `glow` adds a tinted `ring-2` for a live/urgent tone, built on `accentGlow`/`warningGlow`; only `accent` and `warning` carry a glow token today), **`PositionBadge`** (`position` + `size: sm|md` — the sticker chip; the ONLY renderer of a position; one of the caps charter's two allowlisted files), **`SlotChip`** (`slot` — the bordered chip for a roster-slot letter that isn't itself a position, e.g. `FLEX`/`BENCH`), **`PageTitle`** (`size: md|xl` — the one `<h1>` treatment for a PAGE; `font-semibold`, not `font-bold`, as of Task 9; a room supplies its own `<h1>` instead, see "Layout" above), `Table` (semantic `<table>`; `caption` required — visually hidden unless `captionVisible`; `empty` node required; optional `rowAttributes` spreads plain attributes onto the `<tr>` itself, never a second wrapper element; scrolls horizontally inside its own wrapper at 360px; `density: comfortable|dense`, defaulting to `dense`, see `docs/decisions/design-v2.md` §4 for the full decision record), `Celebration` (`role="status"`; `emphasis: "self" | "peer"` picks the animation class and the accent treatment; renders with no animation class at all under reduced motion — the one primitive both `PickCelebration` and `MatchupCelebration` are built on), `Avatar` (`name` for the deterministic initials fallback, plus an `avatar` prop that is NOT a URL — it is the raw stored `AvatarRef` string (`users.avatar_url`), which `parseAvatarRef` (`@/identity/avatars.ts`) resolves into one of three renders: a preset tile — an `Icon` on one of `AvatarTone`'s five fills — for a `preset:<key>` value, an `<img>` for an `https://` URL, or the same initials fallback for anything else, including `null`, an unrecognized preset key, or a rejected scheme like `javascript:`/`data:`/`http:`; decorative unless given a `label`), `Modal` (renders nothing when closed; `role="dialog"` + `aria-modal`; focus moves in on open, cycles on Tab, returns to the opener on close; Esc closes), `ToastProvider`/`useToast` (one polite live region; `tone: "error"` toasts are also `role="alert"`; auto-dismiss after `UI_CONFIG.toast.dismissMs`, or `reducedMotionDismissMs` when the user prefers reduced motion; optional action button), `Skeleton` (aria-busy, announces "Loading…"), `EmptyState` / `ErrorState` (action required), `Icon` (curated `IconName` union; feature code never imports lucide directly), `InfoTip` (`term: TermKey`; click-to-reveal — never hover, per WCAG 2.2 1.4.13 — a real `<button>` with `aria-expanded`; the revealed `role="note"` sits in normal document flow, never a floating overlay, so it can never obscure the trigger; `helpLevel="guided"` additionally prints the glossary entry's short line inline, unhidden — the ONE way a `@/help/glossary` definition reaches the page, except inside a `LeagueRow`, which never passes `helpLevel` at all — see "The row shelf" above; `Escape` closes it while it holds focus), **`Countdown`** (`remainingMs`, `size: md|lg|xl`, `tone: default|hot` — the ticking-digits primitive, `aria-hidden`, paired with a plain-language `aria-live="polite"` sibling stating the same time coarsely via `formatCoarseRemaining`, e.g. "About 8 hours left"; display only — a countdown never decides anything, the server ticker owns clock expiry; `tone: "hot"` reads live-red by v3's token retone alone, no component change).

**Five v2 primitives (Task 3, Phase 3.6), each extracted at its own second caller rather than invented ahead of need**, joining `Badge`, `Table` and `Countdown` above as the three *existing* primitives v2 extended instead of forking:
- **`Panel`** (`title`, optional `meta`, `headingLevel: 2|3`) — the "eyebrow label, hairline, content" block, built on `Card` plus the shared `EYEBROW` class (now sentence-case mono, see "The caps charter" above). Two callers today (`seat-hold-panel.tsx`, `invite-panel.tsx`).
- **`Crest`** (`id`, `label`, `size?`) — a league's (or team's) two-letter tile, toned by `crestTone` (a re-export of `avatarTone`, so a league's crest and its members' avatars are drawn from one deterministic palette). The other of the caps charter's two allowlisted files (the letters are data, not shouting). Five callers today.
- **`SeatMeter`** (`filled`, `total`, `heldSeats?`, `srOnlySentence?`) — THE seat sentence for the whole product (F17): "9 of 12 seated", gaining a low-seats clause and a held-seats clause as each becomes true, composed rather than concatenated so a screen reader takes one pause, not several — **unchanged by v3, verbatim**. What changed is the visual bar beside it: v3 (Task 5) redesigned it from dots to the mock's segment bar — `total` equal flex segments, `filled` of them `bg-accent` (money = seats filling, rule 1), the rest `bg-surface-inset`, still `aria-hidden` beside the same sentence. `srOnlySentence` (Task 13) lets `LeagueRow` print its own visible tabular "{n} of {t} open" value while the one product seat sentence still speaks to assistive tech underneath it. Nine-plus callers, including `OpenLeagueCard`, `LeagueRow` and `WaitingRoom`.
- **`Meter`** (`label`, `value`, `max`) — a labeled fill bar that cannot be constructed without its own number beside it. Two callers today (`home-board.tsx`, `league-board.tsx`, both a matchup margin).
- **`StatPill`** (`label`, `tone?`, `glow?`) — a `Badge`, for the state-chip vocabulary (Live / Final / Fix lineup). v3 (Task 3) dropped its forced `uppercase` — the chips now read sentence case, the caps charter applied to a primitive that used to force the transform itself.

**`Stat`** (`label`, `value`, `comparison?`, `size?`, `orientation?`) — the fun pass's own primitive (Task 1) and the **only** renderer of magnitude colour in the product. `comparison` is a `{ percentile, population }` pair and the sole route to a tint; omit it, or state it badly (an unnamed population, a percentile off the scale), and the number renders as ordinary ink. Three channels ship together so the ramp survives with hue switched off: the value as text, a caret naming which side of the population it fell on, and a weight step naming how far. `size` walks the display scale (`sm`…`3xl`); `orientation` is `stacked` (default, a `<div>`: the number-over-label pairing the ~10x range exists for) or `inline` (a `<span>`, value then label — added by Task 7 for the verdict chip, which renders in a dense pool row, a one-line pick wire and a tabular pick log, none of which have room for a stacked pairing). Free-standing `magnitudeStep(comparison)` answers the same question without rendering.

`Card` also takes `padding` (`comfortable` default, `compact` — a card that is also a ROW in a dense list, added by Task 8 for the draft room's player pool) and accepts `as="li"`, since an `<ol>` may only hold list items and a card that IS a list row must be able to be one rather than sit inside a second wrapper.

Two free-standing exports beside `Countdown` itself: `useCountdown(deadlineAt)` (the ticking hook — `UI_CONFIG.countdown.tickMs`, slowed to `reducedMotionTickMs` under reduced motion) and `formatCoarseDuration`/`formatCoarseRemaining` (the "5 minutes" / "About 2 hours left" building blocks a caller with its own sentence to build — `WaitingRoom`'s "Starts in …" and the wire's own item sentences both reuse this directly rather than writing a second minute/hour formatter).

**The Gameday primitives (v4)** — built directly from the two approved compositions, which is the only reason each one exists. `docs/research/2026-08-28-gameday-foundation.png` is the side-by-side that proves the set is sufficient.

- **`PlayerFace`** (`player`, `size: sm|md|lg`) — law 3's atom: the club-colour tile with the `Avatar` on it. `md` (44px) is the approved composition's own face size and the one measurement law 4 does not get to tighten — the face IS the object. An unknown team code renders the bare face, never a grey rectangle pretending to be somebody's colours. Promoted out of `src/draft-room/components/` so every surface that draws a player can reach it.
- **`PlayerRow`** (`player`, `meta?`, `verdict?`, `action?`, `highlight?`) — laws 3 and 5 in one atom: face, name over meta, verdict, verb, in that order, so the verb sits in the same horizontal position on all sixty rows. `verdict` and `action` are SLOTS, not props: a magnitude colour may only be named by `Stat`, and a row that hard-coded its verb would have to learn every room's rules about when a manager may act. `highlight` paints the `accent-wash` utility rather than a hand-rolled tint, because the accent budget bans `bg-accent/10` outside its allowlist and the fix that budget actually wants is one address for the tint.
- **`TierDivider`** (`grade: TierGrade`, `label`) — the band, drawn from real ADP gaps. The grade LETTER is the colourblind channel and always renders as text; a square badge, not a pill, so it can never be mistaken for the position sticker a few pixels below it.
- **`Scoreboard`** (`home`/`away: SideProps`, `middle`) — the matchup hero. The score is `text-display-2xl` (84px) over an 11px micro-label, which is law 2's 7.6x pairing spent rather than admired. It stacks to one column below `sm` because two 84px scores are wider than 360px and law 2 says the layout moves, not the type. `SideProps.comparison` is the honest-comparison seam — see "The fun-pass amendments" for why it is empty by default.
- **`PointsShareBar`** (`mineLabel`, `theirsLabel`, `mine`, `theirs`) — real arithmetic, `mine / (mine + theirs)`, and its docblock says out loud that it is NOT a win probability. A win probability needs a per-game distribution the engine does not emit, and a probability we cannot compute is exactly the kind of number a sports app fakes. It carries its own percentages beside the bar, the same contract `Meter` keeps.
- **`GameStateChip`** (`state: GameState`) — `Q3 · 8:42` live, `Final` faint, `4:25 ET` muted. Ships with **`NOT_STARTED_DASH`** and **`pointsForGameState(state, points)`**, which is the rule rather than a suggestion: a scheduled player's points are an em-dash whatever number the caller holds. *"Folding 'has not played' into 'scored nothing' is the most common lie a fantasy scoreboard tells."*
- **`EventFeedRow`** (`time`, `children`, `delta`, `mine`, `comparison?`) — the heartbeat. **`signedPoints(points)`** always attaches the sign, because the sign is the colourblind channel and cannot be left to a caller's `toFixed`; it also refuses to render a negative zero.
- **`Pill`** (`tone: neutral|hot`) — the figure-carrying chip ("3 yet to play", "18.4 on your bench"). Composes `Badge` so there is still exactly one pill geometry in the product, and adds the one thing `Badge` is wrong about for this job: mono, because a `Pill` states a NUMBER inside a sentence.

**`useValueChangeHighlight(value)`** (`src/design/use-value-change-highlight.ts`) — law 6's only new motion, and the only sanctioned way to spell a value-change wash. False on mount (nothing changed on mount), true for `TOKENS.motion.duration.slow` after a real change, false again after. Under reduced motion it returns `false` unconditionally and **arms no timer at all** — its test asserts `vi.getTimerCount() === 0`, so the branch is proven absent rather than merely suppressed, which is the bar law 6 sets.

Tunables for primitives live in `src/components/ui/config.ts` (`UI_CONFIG`, `EYEBROW`) — never inline in a component. v3 additions: `UI_CONFIG.frontDoor.shelfCap` (6 — how many member leagues the front door shows before handing off to `/browse`), `UI_CONFIG.openLeagueCard.clockWithinMs` (6h — the window inside which the Drafts value ticks), `UI_CONFIG.wire.minItems` (3), and `MATCHMAKING_CONFIG.wire.windowMs`/`maxItems` alongside the pre-existing `MATCHMAKING_CONFIG`. (`MATCHMAKING_CONFIG.proof.nextDraftWithinMs`, the 24h window for a scheduled-kickoff proof chip, is gone — storefront review R1 retired the scheduled-kickoff fact it gated once the whole shelf went sit-and-go; see `docs/decisions/formats-and-lobby.md`, "The whole shelf is sit-and-go".)

## Motion (law 6: motion reports, never performs)

**The razor first, because it is the whole section:** *turn every animation off — if the product
feels dead, the aliveness was fake.* Aliveness is a property of the information, not the
animation. Count the moving parts on the approved Sunday screen and there are two: a breathing live
dot, and a one-off highlight on the row that just scored. Everything else is still, and it still
reads as a sports app.

`TOKENS.motion` — fast 120ms / base 200ms / **slow 250ms** / pulse 1 600ms / wire 38 000ms, easings
`standard` and `emphasized`.

**`slow` moved 320ms → 250ms**, because law 6's *"nothing eases longer than 250ms"* is not a real
rule while the variable every celebration reads says 320. `tokens.test.ts` holds every eased
duration at or under the ceiling. `pulse` and `wire` are deliberately exempt and named in that
test's docblock so the exemption is a decision rather than an oversight: neither is an *ease* —
`pulse` is the live dot's cycle length and `wire` is a ticker's loop, both continuous states
reporting something still true. Law 6 caps transitions; it does not cap a clock.

Deliberately **no second `highlight` token**: the longest permitted ease and the duration of the
value-change wash are one fact, and two names for one fact is how they drift apart.

### What may move, and nothing else

Five permissions, each requiring something real to have happened:

1. **A value that just changed** — a one-off highlight on the row carrying it. `useValueChangeHighlight` (`src/design/use-value-change-highlight.ts`) is the only way to spell this.
2. **A running clock's digits** — the number itself, not an effect around it.
3. **A meter reflecting real progress** — the bar moves because the quantity did.
4. **An element appearing because a real event created it** — a feed row, a landed pick, a toast.
5. **A control responding to being pressed.**

### What may never move

**Nothing animates on mount, on scroll, or on hover.** No slide-ins, no bounce, no spring, no
shimmer, no parallax, no skeleton pulse dressed up as personality. This is the clause v3 lacked:
"only true things move" said what *may* move and was silent on the tacky failure modes, so nothing
in it forbade a page that eased itself into view every time you visited it.

A change that makes a screen louder without making a true thing more legible is decoration, and
law 6 rejects it. The complaint that produced Gameday was that the product reads as a contract, not
that it lacks ornament.

### The sanctioned animations

All declared in `globals.css` against token variables — never a literal duration:

| class | what it does | where |
|---|---|---|
| `animate-celebrate-peer` | 8px rise + fade, `base` | `Celebration`'s panel when the moment is someone else's — a pick that isn't yours |
| `animate-celebrate-self` | scale 0.96 → 1.03 → 1 settle, `slow`/`emphasized` | `Celebration`'s panel when the moment is yours |
| `animate-sticker-slap` | scale 1.15 → 1 with a small rotate settle, `slow`/`emphasized` | the board cell for the pick that just landed |
| `animate-spotlight` | a slow opacity breath on the accent ring | the board cell that is on the clock |
| `animate-wire` | translateX marquee, `wire` (38s), linear, infinite | the activity ticker — real events only, see "The wire's honesty contract" above |
| `animate-pulse-live` | opacity 1 → .35 → 1 breath, `pulse` (1.6s) | the live chip's dot — rendered only while something is genuinely live |
| `animate-rise` | opacity + 14px rise, `base`; `rise-1..4` stagger by 1–4× `fast` | the front-door hero's entrance |

Each of these predates Gameday and each still needs an event behind it. `animate-rise` is the one
closest to the line law 6 draws — it is an entrance — and it survives only because it fires on a
signed-out marketing hero rather than on a surface a manager returns to. It is not a licence for
entrance animations on signed-in screens.

**One `Celebration` primitive, two callers.** `PickCelebration` (the draft room) and
`MatchupCelebration` (the league room) are the same moment — "something worth announcing just
happened" — said with different words. Both are built on `Celebration` + `useTransientVisibility`
(keyed so a redelivered event never re-animates) rather than each rolling its own timer and markup.

### Reduced motion, honored twice over

1. **Globally**, in `globals.css`: a `prefers-reduced-motion: reduce` block collapses every
   animation and transition to 0.01ms. This is the safety net — it applies to code that has never
   heard of the preference, and it is what turns the wire's infinite marquee into a static list for
   free.
2. **Deliberately**, via `usePrefersReducedMotion()` whenever "less motion" should mean *different
   behavior* rather than a faster animation: the landing sticker simply appears (no slap), the
   on-the-clock cell keeps a **static** accent ring instead of breathing, `Celebration`'s panel
   renders with no animation class at all (but still appears, and is still announced via
   `role="status"`), toasts dwell twice as long, the live chip's dot stops pulsing but the chip
   still shows, the countdown ticks every 30s instead of every second, and
   `useValueChangeHighlight` returns `false` unconditionally so the wash is never rendered at all.

**The reduced-motion branch must be a real branch, and it must be tested as one.** Any component
whose reduced-motion behavior differs from a faster animation carries a test asserting *both*
branches. The bar law 6 sets is that **reduced-motion removes all of it and the product loses
nothing** — if a screen becomes less informative with motion off, the information was living in the
motion, which is the failure the razor exists to catch.

## Copy

Plain language, active voice, specific. Errors say what happened and what to do next. No raw
exception/DB text ever reaches a user. Five surfaces phrasing one promise five ways is a
design-system failure, not a writing one — the rules below exist so nobody has to re-derive a
sentence this product already decided on. **Unchanged by v3** — the caps and pill rules govern
typography and layout, never the words themselves. **Amended by the fun pass (Task 4), which is
the one place the words themselves moved.**

### Assert, do not explain (the fun pass, 2026-08-27)

The founder's *"it feels like a legal website and not a fantasy site"* is a copy complaint at
least as much as a visual one, and it is the cheapest half of the fix. The spec's second named
cause: *"The copy is written like terms. 'This team must make its pick before time runs out.' is a
compliance sentence. A fantasy product says 'You're on the clock' and stops talking."*

**Name the moment, then stop.** Four tells, each of which had shipped on more than one surface
before Task 4 swept them:

1. **Explaining a mechanic the screen is already showing.** A tour stop that narrates a countdown
   the reader is watching, a board empty state that explains that boards fill up.
2. **The lawyerly softener** — a second sentence whose only job is to reassure, absolve or grant
   permission. *"and that is fine"*, *"Clear it whenever you like"*, *"Make it whenever you are
   ready"*, *"There is nothing to run by hand"*. All gone. The first sentence was already kind.
3. **The stacked restatement** — a rule, then a worked example of the same rule, above a control
   that teaches it faster than either. The slot panel's example was deleted outright; the
   `InfoTip` beside the heading is the long version for whoever presses it.
4. **The administrative noun where a sports word exists.** The clearest instance: a week that is
   happening now reads **"Live"**, not "In progress".

**What this rule does NOT license.** Money, seats, refunds, fairness and moderation sentences are
load-bearing and stay long if long is what makes them true — `seatCountsAsOfSentence`'s second
sentence is the thing that makes its first one honest. Screen-reader sentences are never trimmed:
the visible digits of a clock are `aria-hidden` and the `sr-only` sentence beside them is the only
spoken form there is. And C3's sanctioned safety-net phrase, **"the room picks for you from your
queue"**, is still quoted verbatim by every surface that reassures a member about missing a draft.
Cutting a sentence is only an improvement when nothing true leaves with it.

Everything above this line still binds: expanded register (no contractions, C1), no em-dashes or
en-dashes, no accusatory terms, no passive constructions, no forbidden vocabulary — all five
mechanically enforced by `copyViolations` (`src/integrity/copy-rules.ts`) through four sweeps.

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
Design review against this doc · light + dark verified · loading/empty/error/success states exist · `axe` clean + keyboard walkthrough · copy review (**assert, do not explain** — see "Copy") · works at 360px · no `uppercase` outside the two allowlisted files · nothing heavier than `font-semibold` · at most one ink pill per view · **any heat-coloured number also reads plainly as its own number, and a judged one carries its caret and weight step**.

Component tests run in happy-dom without a stylesheet, so the "both themes + axe" checks in `*.test.tsx` verify structural a11y (roles, labels, ARIA attributes) in each theme, not actual rendered color; real color contrast is verified numerically by `src/design/tokens.test.ts` — which covers the semantic roles, the translucent-band composites, and all fifteen sticker pairs in both themes — and browser-based visual contrast checks land with the e2e plan (Task 12's contrast spot-verification).
