# Phase 3.7 — Design v3: the Sunday Standard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the founder-approved Sunday Standard direction across the product ("this is better", 2026-08-24, binding) and retire every finding in the UX remediation audit. The audit's executive diagnosis is the weighting: the public shelf is the failure — twenty identical 500px cards in two columns inside a centered `max-w-6xl`, 40+ accent elements, unconditional glossary captions — while the signed-in shell mostly holds the bar. The front door, `/browse` and the card get the deep work; signed-in surfaces get the palette, caps and button sweeps plus the audit's targeted EXECUTION fixes.

**Spec (visual, binding):** the Sunday Standard mockup, `sunday-standard.html` (founder-approved 2026-08-24; archived by Task 11 into `docs/research/` so the spec outlives the scratchpad). Its six rules are the design language this plan legislates:

1. **Color is meaning.** Green is money and seats filling, red is live and clocks, everything else is ink and paper. Six colors, each with daylight and night values: paper/graphite `#FBFBFA`/`#0D0D0F`, ink `#1A1A1E`/`#F4F4F6`, quiet `#6B6B70`/`#98989F`, hairline `#E8E8EA`/`#242428`, money `#0B6B43`/`#3ECF8E`, live `#D6453A`/`#FF6B5E`.
2. **One face, earned weights.** Geist only (already the product face); hierarchy from size and weight. The mock's ramp: display 58/650/-0.028em, title 22/650, card 16.5/600, body 15/400, detail 13/400, mono for data.
3. **No capitals anywhere.** Every `text-transform: uppercase` is removed — league names, eyebrows, section labels, all of it.
4. **Hairlines, not boxes.** Structure from thin rules and space.
5. **One ink action per view.** One solid pill (ink background, ground text, pill radius); every other action is a quiet outlined pill.
6. **Only true things move.** The wire, draft clocks, seat meters, live pulses — real events animate, chrome never does; `prefers-reduced-motion` respected.

**Work-list (binding):** the UX remediation audit, `docs/research/2026-08-24-ux-remediation-audit.md` on branch `audit/ux-remediation` (read it with `git show audit/ux-remediation:docs/research/2026-08-24-ux-remediation-audit.md`; Task 11 merges the document into this branch so the finding table travels with the remediation that closes it). Seventeen findings: D1–D3 (DIRECTION — resolved by the v3 direction itself), E1–E12 (EXECUTION), F1–F2 (DEFECT). The finding-to-task map is at the bottom of this plan; every task that closes a finding names it in its commit body.

**Architecture:** Four clusters. **(A) The system** — the v3 palette lands as a retone of the nineteen existing `ColorRole`s (roles never change, values do; contrast thresholds never move), the position pigments are re-derived against the new grounds, the motion vocabulary grows the three behaviors the mock animates, and two new source-sweep tests legislate rules 3 and 5 the way `no-raw-color.source.test.ts` already legislates the hex ban. **(B) The public deep work** — the card becomes the mock's ledger card, the shelf becomes a full-width three-column band, the front door becomes hero + floodlight + scoreboard + a capped shelf with `/browse` as the full lobby, and the wire renders real events under the nav. **(C) The sweeps** — signed-in surfaces take the caps, palette and button discipline plus the audit's targeted fixes. **(D) The record** — the design doc is rewritten to the six rules, the e2e suite is walked under the e2e-under-redesign rule, and the persona panel walks the rebuilt public surfaces against the founder's bar.

**Tech stack: unchanged.** No new dependency, no new font (Geist and Geist Mono are already loaded), no new realtime mechanism, no migration, no schema change.

**Depends on `main` @ `1f966b1`** (Phase 3.6 and its addendum merged). Route groups as they exist NOW: `src/app/app/(shell)/**` (nine shell pages incl. `admin/queue/[flagId]`), `src/app/app/(room)/drafts/[draftId]`, `src/app/app/(public)/join/[code]`, and the non-`/app` public pages `src/app/page.tsx`, `src/app/browse/`, `src/app/reviews/`, `src/app/league-rules/`, `src/app/support/`, `src/app/legal/*`, `src/app/sign-in/problem/`, plus `error.tsx`/`not-found.tsx`/`global-error.tsx`.

---

## Global constraints

Every task's requirements implicitly include this section.

- **Rendering-only, stated as an A3-style acceptance.** The global lock law is untouched because this phase touches no writer at all: **zero diffs under `src/db/**`, `src/draft-engine/**`, `src/draft-service/**`, `src/integrity-service/**`, and zero diffs to any existing file under `src/league-service/**`, outside test fixtures** — with exactly one sanctioned addition: Task 8's new read-only modules `src/league-service/wire.ts` (+ its test) and the one exported query builder Task 7 adds to `src/league-service/proof.ts` (a `SELECT min(...)`; no write, no transaction, no lock). The reviewer of every task verifies the acceptance by checking the diff paths, not by trusting the task's word. No migration, no new table, no new realtime event type, no new environment variable.
- **Policy v4 verification, per task:** changed-files vitest (`npm test -- <touched dirs>`) + `npm run typecheck` + `npm run lint`. `npm run build` only in tasks that touch a route, a layout, or config that feeds the build (Tasks 1, 2, 6, 7, 8, 10). **e2e only for touched-surface specs at the cluster checkpoints** named below — never the full suite, and never per step.
- **TDD.** Every behavior change lands test-first: the failing assertion (a contrast number, a sweep hit, a rendered-copy expectation, a component state) is committed in the same task as the code that turns it green, and is written before it.
- **The e2e-under-redesign rule** (Phase 3.6, still binding): assertions on user-facing copy survive by default — a task that changes an asserted string updates the spec in the SAME commit and says so in the commit body; assertions on structure may be updated deliberately, never loosened. Note that caps removal changes **zero** DOM text (uppercase was CSS `text-transform`, so `getByRole` name queries are unaffected); the two known copy-assertion collisions are the hero headline (`e2e/design-v2.spec.ts:102,276`) and any spec touching the card's fact labels — Task 7 and Task 5 own those updates respectively.
- **Copy rulebook:** no contractions (the one recorded exception: "You're in"), no em or en dashes, no accusatory or passive constructions, no autodraft vocabulary ("the room picks for you from your queue" is the one phrase). Enforced by the five existing copy sweeps; every new component file joins `rendered-copy.test.tsx`'s roster in the task that creates it.
- **Both themes on every surface.** Every value in this plan has a daylight and a night spelling; `renderSurface` component tests and `tokens.test.ts` run against both palettes. `ThemeProvider` is untouched.
- **Derived-only, immutability, no ambient clock, client boundary, `Icon`/`PositionBadge`/`SlotChip`/`SeatMeter` monopolies, config over magic numbers, no raw hex outside `tokens.ts`:** all carried forward verbatim from `docs/design-system.md` and `docs/conventions.md`. Every tunable this plan introduces lands in `UI_CONFIG`, `MATCHMAKING_CONFIG` or `TOKENS` — never inline.
- **No mock data on a real surface.** The wire renders real events or renders nothing; the scoreboard renders `proofStats`'s floored numbers or nothing; no `Math.random`, no fabricated names, no placeholder rows, anywhere, ever.
- **Commits:** conventional commits, one task may span several commits; commit bodies name the audit findings closed and any structural e2e moves.

---

## The v3 palette, mapped onto the nineteen roles

Roles do not change; values do; thresholds never move. The mock's six colors and its two grounds map as follows (Task 1 lands exactly this, then proves it against `tokens.test.ts`):

| role | daylight | night | note |
|---|---|---|---|
| `surface` | `#FBFBFA` (paper) | `#0D0D0F` (graphite) | the ground |
| `surfaceElevated` | `#FFFFFF` (card) | `#161619` (card) | the mock's `--card` |
| `surfaceRaised` | derived: one hairline step off `surfaceElevated` | derived | keeps the four-step depth model |
| `surfaceInset` | the mock's `--tickbg` `#F3F3F1` | `#111114` | track, well, unfilled meter, the wire's band |
| `line` | `#E8E8EA` (hairline) | `#242428` | must stay <3:1 vs `surface` (asserted) |
| `edge` | derived gray ≥3:1 on all three surfaces | derived | the mock has no control-boundary value; Task 1 derives one from the quiet family and proves it |
| `textPrimary` | `#1A1A1E` (ink) | `#F4F4F6` | also the ink pill's fill (see Button, Task 4) |
| `textMuted` | `#6B6B70` (quiet) | `#98989F` | |
| `textFaint` | derived from the mock's `--faint` (`#AEAEB4`/`#5D5D66`), darkened/brightened until 4.5:1 on all four surfaces | | the mock's raw faint fails the floor exactly as v2's did; **the token moves, the threshold does not** |
| `accent` | `#0B6B43` (money) | `#3ECF8E` | links, focus rings, seat segments |
| `accentText` | label on a money fill, ≥4.5:1 | | money is never a button fill in v3, but the role keeps a valid value (Meter fills carry no label; the pair is still asserted) |
| `accentGlow` | translucent money | translucent money | the floodlight's radial tint (Task 7) |
| `positive` | == `accent`, both themes | | the `accent === positive` doubling survives verbatim (asserted) |
| `negative` | `#D6453A` (live) | `#FF6B5E` | live IS the failure family: clocks, live chips, destructive — one red, jobs separated by context exactly as green's already are. Night value brightened if needed to clear 4.5:1 as text on both surfaces |
| `negativeText` | label on a live fill | | |
| `warning` / `warningGlow` | retuned amber sitting quietly on the new grounds | | the role survives (roles are frozen); v3 demotes its **usage** (E5) so the clock tightening keeps a voice without the shelf glowing |
| `info` | retuned blue on the new grounds | | survives for notices and the WR pigment derivation |
| `scrim` | `#000000` | `#000000` | unchanged |

**Position pigments:** re-derived against the new grounds by the LED-2 recipe (same hue family per pigment, saturation and lightness tuned until (a) every `text` variant clears 4.5:1 on both surfaces per theme and (b) all fifteen pairwise sticker checks pass). `slate` stays the quiet one. The sticker matrix in `tokens.test.ts` is the gate; no threshold moves.

**Type:** `TOKENS.font.display.xl` moves 64 → 58 (the mock's display); the display tracking rule in `globals.css` moves −0.02em → −0.028em **on display sizes only** (self-ruling S3). The body scales are untouched (mock body 15 = `md`, detail 13 ≈ `sm`, title 22 = dense `2xl`, card 16.5 ≈ dense `lg` — the existing ramp already lands the mock within a point). Display **weight** moves from `font-bold` (700) to `font-semibold` (600) at every display call site — the closest loaded weight to the mock's 650 without an arbitrary value (S4).

**Motion:** `TOKENS.motion` gains `duration.wire` (38 000 ms, the mock's ticker loop) and `duration.pulse` (1 600 ms, the live chip). Radius: the mock's 980px pill is the existing `radius.pill` 999 — no change.

---

## Cluster A — the system

### Task 1 — the v3 palette and ramp in `tokens.ts`, proven by the existing gates

Files: `src/design/tokens.ts`, `src/design/tokens.test.ts` (value-level comments only — **no threshold edits**), `src/design/tokens.css` (regenerated), `src/design/generate-css.ts` only if a new token key needs emission (motion durations already emit).

- [ ] Write the failing state first: adjust `tokens.test.ts` **only** where a test names a v2 hex in a comment or asserts a v2-specific fact that is value-bound (audit of that file says there are none — every assertion is threshold-shaped; if that holds, this step is a no-op and says so in the commit body).
- [ ] Land the palette table above in `light`/`dark`, both `Pigments` packs re-derived, `TOKENS.font.display.xl = 58`, `TOKENS.motion.duration.wire`/`.pulse`. Run `npm run tokens:build`; the drift test pins the regenerated `tokens.css`.
- [ ] `npm test -- src/design` green — every contrast, hue and sticker assertion passing in both themes at the new values. Iterate values (never thresholds) until green.
- [ ] Verify: policy v4 + `npm run build` (tokens feed every route).

### Task 2 — the motion and ground vocabulary in `globals.css`

Files: `src/app/globals.css`, `docs/design-system.md` motion table row stubs (full rewrite is Task 11).

- [ ] Display tracking −0.028em (S3). Three new keyframes/classes against token variables, never literals: `animate-wire` (translateX marquee, `--commish-motion-duration-wire`, linear, infinite), `animate-pulse-live` (the live chip's dot, opacity 1→.35→1, `--commish-motion-duration-pulse`), `animate-rise` (the hero's entrance: opacity+14px translate, `base` duration, staggered by four delay utility classes `rise-1..4` derived from `fast`).
- [ ] Two ground classes for Task 7, spelled in tokens only: `.floodlight` (radial `accentGlow` washes per the mock's dark/daylight blocks — `accentGlow` is already an rgba token, no raw color enters the file) and `.yard-lines` (repeating-linear-gradient of `--commish-color-line` at the mock's 120px pitch and opacity, a `UI_CONFIG.frontDoor.yardLinePitchPx` value reaching CSS via the generated variables? No — self-ruling S5: the pitch is a CSS-only fact of one class in `globals.css`, exactly like the mock's; it is not feature-code and the no-raw-px rule sweeps `.tsx`, so it lives as a plain value with a comment naming the mock).
- [ ] The global reduced-motion block already flattens all three animations (safety net). The **deliberate** branches land with their components (Tasks 5, 7, 8): wire static, rise absent, pulse a solid dot.
- [ ] Verify: policy v4 + build.

### Task 3 — the caps charter: no capitals anywhere, enforced forever

Files: `src/components/ui/config.ts` (`EYEBROW`), `stat-pill.tsx`, `public-bar.tsx`, `top-bar.tsx`, the 22 `font-display`+`uppercase` and 21 hand-rolled uppercase call sites the audit inventories (`open-league-card.tsx`, `home-league-card.tsx`, `home-board.tsx`, `matchup-scoreboard.tsx`, `matchup-panel.tsx`, `league-terms-panel.tsx`, `open-seats-panel.tsx`, `public-league-list.tsx`, `src/app/page.tsx`, `seat-claim-steps.tsx`, `admin/queue/[flagId]/page.tsx`, `held-trade-detail.tsx`, `resolution-form.tsx`, `room-rail.tsx`, `tv-board.tsx`, `draft-board.tsx`), plus new `src/design/no-uppercase.source.test.ts`.

- [ ] **Test first:** `no-uppercase.source.test.ts`, built on `sourceFilesIn` (`src/design/test-support.ts`), sweeping the same directories as the raw-color sweep, failing on the string `uppercase` inside any `.tsx` **except** the two allowlisted files: `position-badge.tsx` and `crest.tsx` (S6: "QB" and "BB" are acronym data, not shouting prose; the class there guards against a lowercase data bug). The test lands red, listing every current offender — the audit's inventory verified mechanically.
- [ ] `EYEBROW` is redefined per the mock's section-label register: `font-mono text-xs tracking-wide` — sentence case, mono, quiet; callers keep supplying color. Every hand-rolled eyebrow spelling (E4's four variants) converges on `EYEBROW`: the admin queue's ten, held-trade's four, resolution-form's one, seat-claim-steps' numeral line, and the card's fact labels (which Task 5 then demotes further).
- [ ] `StatPill` drops its forced `uppercase` (chips read "Live", "Final", "Fix lineup"); wordmarks in `PublicBar`/`TopBar` go sentence-case "Commish" per the mock's nav; the draft board's "You" marker and the `tv` variant labels lose `uppercase` (weight and tracking stay). Every league/team/section heading loses `uppercase` while keeping `font-display` and moving `font-bold` → `font-semibold` (S4).
- [ ] Component tests updated where they assert a class list; DOM text is unchanged everywhere, so no copy assertion moves. Sweep test green.
- [ ] Verify: policy v4 (no build — class-level only).

### Task 4 — pill discipline: ink and quiet, one primitive, one budget

Files: `src/components/ui/button.tsx`, new `src/components/ui/button-link.tsx`, `index.ts`, new `src/design/accent-budget.source.test.ts`, and the eleven hand-rolled CTA call sites (E8's list: `src/app/page.tsx:92`, `invite-landing.tsx` ×2, `open-league-card.tsx:215`, `seat-hold-panel.tsx`, `league-board.tsx`, `home-league-card.tsx`, `sign-in/problem/page.tsx`, `not-found.tsx`, `global-error.tsx`, `budget-table.tsx` keeps its sanctioned `bg-accent/10` row tint).

- [ ] **Test first:** `accent-budget.source.test.ts` — same walker, failing on `bg-accent` in any swept `.tsx` outside the sanctioned primitives (`button.tsx` legacy check removed below, `meter.tsx`, `seat-meter.tsx`, `celebration.tsx`, `avatar.tsx`, `budget-table.tsx`), **and** failing on `bg-text-primary` outside `button.tsx`/`button-link.tsx` — so the ink pill can never be hand-rolled either. Red on the current eleven.
- [ ] `Button` restyles: `primary` becomes the **ink pill** — `rounded-pill bg-text-primary text-surface` (ink on ground: the mock's pill IS the text color inverted, which is why no new role is needed), hover via brightness; `secondary` becomes the **quiet pill** — `rounded-pill border border-edge bg-transparent text-text-primary` (edge, not line: a control boundary must clear 3:1); `destructive` keeps `bg-negative`; `ghost` unchanged. Focus ring stays `accent`.
- [ ] Extract `ButtonLink` (anchor form of `Button`, same variant/size source of truth — one class map, two elements; DRY by construction), refactor all eleven call sites onto it, applying **one ink action per view** as each is touched: `PublicBar`'s "Take a seat" is the front door's one ink pill and "Sign in" drops to a quiet text link (E11); error/404 pages keep their single CTA as ink (one action, one view — already compliant once restyled).
- [ ] Component tests for both primitives (variants, axe, both themes); sweep green.
- [ ] Verify: policy v4. **Cluster A checkpoint e2e:** `design-v2.spec.ts` + `whole-site.spec.ts` (the two that grab CTAs and headings by role — names unchanged, so expected green; any structural update named in the commit body).

---

## Cluster B — the public deep work

### Task 5 — the ledger card

Files: `src/league-room/components/open-league-card.tsx` (+test), `src/components/ui/seat-meter.tsx` (+test), `public-league-list.tsx` (legend row), `src/components/ui/config.ts` (`UI_CONFIG.openLeagueCard`), `MATCHMAKING_CONFIG` untouched.

The card becomes the mock's: sentence-case name at card size (16.5/600), one quiet format line, hairline-topped ledger rows, a segmented seat bar filling money-green, a live chip when something is genuinely live, one action.

- [ ] **Header:** name in `font-display text-lg font-semibold` sentence case (dense lg = 15–17px, the mock's card register); the `Badge` carries **only what the title does not** (E3): house cards show the rung, member cards show the stake — and the "Open 12-team" redundancy dies.
- [ ] **Format line (kills F1 outright):** one muted `text-sm` line, `·`-separated on ONE line — `"12 teams · Snake · Half PPR"` plus `"· newer players only"` when beginner-tier (Who folds in, S7) — with the format/scoring/median `InfoTip`s inline at `helpLevel` (below). The stacked `basis-full` list and its leading separators are deleted; a separator between items on one line separates something again.
- [ ] **Ledger rows,** each `flex justify-between border-t border-line py-1.5 text-sm`: **Drafts** (see clock below), **Entry** (value `Free` in `text-positive font-semibold` — real: every league is free this season, `stakeTierLabel` already says so), **Seats** (`"{open} of {total} open"` tabular), **Roster** (`rosterSummary`), **Playoffs** (`formatPlayoffWeeks`, `InfoTip` stays `standard`). Five rows, dense, comparable — the veteran's shopping facts survive the redesign (S7).
- [ ] **The clock (rule 6):** when a scheduled draft is within `UI_CONFIG.openLeagueCard.clockWithinMs` (self-ruled: 6h), the Drafts value renders the existing `Countdown` primitive (mono, `tone: hot` — live red) ticking beside its coarse `aria-live` sibling; otherwise the absolute `draftAt` string. `when_full` cards keep `describeStartTiming`'s sentence, now `text-text-muted` (E5 — `warning` is reserved for the clock tightening, and this sentence is reassurance).
- [ ] **Seat bar:** `SeatMeter` is redesigned from dots to the mock's segment bar — `total` equal flex segments, `filled` of them `bg-accent` (money = seats filling, rule 1), the rest `bg-surface-inset`, still `aria-hidden` beside the same `seatSentence` (unchanged — the sentence is the product's one seat voice and it survives verbatim). All nine callers get the segment look for free; callers' tests re-run.
- [ ] **Live chip:** a small client component inside the card file — `text-negative text-xs font-semibold` with a pulsing dot (`animate-pulse-live`; static under reduced motion). Two derived-only states from data already on the wire: `"Filling"` when remaining seats `> 0` and `< UI_CONFIG.seatMeter.lowSeatsThreshold` (the existing threshold — one source of truth), `"On deck"` when a scheduled draft is within `clockWithinMs`. No stored flag, no new field.
- [ ] **Guided captions (resolves D1, kills E7):** `OpenLeagueCard` and the shelf heading take `helpLevel: HelpLevel` as a prop; the unconditional `CARD_HELP_LEVEL`/`BROWSE_HELP_LEVEL` constants are deleted. Public pages pass `"standard"` (click-to-reveal `InfoTip` stays — the definition is one click away) **plus** Task 6's one legend line above the shelf. Signed-in `/browse` resolves the user's stored preference via `readPreferences` (`@/identity-service/preferences`, already the account room's read) so **guided remains a signed-in preference behavior** — a guided-preference member still gets inline captions.
- [ ] **CTA:** signed-out `SignInLink` and signed-in `JoinPublicLeagueButton` both render through Task 4's pill classes; `ctaAccessibleName` survives verbatim. Ink-vs-quiet is the **parent's** call (Task 6) — the card takes `emphasis: "ink" | "quiet"`, defaulting quiet.
- [ ] Tests first throughout: rendered-copy roster, axe in both themes, reduced-motion branch asserted both ways, `seatSentence` untouched proven by its existing tests.
- [ ] Verify: policy v4.

### Task 6 — the shelf: full width, three columns, one legend, one ink

Files: `src/app/page.tsx`, `src/app/browse/page.tsx`, `public-league-list.tsx` (+tests), `browse-filters.tsx` (restyle to quiet pills), `UI_CONFIG.frontDoor.shelfCap`.

- [ ] **Width (E2):** the front door's two `max-w-6xl` sections become full-width bands with the mock's `px` gutter from the spacing scale; `/browse` already full-bleed. Card grids gain the wide tiers: `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`.
- [ ] **One header (E3), fixed caption (F2):** the "Open leagues" band gets the mock's shelf head — title 22/650 sentence case, the house-league explainer as a plain full-row muted sentence beneath it (never a flex-wrapped caption fragment), the `seatCountsAsOfSentence` disclosure kept verbatim as the head's quiet sub. `HouseLeagueShelf` loses its own competing `h2`; house cards and member cards flow into one grid with the house rung badge doing the differentiating (the audit's "merge the two section headers into one").
- [ ] **Legend (D1's other half):** one line above the grid — `"New to these terms? Press any ⓘ for a plain answer."` — spelled with the real `InfoTip` affordance language, added to the copy roster.
- [ ] **One ink per view (D2 applied):** the shelf computes its single featured card — the nearest scheduled draft, else the fewest seats remaining — and passes `emphasis="ink"` to exactly one card; every other card's join is a quiet pill. A component test asserts "at most one ink pill per rendered list" directly.
- [ ] **The front door cap (D3, resolved as the audit sketched and the mock shows):** `src/app/page.tsx` renders the house shelf plus the first `UI_CONFIG.frontDoor.shelfCap` (self-ruled: 6) of the member list, followed by one quiet `ButtonLink` "See every open league" → `/browse`; `/browse` remains the full, filterable lobby. The 5,800px page dies here. `BrowseFilters` restyle to quiet pills (active = ink-bordered, not filled).
- [ ] "Start your own league" block: hairline-topped row (rule 4), quiet link — unchanged copy.
- [ ] Verify: policy v4 + build (routes touched).

### Task 7 — the front door: floodlight, yard lines, scoreboard

Files: `front-door-hero.tsx`, `seat-claim-steps.tsx`, `proof-strip.tsx` (+tests), `src/app/page.tsx`, `src/league-service/proof.ts` (+test — the one sanctioned service diff besides Task 8), `e2e/design-v2.spec.ts` (headline copy assertions, same commit).

- [ ] **Hero band:** a wrapper in `page.tsx` carrying `.floodlight` and `.yard-lines` (Task 2), `animate-rise` staggers on the hero's children (absent under reduced motion — asserted).
- [ ] **Headline (E6 + Spec):** adopts the mock verbatim — `"Real leagues. Real seats. Drafting this week."` with the closing phrase in `text-positive` — at `text-display-md sm:text-display-xl` (the responsive step E6 demands; display-xl is now 58). The sub adopts the mock's sentence; `"Every league is free this season."` renders in money per the mock's `.free`; `"No account is needed to look."` survives as a detail line (S8 — it answered a persona concern and costs one quiet line). **The e2e headline assertions update in this commit, named in the body.**
- [ ] **Steps:** hairline-topped columns (`border-t border-line`), numerals in quiet mono (`EYEBROW` + `text-text-faint`) per the mock — the accent numerals die (E4's "labels and values compete" at hero scale). Copy unchanged: `"1 · 10 seconds"` timing spellings come from the mock, sentence case.
- [ ] **Scoreboard (Spec):** `ProofStrip` re-renders as the mock's score chips — hairline-bordered `rounded-lg` chips, mono 22 tabular numbers, label in quiet 12.5 — `leaguesFilled` ink, `draftsNext48h` with `text-negative` number (the live count), rating chip keeps its `/reviews` link. Floors and `stats.any` behavior untouched. **Third mock chip ("next draft tonight"):** `proof.ts` gains `nextDraftAtQuery` — `min(kickoff_at)` over scheduled drafts joined on `ENFORCED_LEAGUE_SQL` (read-only, same privacy join as `draftsNext48h`) — rendered as a chip only when it falls inside `MATCHMAKING_CONFIG.proof`'s new `nextDraftWithinMs` window (self-ruled: 24h) with a coarse time, else omitted. Real or absent, never dressed up.
- [ ] Verify: policy v4 + build.

### Task 8 — the wire: real events under the nav

Files: new `src/league-service/wire.ts` (+test, gate 17 — the sanctioned new read), `src/matchmaking/contract.ts` (`WireItem`), new `src/league-room/components/wire.tsx` (+test), `src/app/page.tsx`, `src/app/browse/page.tsx`, `UI_CONFIG.wire` + `MATCHMAKING_CONFIG.wire`.

**Feed contract — real sources only, all of them already in the product:**

| item kind | source (verbatim, existing) | sentence shape |
|---|---|---|
| `seat_claimed` | `audit_events` rows, `event_type = 'member_joined'`, joined to leagues through `ENFORCED_LEAGUE_SQL` and filtered to **public** leagues, within `MATCHMAKING_CONFIG.wire.windowMs` | `"A seat was claimed in {league} · {coarse ago}"` |
| `league_filled` | public leagues where `filledTeams === teamCount` whose draft is `scheduled`/`in_progress`, ordered by fill recency | `"{league} filled · drafting soon"` / `"· drafting now"` when `in_progress` |
| `draft_tonight` | scheduled drafts with `kickoff_at` inside the window, same enforced-public join | `"{league} drafts at {time}"` |
| `season_count` | `proofStats.leaguesFilled` (already floored and cached) | `"{n} leagues filled this season"` |

- [ ] **No names (S9, privacy self-ruling):** the mock shows "Marcus claimed a seat"; this product does not put a member's display name on an anonymous marketing surface, so every sentence above is actor-free. Recorded as a deliberate deviation from the mock's literal copy, not from its idea.
- [ ] **No anonymous SSE (deferral D4 stands):** both consuming pages are `force-dynamic`; `listWireItems(db, clock)` runs at request time and the wire renders **request-time truth with coarse timestamps** — the marquee is CSS (`animate-wire`), not a socket. The docblock says so, the way `seatCountsAsOfSentence`'s already does.
- [ ] `listWireItems` merges the four reads (one `Promise.all`, the `proofStats` idiom), caps at `MATCHMAKING_CONFIG.wire.maxItems`, coarse-formats times via the existing `formatCoarseDuration` family — and returns `[]` rather than padding when quiet.
- [ ] `Wire` component: `surfaceInset` band under `PublicBar`, mono `text-xs`, `money` tint on `league_filled`, `live` tint on urgent seat counts; the track duplicated once for the CSS loop with the duplicate `aria-hidden`; the accessible form is a visually-available static list (`role="list"`, `aria-label` "Recent activity"); reduced motion renders the first items as a static row, no scroll (both branches asserted). **Fewer than `UI_CONFIG.wire.minItems` (self-ruled: 3) real items → the component renders `null`** — a quiet product shows a clean hairline, never filler.
- [ ] Mounted on `/` and `/browse` (signed-out branch) per the Spec. Copy roster + axe + both themes.
- [ ] Verify: policy v4 + build. **Cluster B checkpoint e2e:** `design-v2.spec.ts`, `whole-site.spec.ts`, `formats-and-lobby.spec.ts`, `onboarding.spec.ts`, `mobile-360.spec.ts` (the five that walk the rebuilt surfaces).

---

## Cluster C — the sweeps

### Task 9 — the signed-in sweep: palette, caps residue, one ink per surface

Files: `home-board.tsx`, `league-board.tsx`, `home-league-card.tsx`, `attention-queue.tsx`, `matchup-scoreboard.tsx`, `matchup-panel.tsx`, `open-seats-panel.tsx`, `league-terms-panel.tsx`, admin `held-trade-detail.tsx`/`resolution-form.tsx`/queue page, draft-room `room-rail.tsx`/`tv-board.tsx`/`draft-board.tsx` (+tests). Most caps edits landed in Task 3; this task is the button budget and the per-surface look.

- [ ] **E12:** `league-board.tsx`'s per-row ink fills become quiet pills; the locker room's **one ink action** is the attention queue's top item (the surface's genuinely most urgent act — S10); `home-league-card.tsx`'s CTA follows the same rule on the single-league home (its one card's action is the view's ink).
- [ ] Ledger-row and hairline treatments applied where a signed-in card mirrors the public one (`home-league-card` facts) so the two shelves read as one product; `Meter`/`SeatMeter` consumers re-verified on the new palette.
- [ ] Draft room and TV board: retone only — the room's structure, bands and animations are untouched (they already obey rules 4 and 6); `Countdown` `tone: hot` now reads live-red by token change alone.
- [ ] Verify: policy v4.

### Task 10 — the remaining public surfaces

Files: `src/app/reviews/page.tsx` (+ its components), `src/app/league-rules/page.tsx`, `support`, `legal/*`, `sign-in/problem`, `error.tsx`, `not-found.tsx`, `global-error.tsx`, `invite-landing.tsx`, `seat-hold-panel.tsx`, `waiting-room.tsx` spot-checks (+tests).

- [ ] **E9:** each review renders as a hairline-bounded row — reviewer, body (`max-w-prose` kept), and "Report" right-aligned **inside** the same row, attached to what it reports.
- [ ] **E10:** `/league-rules` prose drops its seven inline `InfoTip` triggers; terms link to the glossary entries rendered as a terms section on the same page (a reading page reads; the definition is one anchor away). `InfoTip` itself is untouched.
- [ ] Hold interstitial, invite landing, sign-in problem, 404 and error surfaces: pill and palette compliance (mostly free after Tasks 1–4), one ink per view each, both themes.
- [ ] Verify: policy v4 + build (route files touched). **Cluster C checkpoint e2e:** `league-lifecycle.spec.ts`, `season.spec.ts`, `live-scoring.spec.ts`, `trades.spec.ts`, `enforcement.spec.ts` (the signed-in walks), plus re-run of any Cluster B spec a Task 9/10 diff touched.

---

## Cluster D — the record

### Task 11 — the design doc speaks v3

Files: `docs/design-system.md`, new `docs/decisions/design-v3.md`, `docs/research/sunday-standard.html` (the Spec archived verbatim), `docs/research/2026-08-24-ux-remediation-audit.md` (merged from `audit/ux-remediation` unchanged).

- [ ] Rewrite `docs/design-system.md` around the six rules: the palette section names the new role meanings (money/live vocabulary), the caps charter (allowlist: position and crest acronym data only), the pill discipline and the one-ink-per-view law with its two sweep tests named as enforcement, the wire's honesty contract, the type ramp, and the unchanged laws (no-raw-color, both themes, copy register, motion-with-intent, InfoTip, SeatMeter's sentence). Every claim in the doc points at the test that enforces it or says "review-enforced".
- [ ] `docs/decisions/design-v3.md` records the founder approval, the self-rulings S1–S10 below, and the finding-to-task closure table.
- [ ] Verify: policy v4 (docs + no code).

### Task 12 — the closing battery and the persona checkpoint

- [ ] Full e2e suite once (this is the phase-end battery the checkpoints built toward — the only full run, sanctioned by the checkpoint structure, not a per-task habit), both viewport projects.
- [ ] Contrast spot-verification in the browser at both themes on `/`, `/browse`, the locker room and the draft room (the numeric gate already proved the tokens; this is the rendered sanity pass).
- [ ] **Persona checkpoint (founder-delegated adjudication, per the standing rule):** the standard panel — veteran, casual, commissioner, first-timer, plus the phone user and the skeptic the audit added — walks `/`, `/browse`, a card, the wire and the locker room against the founder's bar and the six rules. Findings are triaged in-phase (EXECUTION-class fixed here; anything DIRECTION-class is founder-gated and queued, not silently absorbed). The panel's verdicts are appended to `docs/decisions/design-v3.md`.
- [ ] Roadmap note: Phase 3.7 recorded as the founder-ordered remediation pass; Phase 4 unchanged.

---

## Self-rulings (delegated design calls, recorded per the standing rule)

- **S1 — role survival:** `warning` and `info` keep their roles and get retuned values; the six-color rule governs what the public surfaces *use*, the nineteen-role set stays frozen. `negative` and live are one red family, jobs separated by context exactly as `accent`/`positive` already are.
- **S2 — ink pill spelling:** the solid pill is `bg-text-primary text-surface` — ink on ground needs no new role, and the accent-budget sweep bans the spelling outside the two button primitives.
- **S3 — display tracking** moves to −0.028em on display sizes only; body tracking untouched.
- **S4 — weight 650 → 600:** `font-semibold` everywhere the mock says 650; no arbitrary-value weights.
- **S5 — yard-line pitch** lives as a plain CSS value in `globals.css` beside the mock reference; it is one class's geometry, not feature code.
- **S6 — caps allowlist:** `position-badge.tsx` and `crest.tsx` only. StatPill, wordmark, TV labels and the "You" marker all go sentence case.
- **S7 — card facts:** five ledger rows (Drafts, Entry, Seats, Roster, Playoffs); Who folds into the format line. The mock's three rows plus the audit's veteran facts, reconciled in the denser direction.
- **S8 — hero copy:** mock headline and sub adopted verbatim; "No account is needed to look." kept as a detail line.
- **S9 — the wire is actor-free:** no member names on anonymous surfaces; deviation from the mock's literal ticker copy, recorded.
- **S10 — one ink on the locker room** is the attention queue's top action; table rows are quiet.

**Founder-gated (not decided here):** nothing in this plan requires founder input to execute. Two things are flagged for his awareness, not approval: the hero headline change (adopting his own approved mock's copy) and the wire's actor-free deviation (S9).

## Refused / deferred

- **Anonymous SSE for the public wire** — deferral D4 stands; the wire is request-time truth by design (Task 8's docblock).
- **A lobby table (`/browse` as a sortable Table)** — the audit's Direction 2; compatible with v3 and genuinely wanted by the veteran, but a second IA change stacked on this one. Deferred to its own piece of work, recorded in `design-v3.md`.
- **Per-view accent counting as a static test** — a source sweep cannot see a view; the sweep bans the *spellings* (S2, Task 4) and the per-view budget is enforced by component tests where a list owns it (Task 6) and by review plus the persona checkpoint elsewhere.

## Audit finding → task map

| finding | closed by |
|---|---|
| D1 guided-caption repetition | Task 5 (+ legend, Task 6) |
| D2 accent budget | Tasks 4, 5, 6, 9 |
| D3 instance-dump front door | Tasks 6, 7 |
| E1 uppercase names/headers | Task 3 |
| E2 width / grid tiers | Task 6 |
| E3 badge and header redundancy | Tasks 5, 6 |
| E4 eyebrow fragmentation | Task 3 (+ 7's step numerals) |
| E5 amber when-full sentence | Task 5 |
| E6 hero responsive step | Task 7 |
| E7 InfoTip caption misalignment | Task 5 (dies with D1) |
| E8 hand-rolled CTA duplication | Task 4 |
| E9 uncontained review row | Task 10 |
| E10 inline tips in prose | Task 10 |
| E11 two green nav CTAs | Task 4 |
| E12 per-row table fills | Task 9 |
| F1 orphaned leading separators | Task 5 |
| F2 floating heading caption | Task 6 |
