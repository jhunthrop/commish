# Projection Engine — Phase 6: The Preseason Board

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Automate what FantasyPros' experts produce — **season-long player rankings published before any games are played.** Founder, 2026-08-27: *"I'm trying to automate what the 'experts' on fantasy pros provide. Performance rankings for the season on how players are ranked before any games are played."*

This is the commercial centre of the product. It is what people already pay for, what "your board" in the tiering matrix needs a baseline for, and what a manager sees first every August.

**Why it is its own phase.** Every technique in Phases 2 and 3 leans on recent usage. In August there is none — zero snaps, zero targets from the season being predicted. The preseason board runs on different fuel and needs three models the weekly engine does not: availability, offseason change, and rookies.

**Dependency:** Phase 2 (projections), Phase 3 (context, especially redistribution and scheme), and Phase 5 Task 1 (replacement level — a board is ranked by value over replacement, not by points).

## Global Constraints

- **Strict week-zero discipline.** A backtested 2024 board may see nothing dated after the 2024 season opener. This is the leakage rule at its most dangerous, because offseason data is messy and dates are easy to lose.
- Rank by **value over replacement**, never raw projected points. A board that ranks a quarterback above a back because he scores more is not a draft board.
- The board is produced **per league format**, from the league's own scoring and roster shape. Generic sites approximate superflex and TE-premium; we compute them.
- Every rank carries its reasons — the explanation surface is not optional here, it is the product.
- Never touch `/Users/jh/code/fantasy`'s working tree, `src/draft-room/**` or `src/league-room/**`.

---

### Task 1: Availability — the most-ignored driver of season value

**Files:** `src/projections/preseason/availability.ts` + test

Season totals are dominated by games played. A back who misses four games loses a quarter of his value however good he is per game, and most published rankings model this barely or not at all.

**Interfaces:** `expectedGamesPlayed(player, { season })` → a distribution, not a number.

- [ ] **Step 1: Failing tests.** Position matters (backs are hurt more than receivers, receivers more than quarterbacks); age matters; prior injury history matters. Pin that a 30-year-old back with two injured seasons projects fewer games than a 24-year-old with none, and that the output is a distribution so downstream ceiling/floor is honest.
- [ ] **Step 2: RED.**
- [ ] **Step 3:** Implement from the historical record already in the store — games played per player-season, with age and position. Regress hard: injury is famously noisy year to year, and a model that treats one lost season as destiny will be wrong in the expensive direction.
- [ ] **Step 4: Ablate** against a board that assumes 17 games for everyone. Report the difference. **This is the cheapest large win available in the phase.**
- [ ] **Step 5: Commit** `feat(projections): expected games played — the driver most preseason rankings ignore`

### Task 2: The offseason delta

**Files:** `src/projections/preseason/offseason.ts` + test

In August the signal is almost entirely **change**. A player on the same team in the same role with the same coordinator is a prior; everyone else needs adjusting.

- [ ] **Step 1: Failing tests** on real historical cases:
  - a receiver whose team lost its primary target should project a larger share
  - a back who signed somewhere with an entrenched starter should project a smaller one
  - an offence with a new play-caller should shift toward that caller's pace and pass rate (Phase 3's scheme work), not the team's history
- [ ] **Step 2: RED.**
- [ ] **Step 3:** Implement by composing Phase 3's redistribution and scheme features against the offseason transaction log, rather than writing new logic. **If you are reimplementing redistribution here, stop — consume it.**
- [ ] **Step 4: Ablate and commit** `feat(projections): the offseason delta — change is the whole signal in August`

### Task 3: Rookies

**Files:** `src/projections/preseason/rookies.ts` + test

A rookie has no NFL history. Draft capital is the single best predictor of his usage, because where a team spent a pick tells you the role they intend before any evidence exists.

- [ ] **Step 1: Failing tests.** A first-round back projects materially more opportunity than a fifth-round back on the same depth chart. Landing spot matters — the same player behind an entrenched starter projects less. And the output must be **wider** than a veteran's: rookie uncertainty is genuinely larger and the distribution should say so rather than pretending to a precision we do not have.
- [ ] **Step 2: RED.**
- [ ] **Step 3:** Implement from draft capital, depth chart and the vacated opportunity on their new team. College production is a possible later input; do not add it in this task, because it is a separate data acquisition and this task must be measurable without it.
- [ ] **Step 4: Ablate** specifically on the rookie segment — the overall number will barely move and that is expected. **Judge it where it applies.**
- [ ] **Step 5: Commit** `feat(projections): rookie priors from draft capital and landing spot`

### Task 4: The board

**Files:** `src/projections/preseason/board.ts` + test

**Interfaces:** `preseasonBoard({ season, leagueSettings, asOf })` → every player ranked by value over replacement, with tiers, reasons, and a floor/ceiling.

- [ ] **Step 1: Failing tests.** Composition: season points = expected games × per-game opportunity × efficiency, per component, through the league's real scoring. Ranking by VOR (Phase 5 Task 1) rather than points — pin the quarterback-versus-back case again here, at board level. Tiers fall out of the distribution: a cliff is where the gap between adjacent players exceeds their overlap, not a hand-drawn line.
- [ ] **Step 2: RED, implement.**
- [ ] **Step 3:** Reasons attached per player, structured, drawn from the features that moved them — never generated prose.
- [ ] **Step 4: Commit** `feat(projections): the preseason board — ranked by value over replacement, in your league's scoring`

### Task 5: Score it against the experts

**Files:** `docs/research/2026-08-27-preseason-board.md`, extend `scripts/projection-report.ts`

**This is the task that decides whether the phase was worth doing.**

- [ ] **Step 1:** Generate preseason boards for at least two past seasons using **only** information dated before that season's opener.
- [ ] **Step 2:** Score against actual season-long outcomes, alongside that year's real **ADP** and **ECR** where obtainable. Rank correlation overall and per rank band, plus the deep band specifically — beating consensus at 150-400 is where a manager actually wins a league.
- [ ] **Step 3:** Report honestly. **If consensus beats us, say so, publish the number, and name which segment we lost.** Expert consensus is only modestly accurate at preseason ranking — the horizon is long and the information thin — so this is winnable, but a flattering write-up is worth nothing.
- [ ] **Step 4: Commit** `docs(projections): the preseason board against ADP and expert consensus`

## Self-review notes

- Availability is the cheapest large win and the easiest to skip. Do not skip it.
- Every task ablates on the segment it targets. Rookies will not move the overall number; judge them on rookies. Redistribution will not move it either; judge it on players whose situation changed.
- The temptation is to hand-tune the board until it "looks right" against this year's consensus. That is fitting to the thing we are trying to beat, and it destroys the only evidence that we did.
