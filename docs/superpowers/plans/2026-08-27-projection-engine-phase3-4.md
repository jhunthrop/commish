# Projection Engine — Phase 3 (context) and Phase 4 (the news pass)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the model actually intelligent — the founder's own list: *"coaching changes, offensive line ratings, QB accuracy, trading to a new team, breakout potential because a WR was traded away and now a new person is #1."* Phase 2 built the usage engine. These phases add the context that explains WHY usage moves, and then the reporting layer that catches what numbers cannot.

**Spec:** `docs/design/2026-08-27-projection-engine-spec.md` — layers 2, 4 and 5.

**The rule that governs both phases:** every feature group is added ONE AT A TIME and ablated. A feature that does not improve held-out rank correlation across **two independent seasons** does not ship, however good the story for it is. This is the entire reason Phase 2 came first: you cannot measure an addition without something to add it to.

**Dependency:** Phase 3 requires Phase 2's model and `docs/research/2026-08-27-model-v1.md`. Phase 4 requires Phase 3. These are genuinely sequential — do not parallelise them.

## Global Constraints

- Point-in-time on every read. A context feature that leaks is worse than no feature.
- One feature group per commit, each with its own measured ablation in the commit message. `rho before → rho after`, on held-out seasons, or it does not land.
- Metrics from `src/projections/metrics.ts`. `StatLine`/`computeFantasyPoints` unchanged.
- Never touch `/Users/jh/code/fantasy`'s working tree, `src/draft-room/**` or `src/league-room/**`.

---

# PHASE 3 — Context

### Task 1: The offensive line composite

The founder asked for line strength and ruled (2026-08-27) that PFF grades are **development-time calibration only, never a runtime dependency**. So we derive our own from free data.

**Files:** `src/projections/features/line.ts` + test

- [ ] **Step 1:** Build from play-by-play and Next Gen Stats already in the store: **adjusted line yards** (rushing yards attributed to the line rather than the back, by distance), **stuffed rate** (runs stopped at or behind the line), **sack rate allowed**, **time to throw**, and **continuity** — games with the same five starters, which is pure snap-participation data and among the better-known predictors.
- [ ] **Step 2:** Feed it into efficiency priors (layer 2): a back behind a good line converts opportunity better.
- [ ] **Step 3: Ablate.** Report `rho before → after`, overall and per band. **If it does not earn its place, say so and leave it out.**
- [ ] **Step 4: Commit** `feat(projections): a derived offensive line composite — ours, not licensed`

### Task 2: Scheme, pace and coaching changes

**Files:** `src/projections/features/scheme.ts` + test, plus a small curated table

- [ ] **Step 1:** Compute per team from play-by-play: situation-neutral **pace** (plays per minute with the game close) and **pass rate over expected** — how much a coordinator throws relative to what the down, distance and score suggest. Both are the numeric fingerprint of a scheme.
- [ ] **Step 2:** The curated part: play-caller by team-season. Thirty-two rows a year. This is what makes a **coaching change** legible — when the play-caller changes, the prior for that offence's pace and pass rate should shift toward the new caller's history rather than the team's.
- [ ] **Step 3:** Feed into layer 1: pace and pass rate set the size of the pie every player's share is drawn from.
- [ ] **Step 4: Ablate and report.**
- [ ] **Step 5: Commit** `feat(projections): scheme, pace and the coaching-change prior`

### Task 3: Opportunity redistribution — the trade case

**This is the founder's own example and the most valuable feature in the phase:** a receiver leaves, his target share vacates, and somebody becomes the new number one.

**Files:** `src/projections/features/redistribution.ts` + test

- [ ] **Step 1: Failing test** built on a real historical trade — a departure, and who actually absorbed the work. The test is the specification.
- [ ] **Step 2:** Implement. When a player's snaps go to zero (trade, injury, release), redistribute their share across remaining teammates weighted by role proximity (same position group, depth chart, historical usage when that player sat), not evenly.
- [ ] **Step 3:** The reverse case too — an arrival compresses everyone else's share.
- [ ] **Step 4: Ablate**, and specifically measure the **post-transaction segment** rather than the average. A feature that fixes exactly the situations it was built for, and is neutral elsewhere, is a success — the overall number will barely move and that is expected.
- [ ] **Step 5: Commit** `feat(projections): opportunity redistributes when a player leaves`

### Task 4: Game context

**Files:** `src/projections/features/context.ts` + test

- [ ] **Step 1:** Opponent defence adjusted for the offences it has faced (a defence that looks elite having played four bad offences is not elite). Implied team total and spread from Tank01 betting odds — the best available proxy for game script. Weather where it matters. Rest and bye.
- [ ] **Step 2: Ablate and report.**
- [ ] **Step 3: Commit** `feat(projections): game context — opponent, script, weather, rest`

### Task 5: Phase 3 report

- [ ] `docs/research/2026-08-27-model-v2.md`: every feature group with its measured contribution, **including the ones that did not earn their place**. A feature that failed is as useful to record as one that worked, because it stops us trying it again in six months.
- [ ] The weekly decay curve against both naive and v1. Flattening that curve is the point.
- [ ] **Commit** `docs(projections): model v2, feature by feature`

---

# PHASE 4 — The news pass

**Gate:** only start this once Phase 3's ablations are landing cleanly. This layer is the one most likely to look impressive and add nothing, and only a working harness can tell the difference. That is why the spec puts it last.

### Task 6: Grounded retrieval

**Files:** `src/projections/news/retrieve.ts` + test

- [ ] Pull from Tank01's news and headlines feed into the point-in-time store, stamped with when we saw it. Never a runtime fetch during a projection — retrieval is an ingestion concern.

### Task 7: The adjustment contract

**Files:** `src/projections/news/adjust.ts` + test

**The hard contract, from the spec.** The model **weighs retrieved facts and never generates them.** Every adjustment:
- is **structured**, never prose
- carries a **source citation** — no citation, no ship
- carries a **confidence** and an **expiry**
- may only move a **bounded multiplier on opportunity**, never invent a component value

- [ ] **Step 1: Failing tests** for the contract itself: an adjustment without a citation is rejected; an expired adjustment stops applying; a multiplier outside bounds is refused. **These tests matter more than the feature.** In a product where entry fees ride on the output, an invented injury is unacceptable.
- [ ] **Step 2:** Implement.
- [ ] **Step 3: Ablate.** Does the news layer beat the model without it, on held-out seasons? **If it does not, report that and leave it off by default.** A layer that feels smart and measures neutral is exactly what this gate exists to catch.
- [ ] **Step 4: Commit** `feat(projections): the news pass — bounded, cited, expiring`

### Task 8: Phase 4 report

- [ ] `docs/research/2026-08-27-model-v3.md`. If the news layer did not earn its place, say so plainly and leave it disabled. That is a real result and a cheap one to have learned.

## Self-review notes

- The temptation in both phases is to add everything and report the total. Resist it: one group, one ablation, one commit. The value of this work is knowing WHICH things matter, and that is destroyed by bundling.
- A feature that helps only one segment is still a good feature. Report per-segment, not just the average, or you will discard the redistribution work for moving the overall number by 0.004.
