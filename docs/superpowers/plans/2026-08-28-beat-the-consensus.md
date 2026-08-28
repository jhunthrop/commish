# Beat the Consensus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Beat FantasyPros' expert consensus on preseason rank correlation, on both held-out seasons. Not match it. Beat it.

**Founder, 2026-08-28:** *"Your job is to make something better than the human experts. Don't come back to me and say you can't do it."*

**The gap, measured** (`docs/research/2026-08-27-preseason-board.md`), rank correlation vs actual season points, 12-team PPR:

| season | ECR | our board (points-ordered) | gap |
|---|---|---|---|
| 2023 | 0.7387 | 0.6190 | **0.1197** |
| 2024 | 0.7725 | 0.7272 | **0.0453** |

And against the real market (FFC ADP, dated pre-opener) we are already level: 0.4752 vs 0.4723 (2023), and **ahead** at 0.4296 vs 0.4272 (2024). The market is not the wall. Consensus is, and only just.

**Why this is winnable, and not a stretch.** Every one of the four leads below is a defect WE measured and wrote down, not a hypothesis. Three have known fixes. The first two are free.

## Global Constraints

- **The two-season rule holds.** A change ships when it improves held-out rank correlation on 2023 AND 2024. One season is noise, however much we want it.
- **Never fit on a held-out season.** `fit.ts` throws if pointed at one — keep it that way. Improve on the FIT seasons, measure on the held-out ones, and if the gap closes only on the seasons you tuned, you have learned nothing.
- **Report against ECR every time**, overall and per band. The deep band (151-400) is the one we lose on both seasons and the one the spec claimed; it is the scoreboard that matters.
- Point-in-time discipline throughout. The preseason moment is 1 ms before the earliest stamp a season carries and the structural test pins it — a board must stay byte-identical when the target season is written at 4x volume.
- Metrics from `src/projections/metrics.ts`. Migrations generated, never amended. No em-dashes in script output.

---

### Task 1: Order the board by points, not VOR — FREE, ALREADY MEASURED

Phase 6 measured it and shipped the losing order anyway: points 0.6839 vs VOR 0.6559 (2023), 0.7385 vs 0.7075 (2024), and points wins in almost every band against both benchmarks. Phase 5 found the mechanism — VOR amplifies board error, and our board still has error to amplify.

- [ ] **Step 1:** Make the shipped board's default ordering points-based; keep VOR available and clearly labelled as the draft-value view, since replacement level is still the right idea for a DRAFT even when it loses on raw ranking.
- [ ] **Step 2:** Re-measure against ECR. Record the new gap.
- [ ] **Step 3: Commit** `feat(preseason): order the board by points, because that is what measured better`

### Task 2: Rank rookies by draft capital until the model beats it — FREE, ALREADY MEASURED

Our rookie priors measure **worse than sorting the class by draft pick alone**: 0.6374 → 0.3733 (2023) and 0.6790 → 0.6459 (2024). The landing-spot term destroys more information than it adds. A first-round back is a first-round back.

- [ ] **Step 1:** Replace the rookie ordering with draft-capital order as the baseline. Keep the landing-spot model behind a flag, off.
- [ ] **Step 2:** Ablate on the rookie segment. It must beat 0.6374/0.6790 or it does not ship. **Any further rookie modelling must be developed and tuned on the FIT seasons only.**
- [ ] **Step 3: Commit** `feat(preseason): rookies rank by draft capital, which beat the model`

### Task 3: Map the captured depth charts and injury designations — THE DEEP BAND

This is what consensus knows that we do not, and it is already on disk. `capture_snapshots` holds `tank01_depth_charts` and `tank01_injuries` as raw payloads, unmapped. An expert in August knows who is behind whom and who is hurt in camp; our board knows neither.

- [ ] **Step 1:** Map depth-chart position into the preseason store, with the capture's own `captured_at` as `as_of`. It is a weak prior in-season and a STRONG one in August, which is the opposite of the weekly case — measure it on its own terms.
- [ ] **Step 2:** Map camp injury designations the same way.
- [ ] **Step 3:** Feed both into the preseason opportunity prior. Ablate **on the deep band specifically** — that is the segment being targeted and the overall number will move less.
- [ ] **Step 4: Commit** `feat(preseason): depth charts and camp injuries, the two things August knows`

### Task 4: The per-player replay moment — UNBLOCKS TWO FEATURES AT ONCE

Model v3's finding: four fifths of the injury wire is unreachable by ANY whole-week replay moment, because such a moment must precede Thursday night's kickoff while the league files on Friday. The fix is a change to `backtest.ts`, not a constant: replay each player at **his own game's kickoff** rather than the week's earliest.

- [ ] **Step 1:** Make the replay moment per player. The leakage test must still pass — a player's projection may see nothing stamped after HIS kickoff.
- [ ] **Step 2:** Re-run the news ablation. It measured elite 0.0694 → 0.0906 and starter 0.1750 → 0.1937 at the game-week moment with only 15-19% of designations reachable. At full reachability it should be larger.
- [ ] **Step 3:** The same change unblocks the pre-kickoff betting line Phase 3 had to refuse as unmeasurable. Re-run that ablation too.
- [ ] **Step 4: Commit** `feat(projections): each player is replayed at his own kickoff`

### Task 5: Report — against ECR, honestly

- [ ] `docs/research/2026-08-28-beating-consensus.md`: the board against ECR and ADP, overall and per band, on both held-out seasons, with each task's contribution isolated.
- [ ] **If we beat consensus on both seasons, say so plainly and show the working.** If we beat it on one, say that and name what is missing. If we have closed the gap but not crossed it, report the number and the next lead — there are more: per-game distributions, target competition, and the fifth season the backfill could not reach.
- [ ] **Commit** `docs(projections): the board against expert consensus`

## Self-review notes

- Tasks 1 and 2 are pure subtraction — removing two things that measured worse than the obvious alternative. Do them first and re-measure before touching anything else; the gap may be much smaller than 0.1197 once they land.
- Task 3 is the one that targets the actual losing segment.
- Do not tune against 2023 or 2024. The whole value of this exercise is that the number at the end is trustworthy.
