# Projection Engine — Phase 2: The First Model

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first thing that can be right or wrong — an opportunity model, composed into component projections, scored against the naive floor. Phase 2 ends with a number: does our model beat prior-season points per game, and in which rank bands.

**Spec:** `docs/design/2026-08-27-projection-engine-spec.md` — layers 1 through 3 and the "how it learns" section. Read it first.

**Phase 1 delivered** (commits `ebc2687`…`e234545`): the point-in-time store, nflverse participation ingestion with a crosswalk, opportunity *features* (pure functions), the backtest replay, the naive benchmark, and the capture job. The measured floor is in `docs/research/2026-08-27-naive-baseline.md`.

**The floor to beat, 2024 PPR:** overall rho **0.566**, MAE 5.14, n=4,734. By band: elite 0.045, starter 0.279, deep 0.259, fringe 0.100. Weekly rho decays 0.679 (wk 1) → 0.436 (wk 18) — **that decay is the opportunity, because it is where last season stops describing this one.**

**Architecture:** Layer 1 (opportunity) predicts *shares*; layer 2 (efficiency priors) regresses per-player rates toward role means; layer 3 composes them into a predicted `StatLine`, which `computeFantasyPoints` turns into points per league. No new domain types.

**Tech Stack:** as the repo. Branch `worktree-projection-engine` (already exists, synced to main), worktree `.claude/worktrees/projection-engine`. No e2e.

## Global Constraints

- **Point-in-time or it is worthless.** Every read goes through `observationsAsOf`. A model that trains on a week it is predicting is worthless and will look excellent, which is the trap.
- **Beat the floor or say so plainly.** A model that loses to prior-season PPG is a finding, not a failure — report it and stop rather than tuning until the number looks good. Tuning against the test set is the other way this work fools itself.
- **Two independent seasons or it is noise.** No feature ships on a single season's improvement.
- Metrics come from `src/projections/metrics.ts`. Never write a second correlation.
- `StatLine` / `computeFantasyPoints` already exist. A projection is a predicted `StatLine`.
- Migrations generated, never amended.
- Never touch `/Users/jh/code/fantasy`'s working tree or another worktree.

---

### Task 1: A historical player universe

**Why first:** Phase 1 measured the crosswalk at 98.1% for 2024 but **87.1% for 2023**, and it degrades the further back you go — because `players` is a *current* roster snapshot, so anyone retired is genuinely absent. A model needs multiple seasons, so this blocks everything else.

**Files:** `src/projections/nflverse/players.ts` + test; a migration if a `historical_players` table is the right shape (read Phase 1's store first — an observation-style table may already suffice).

- [ ] **Step 1:** Failing test — a 2019 player who has since retired resolves.
- [ ] **Step 2: RED.**
- [ ] **Step 3:** Resolve against nflverse's own player release (or Tank01 `gsis_id`/`fRefID`) instead of today's roster. Keep Phase 1's coherence check that refuses when two names claim one id — it caught a real bug.
- [ ] **Step 4:** Re-measure resolution for every season you intend to backfill. **Report the rate per season in the commit message.** If any target season lands below 95%, say so rather than proceeding quietly.
- [ ] **Step 5: Commit** `feat(projections): resolve players against a historical universe, not today's roster`

### Task 2: Backfill

- [ ] Backfill participation and weekly stats for **at least five seasons** (2019→2024 if resolution allows). Five is the floor for holding two seasons out and still having enough to fit on.
- [ ] Record row counts and per-season resolution in `docs/research/2026-08-27-naive-baseline.md` (append, do not rewrite Phase 1's numbers).
- [ ] **Commit** `feat(projections): backfill five seasons of participation and outcomes`

### Task 3: The opportunity model — THE KEYSTONE

**Files:** `src/projections/model/opportunity.ts` + test

**Interfaces:** Produces `predictOpportunity(history, context, { asOf })` → predicted snap share, route participation, target share, carry share, red-zone share for a player-week.

- [ ] **Step 1: Failing tests.** Include the structural ones, not just arithmetic: the prediction for week N must be identical whether or not week N+1 exists in the store (the leakage test), and a player with no history must produce a role-based prior rather than throwing.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement.** Start deliberately simple — a weighted rolling average of recent share with regression toward a role/depth-chart prior beats a complex model you cannot debug, and it is the honest baseline for layer 1. Add complexity only where a measured segment demands it.
- [ ] **Step 4:** Score opportunity **directly against usage actuals** before it ever touches points. If share prediction is not better than "last week's share", nothing downstream can be.
- [ ] **Step 5: Commit** `feat(projections): the opportunity model — the keystone layer`

### Task 4: Efficiency priors and component composition

**Files:** `src/projections/model/efficiency.ts`, `src/projections/model/compose.ts` + tests

- [ ] **Step 1: Failing tests.** The load-bearing one: **touchdown rate must regress harder than any other rate.** TD variance is where amateur models overfit and look confident and wrong by week six. Pin that the regression is strictly stronger for TDs.
- [ ] **Step 2: RED.**
- [ ] **Step 3:** Implement. Compose opportunity × efficiency into a predicted `StatLine`. Points come from `computeFantasyPoints` with the league's real rules — never a hardcoded PPR sum.
- [ ] **Step 4: Commit** `feat(projections): efficiency priors and component composition`

### Task 5: Score it, and say what happened

**Files:** `src/projections/benchmarks/` (register the model as a source), `scripts/projection-report.ts` (extend), `docs/research/2026-08-27-model-v1.md`

- [ ] **Step 1:** Replay 2024 with the model as the source. Hold out at least one season entirely from fitting.
- [ ] **Step 2:** Report overall and per-band rho/MAE/RMSE **beside the naive floor**, plus the weekly decay curve — the naive model decayed 0.679→0.436; whether ours flattens that curve is the most informative single result in the phase.
- [ ] **Step 3:** Write `docs/research/2026-08-27-model-v1.md`. Include what got WORSE. A per-band table where one band regressed is more useful than an average that hides it.
- [ ] **Step 4: Commit** `docs(projections): model v1, measured against the floor`

## Self-review notes for the executor

- If the model loses to naive, that is the finding. Write it up and stop. Do not tune against the test set until the number looks good — that is the most expensive mistake available here, because it produces a number nobody can trust and you cannot tell from the inside.
- The elite band's naive rho is 0.045. Beware reading that as easy headroom: within-band correlation is depressed by range restriction (Phase 1's doc explains it). Compare band to band, never band to overall.
- Phase 2 ships no product surface. If you are editing `src/draft-room/**` or `src/league-room/**`, you have left the plan — two other agents own those right now.
