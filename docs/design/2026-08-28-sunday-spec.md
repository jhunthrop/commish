# Sunday — the design system, v5

**Status:** governing. Supersedes Gameday v4 (`2026-08-28-gameday-spec.md`) and, through it, Sunday Standard v3.
**Approved:** founder, 2026-08-28, from the timing-tower mockup.
**Mechanism:** the F1 timing tower.

---

## The thesis

Every product in this category picks one thing to be, and everything follows. ESPN and Yahoo
chose the database. Sleeper chose the group chat and won a generation with it. Underdog chose the
slot machine. Flock chose the tool shed.

We are **the house**: the operator who runs the league, seats you in it, and has a better board
than the consensus. A house needs two registers and only two — the **broadcast**, for the three
hours a week that carry the emotion, and the **tower**, for every screen where a decision has
money on it. They are one language at two densities.

## The razor

> **A timing tower, not a spreadsheet.**

The mistake this system exists to prevent is taking a trading terminal and repainting it. A
trading screen is dense because density is cheap when nobody has to feel anything.

Sport already solved the problem. An F1 timing tower carries more numbers per square inch than
most trading screens — position, gap, interval, sector, tyre, pit status — and nobody has ever
mistaken one for a spreadsheet. It works for reasons we can copy exactly, and they are the laws
below.

---

## The seven laws

### 1. Every number is a delta, not a fact

A leaderboard has only ever shown one thing: the gap to a rival. Raw values are quiet; the
**comparison** is loud. Market rank, expert rank and our rank sit in muted ink so that **Edge** —
where we disagree with the room, and by how much — is the only figure with chroma on it.

A number with no comparison set behind it is a fact, and facts are grey. This is the direct
descendant of v4's refusal to tint a number without a stated population, and it survives intact.

### 2. Movement is a story; position is only a state

`3` tells you where a player sits. `▲ 9` tells you what happened. The tower's oldest trick costs
one narrow column and converts a table into a narrative. Wherever the product knows a previous
value, it shows the change.

### 3. Readable from the sofa

A terminal shrinks type to fit another column. A broadcast graphic keeps type readable and
**drops the column instead**. Rows are 44px, names are 18px, and ten columns still fit because
condensed type buys them back.

Condensed is therefore not a style choice in this system. It is load-bearing, and replacing the
typeface with a normal-width face silently breaks law 3.

### 4. Colour is spent exactly three times

Chroma is rationed to three jobs, and everything else in the product is ink on stadium black:

| Channel | Value | Means |
|---|---|---|
| **Furniture and you** | amber | the network's own graphics, your row, the one verb |
| **Verdict** | cyan / warm red | we rate him higher / lower than the room does |
| **Live** | red | happening right now, and nothing else ever |

Position and tier carry their own hues as a **legend**, which is a fourth channel only in the way
a key on a map is: it names a category, it never renders a judgement.

The verdict pair is cyan against warm red, not green against red. Green-versus-red is the worst
available pair for deuteranopia, which affects roughly one man in twelve, and this product's
audience is overwhelmingly men. As in v4, the pair is also ordered by **luminance**, so it
survives with the hue channel switched off entirely.

### 5. Bands are chapter markers, not hairlines

A tier is a filled plate carrying a letter and its **consequence in plain language** — "a real
drop after this". The letter is only its name; the consequence is what a tier means. A hairline
divider at sixty rows becomes the loudest thing on the screen while saying the least.

### 6. Every screen ends in a lower third

The broadcast convention: a strip across the foot carrying the clock, the subject, and one verb.
On the draft board that is the pick clock, who is queued, and Draft. On a matchup it is the game
state and the act the week is waiting on. If a screen has no lower third, either it needs no
decision, or the decision is hidden.

This replaces v4's law 5 and settles the old one-ink-action question: the lower third is *where*
the verb lives, so the rest of the screen is free to repeat that verb down a column without
competing with it.

### 7. We never draw a number we cannot stand behind

Carried from v4 unchanged and non-negotiable. Where a source has nothing to say, the cell is a
dash. A dash is not a zero, an absent number never picks up a tint, and a held-out measurement is
never printed beside a current one as though they were the same kind of claim.

---

## Both themes

Dark is the flagship and the design is drawn from a stadium at night. Light is **not** an
inversion of it — a night palette has no honest inverse. Light is the **day game**: the register
of a printed sports section, paper white, ink black, the same three chroma channels re-solved
against a bright ground.

Both themes carry identical roles and clear the same contrast thresholds. Per the founder ruling
of 2026-08-23 this is settled and is not reopened.

The two grounds that bind are not the ones intuition suggests, and this trap has already been
found once. Verify every value against them:

- **Dark's binding ground is `surfaceRaised`** — the brightest of the four dark surfaces.
- **Light's binding ground is `surfaceInset`** — the dimmest of the four light surfaces, because
  a well recedes in daylight.

---

## What this costs, stated plainly

- **A second typeface**, and a condensed one, which the previous system's one-face rule forbade.
- **The near-monochrome discipline** of v3 and v4. Chroma is still rationed, but it is now present
  on every board rather than reserved for live events.
- **A real light-theme design pass**, not a token flip.

## What survives from v4

The refusals, which were the best part of it: no invented numbers, no tint without a stated
population, no team colour behind text, no magnitude on a control, and colour never carrying a
meaning alone. Those were right and they are re-stated here rather than repealed.

## Execution doctrine

Unchanged from v4, because it was correct and the last campaign proved it:

**The acceptance criterion is a screenshot, not a rule check.** Every screen track ends by
rendering the real page, putting it beside this spec's intent, naming the differences and closing
them. A pass that verifies tests, contrast ratios and rule compliance can still ship surfaces
nobody has ever looked at, and has.

---

## Appendix: the solved palette

Every value below was solved numerically and verified against the two binding grounds, not
picked by eye. Contrast figures are the measured minimum across all four surfaces of that theme.
Four candidates failed on the first pass and were re-solved; those four are marked, because the
next person tuning this ramp should not have to rediscover them.

### Surfaces and ink

| Role | Dark | Light |
|---|---|---|
| `surface` | `#05070C` | `#FFFFFF` |
| `surfaceElevated` | `#0B1019` | `#F7F8FA` |
| `surfaceRaised` | `#101724` | `#FFFFFF` |
| `surfaceInset` | `#0A0F17` | `#EDEFF3` |
| `line` | `#1B2331` | `#DDE1E8` |
| `edge` (control boundary, 3:1) | `#5A6C87` **re-solved** | `#767F8E` |
| `textPrimary` | `#FFFFFF` (17.95) | `#0A0D12` (16.90) |
| `textMuted` | `#8794A8` (5.84) | `#606E80` (4.52) |
| `textFaint` (3:1, non-text) | `#5A6678` (3.08) | `#818A98` (3.03) |

`edge` at `#4A5872` measured 2.50 and failed WCAG 1.4.11. A control boundary a person must find
is not decorative, so it is held to 3:1 and was re-solved.

### The three chroma channels

| Channel | Dark | Light |
|---|---|---|
| `accent` — furniture, you, the verb | `#FFB627` (10.23) | `#9D5707` (4.80) |
| `accentText` — on accent | `#1A1200` (10.59) | `#FFFFFF` (5.53) |
| `positive` — we rate him higher | `#00E5FF` (11.67) | `#004B66` (8.30) |
| `negative` — we rate him lower | `#FF6B5B` (6.42) | `#BF3122` (4.96) |
| `live` — happening now, nothing else | `#FF2D2D` (4.84) | `#CA1616` (5.01) |
| `liveText` — on live | `#1A0303` (5.35) **re-solved** | `#FFFFFF` (5.77) |
| `warning` — a tightening clock | `#FF843D` (7.37) | `#AA420E` (5.22) |
| `info` | `#4CACF0` (7.24) | `#105C93` (6.13) |

White on live red measured **3.71** and failed. Live red is a mid-luminance colour in both
themes, which is exactly why it reads as urgent, and near-black is the label that clears it.

`warning` is deliberately a separate hue from `accent`, not a shade of it: amber is the network's
own furniture and must never be mistaken for a verdict about time.

### The verdict pair, ordered by luminance (law 4)

| Theme | positive | negative | gap |
|---|---|---|---|
| Dark | 11.67 | 6.42 | **5.25** |
| Light | 8.30 | 4.96 | **3.34** |

Light needed two passes. With `positive` at `#006185` the pair sat 1.73 apart while `negative`
could not simultaneously clear 4.5:1 — the two constraints were in direct conflict. `positive`
was pushed deeper to `#004B66` to make room. **Recording this because it is not obvious: on a
bright ground the loud end of the pair has to go darker, not brighter.**

### The magnitude ramp, re-hued to the verdict pair

Strictly decreasing in contrast in both themes, so it survives with the hue channel switched off.

| Step | Dark | (ratio) | Light | (ratio) |
|---|---|---|---|---|
| `strong` | `#34E4FF` | 11.70 | `#004B66` | 8.30 |
| `good` | `#69C5D3` | 9.00 | `#205A6F` | 6.63 |
| `neutral` | `#FFFFFF` | — | `#0A0D12` | — |
| `weak` | `#FF7A59` | 6.99 | `#A04028` | 5.60 |
| `bad` | `#F05543` | 5.20 | `#C93121` | 4.62 |

**Both themes failed the ordering on the first pass** and were re-solved. Dark had `good` at 8.99
against `weak` at 8.98 — a collision invisible to anyone with normal colour vision and total for
anyone without. Light was worse: `bad` measured *louder* than `weak`, inverting the ramp.

`neutral` remains `textPrimary` verbatim, as in v4: a number with no comparison set behind it must
be indistinguishable from ordinary text.

### Position legend

Sticker fill, then the label printed on it. Every label clears 4.5:1 on its own fill, and every
hue also clears 4.5:1 used as text on all four dark grounds.

| Position | Fill | Label | On fill |
|---|---|---|---|
| QB | `#2A1D3B` | `#B08BF0` | 5.83 |
| RB | `#0E3B32` | `#4FE0C0` | 7.55 |
| WR | `#3B0E28` | `#FF6FA5` | 6.31 |
| TE | `#0E2A3B` | `#5BB8EF` | 6.76 |
| K | `#22262E` | `#9AA5B5` | 6.08 |
| DEF | `#1E242E` | `#8E9BAD` | 5.52 |

### Tier plates

| Tier | Plate | Letter | Ratio |
|---|---|---|---|
| S | `#FFB627` | `#1A1200` | 10.59 |
| A | `#B9C2D0` | `#14181F` | 9.91 |
| B | `#535F6E` **re-solved** | `#FFFFFF` | 6.50 |
| C | `#39424F` | `#FFFFFF` | 10.16 |

Tier B at `#6E7B8F` measured 4.29 with a white letter and failed.

### Typography

`Saira Condensed` (600/700/800) for every name, number and label. `Saira` (400/500/600) for the
few sentences the product still has. Condensed is load-bearing under law 3, not decorative: it is
what buys ten columns at 18px.
