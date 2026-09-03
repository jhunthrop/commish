# v6 foundation: the warmth pass, token and primitive layer

Founder ruling 2026-09-03 ("more roundness and friendliness... it's kind of rigid feeling"),
direction approved as the canvas in `.superpowers/mocks/` (Anatomy = before/after component
anatomy, WarmQuilt = target feel, Main = today's reference, canvas.json = the full ruling).

Same laws as Sunday v5 — timing-tower density, the chroma channels (amber = yours, red = live),
one solid verb per surface, honest data, both themes. SOFTER MATERIALS. This branch is the
FOUNDATION only: tokens, the shared primitives, the centralization sweep, and the gate. The
quilt's manager row, drawer handles, roster button and per-surface faces are a later branch.

## Stage 1 — token deltas

### Radius scale (judged against the mocks: cards read 14-16, verbs 12, chips pill)

| token | v5 | v6 |
|---|---|---|
| sm | 4 | 8 |
| md | 8 | 12 |
| lg | 12 | 16 |
| xl | — | 20 (new) |
| pill | 999 | 999 |

`globals.css` gains the `--radius-xl` alias. `rounded-md` verbs land on the mock's 12,
`rounded-lg` cards on 16, sheets take `rounded-t-xl` = 20.

### Dark elevation (evolved, not forked)

The mocks' three-step elevation is ground `#05070C`, resting `#0F1522`, raised `#131B2A`.
Reconciled onto the EXISTING roles — the ladder keeps its four steps and its names:

| role | v5 | v6 |
|---|---|---|
| surface | #05070C | #05070C (unchanged — the mocks' own ground) |
| surfaceElevated | #0B1019 | #0F1522 (the mocks' resting fill) |
| surfaceRaised | #101724 | #131B2A (the mocks' raised row) |
| surfaceInset | #0A0F17 | #0A0F17 (unchanged — the well stays below the ground) |

`surfaceRaised` is dark's BINDING GROUND (brightest of the four), so every dark chroma value
was re-measured against #131B2A. One value fails and moves:

- `textFaint` #738195 measured 4.35:1 on the new raised — below the 4.5:1 floor it is held to.
  Re-solved along its own hue to **#76849B**: 4.55:1 on raised, 5.32/4.82/5.07 on
  ground/elevated/inset. Nothing else moves — textMuted 5.61, edge 3.23 (≥3), live 4.92,
  magnitude `bad` 5.01, tier C fill 3.18 on elevated (≥3), every band composite still clears.

### Light theme

Light's surfaces DO NOT move, and that is a measured decision rather than an omission. Light's
raised step is already the theme's peak (#FFFFFF — daylight depth climbs to white), so the
ladder cannot widen upward; widening it downward (darkening the ground) breaks the light
palette's tightest solved value, tier C's 3.08:1 findability floor, and re-orders the ground
against the binding inset. Light receives the SAME v6 material treatment where the material
actually lives in daylight: the radius scale (shared) and its own designed shadow set below,
at equal perceived depth. Its verb glow derives from its own accent (the brand blue), never
from dark's amber.

### Shadow/glow set (new; per-theme, replacing the theme-independent pair)

A cast shadow is theme-dependent the moment an inset top-light joins it — a white inner
hairline is dark's material and would vanish on paper — so `TOKENS.shadow` becomes two designed
sets over one key set, the same shape `TOKENS.color` keeps, emitted inside the theme blocks:

| key | dark | light |
|---|---|---|
| card | `inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.35)` | `0 1px 2px rgb(22 24 29 / 0.06), 0 4px 16px rgb(22 24 29 / 0.08)` |
| raised | `inset 0 1px 0 rgba(255,255,255,0.05)` | `0 1px 2px rgb(22 24 29 / 0.05)` |
| overlay | `0 12px 40px rgba(0,0,0,0.45)` | `0 12px 40px rgb(22 24 29 / 0.18)` |
| verbGlow | `0 4px 14px rgba(255,182,39,0.25)` | `0 4px 14px rgba(19,80,168,0.25)` |
| sticker | `0 2px 0 rgb(22 24 29 / 0.14)` (unchanged, both themes) | same |

`generate-css` moves shadow emission into the per-theme blocks; `globals.css` gains
`--shadow-raised`, `--shadow-overlay`, `--shadow-verb-glow` aliases. `tokens.test.ts` and
`generate-css.test.ts` pin the new radius scale, the new surfaces (via the existing contrast
gates re-measuring automatically), the shadow key parity across themes, and the amber/blue
glow-follows-accent rule.

### MICRO_LABEL restyle

The caps charter keeps its one address. The register softens per the mocks' surviving caps
(0.5px tracking at micro sizes): `tracking-[0.11em]` becomes `tracking-[0.06em]`. Mono, xs,
uppercase stay — the sweep's guard assertions still hold.

## Stage 2 — primitive treatments

- **Card** — gains `variant: "soft" | "outline"`, default soft: the hairline goes, the card is
  `rounded-lg bg-surface-elevated shadow-card` (the dark shadow token carries the inset
  top-light). `outline` keeps `border border-line` for the few places a boundary is semantic.
  Interactive depth response unchanged.
- **Button/ButtonLink** — radii ride the moved tokens (verb = 12, ghost/live = 12, pills stay).
  `verb` gains `shadow-verb-glow`. One spelling (`buttonClassName`) so both forms move at once.
- **BottomSheet** — drops its hairline, keeps `rounded-t-xl` (now 20), `shadow-2xl` becomes the
  `shadow-overlay` token.
- **DecisionSheet** — the solid amber border becomes the v6 attention treatment: soft surface +
  `ring-2 ring-accent/40` wash-ring, `rounded-xl`, `shadow-overlay`.
- **Modal** — `rounded-xl`, hairline dropped, `shadow-overlay`.
- **SegmentGroup** — the bordered strip becomes a row of pills (mock: tabs are pills on the
  resting fill); active segment keeps the solid amber fill (furniture channel, verified ink).
- **Badge / Pill / chips** — already `rounded-pill`; unchanged by construction, re-verified.
- **GameStateChip** — a bare mono micro-label with no box; nothing to soften, softened tracking
  arrives via MICRO_LABEL.
- **Table** — row/header hairlines are data separation and stay; the dense row height and inks
  are law 3's and do not move.
- **LowerThird** — keeps its channel top-bar (semantic) and cell hairlines (data separation);
  sits on the moved elevated surface.
- **EmptyState/StatePanel** — neutral tone drops the dashed hairline for the soft resting fill;
  gains an optional `mascot` slot rendering the practice bot (new `src/components/ui/mascot.tsx`,
  the Anatomy mock's SVG, aria-hidden, static — no motion, trivially reduced-motion safe).
  `negative` keeps its semantic border.
- **Crest/Avatar** — Avatar stays the circle (the mock's faces are circles). Crest's square tile
  takes the moved `rounded-md` (12px on a 40px tile — the squircle feel).

## Stage 3 — migration inventory (measured at base)

- `border border-line` hand-rolled surface boxes outside `src/components/ui`: **53 occurrences
  across 36 files**. Each becomes `Card` (or its outline variant), a token surface class pair,
  or stays as an ALLOWLISTED earned exception (data separation, semantic boundary).
- Hand-written `rounded-* + bg-surface-*` combos outside ui: **66 occurrences** — token-clean
  already (they ride the moved radius vars); migrated to primitives only where they duplicate
  one, left bespoke where genuinely unique (quilt cells, rail chips).
- Hand-rolled `uppercase` styling: already impossible outside the charter's addresses
  (`no-uppercase.source.test.ts`); no sites to convert.

Visual equivalence is judged under v6 (the new look), behavior-neutral: class/primitive swaps
only, rendered words identical.

## Stage 4 — the gate

New `src/design/no-raw-surface.source.test.ts`, following the accent-budget sweep's shape:
walks the same swept dirs, fails any `.tsx` outside `src/components/ui` that hand-writes
`border border-line` (the raw hairline box the warmth pass retired), with a named allowlist —
one line of reason per entry, guard assertions that every allowlisted file still contains the
string, and a bite test. Raw uppercase styling is already `no-uppercase.source.test.ts`'s job;
that sweep is referenced, not duplicated.

## Verification

- Screenshot set (1440x900, dark+light): front door, league room, draft room, mock drafts,
  admin jobs, wallet — `.superpowers/screenshots/{before,after}/`, before captured at base.
- tsc 0, eslint clean, design sweeps green with values moved WITH the system.
- Full vitest failure set must not grow past base (base: 22 failed files / 35 failed tests,
  recorded in the session scratchpad — includes pre-existing accent-budget and weight-cap
  failures inherited from main).
