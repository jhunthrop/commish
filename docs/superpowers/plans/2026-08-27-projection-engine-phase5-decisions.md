# Projection Engine — Phase 5: The Decision Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Answer the three questions the founder actually asked, only one of which the engine so far can answer.

> *"Draft analysis — how should I draft my team given all the information I have on the players. Weekly projected points and player rankings. Finding sleepers and other players who could overperform."*

**The gap this phase closes.** Layers 0-7 predict. None of them *decide*. A perfect projection still does not tell a manager who to draft, because draft value is not points — it is points **above what is still gettable at that position later**, weighed against who will survive to your next turn. That is a different kind of computation and it does not exist in our spec.

**Spec:** `docs/design/2026-08-27-projection-engine-spec.md` for the prediction layers this consumes. This plan adds the layer above them.

**Dependency:** requires Phase 2 (projections) and benefits from Phase 3 (context) and distributions. Sleepers additionally require an ADP benchmark in the store.

## Global Constraints

- The decision layer NEVER re-predicts. It consumes projections and turns them into choices. If you find yourself adjusting a projected stat here, you are in the wrong layer.
- Point-in-time throughout: a draft recommendation at pick 37 may only see what was knowable at pick 37.
- Every recommendation carries its reason. An assistant that says "take Achane" and cannot say why is a worse product than one that says nothing.
- Metrics from `src/projections/metrics.ts`. `StatLine`/`computeFantasyPoints` unchanged.
- Never touch `/Users/jh/code/fantasy`'s working tree, `src/draft-room/**` or `src/league-room/**`.

---

### Task 1: Replacement level and value over replacement

**Why first:** every other task depends on it. This is the single idea that makes drafting different from ranking.

**Files:** `src/projections/decide/replacement.ts` + test

**Interfaces:**
- `replacementLevel(projections, leagueSettings)` → per position, the projected points of the LAST starter who will be rostered across the league. In a 12-team league starting 2 RB and a FLEX, replacement RB is roughly the 30th-to-36th back, not the 12th. **It is a function of league size and starting requirements, never a constant.** This is why we can compute it and a generic site cannot: we know the league's real roster shape.
- `valueOverReplacement(projection, replacementLevel)` → the number that should drive a board.

- [ ] **Step 1: Failing tests.** The load-bearing case: a QB with more projected points than an RB must rank BELOW him when quarterback replacement level is high. That single test is the whole idea. Also: superflex changes QB replacement dramatically — pin that too, since it is the format where generic rankings fail worst and ours should not.
- [ ] **Step 2: RED.**
- [ ] **Step 3:** Implement. Derive starter counts from the league's real `RosterSlotConfig`, never a hardcoded assumption.
- [ ] **Step 4: Commit** `feat(projections): value over replacement — why drafting is not ranking`

### Task 2: Survival probability

**Files:** `src/projections/decide/survival.ts` + test

**Interfaces:** `survivalProbability(player, { fromPick, toPick, board })` → the chance a player is still there at your next turn.

- [ ] **Step 1: Failing tests**, including the structural one: probability must fall monotonically as the gap to your next pick widens.
- [ ] **Step 2: RED.**
- [ ] **Step 3:** Implement by simulating the intervening picks from ADP with realistic noise. Start simple — ADP plus a spread — and improve only if measurement demands it. **Where the room's own history is available, use it** (the in-league recall the tiering matrix permits: you sat in those drafts). Cross-league behaviour stays aggregate and anonymous, per the consent line in the tiering spec.
- [ ] **Step 4: Commit** `feat(projections): survival probability — who will not last until your next turn`

### Task 3: The draft recommendation

**Files:** `src/projections/decide/draft.ts` + test

**Interfaces:** `recommendPick({ board, roster, pickNumber, nextPickNumber, leagueSettings })` → a ranked shortlist, each with a stated reason.

The decision is not "highest VOR". It is **highest expected value added to the final roster**, which balances three things:
1. VOR of the player now,
2. the VOR of what will still be there at your next pick if you wait,
3. what your roster still needs — a fourth receiver is worth less than a first tight end when only one starts.

- [ ] **Step 1: Failing tests** for the cases that separate this from a list:
  - two players of near-equal VOR, one likely to survive → recommend the one who will not
  - a tier cliff at a position you have not filled → recommend crossing it before it breaks
  - roster saturation → a fifth back at the same VOR ranks below a first tight end
- [ ] **Step 2: RED.**
- [ ] **Step 3:** Implement. A simple expected-value calculation over the shortlist beats a Monte Carlo you cannot explain; add simulation only if measurement shows it wins.
- [ ] **Step 4: Every recommendation returns its reason** as structured data, not prose — the room renders it.
- [ ] **Step 5: Commit** `feat(projections): the draft recommendation — VOR, survival and roster need`

### Task 4: Sleepers

**Files:** `src/projections/decide/sleepers.ts` + test

**A sleeper is not a good player. It is a player the market has mispriced**, so this is a disagreement metric and it cannot exist without both numbers.

**Interfaces:** `sleepers({ projections, adp, asOf })` → players ranked by `ourRank − marketRank`, each with a **reason drawn from the model** and an upside measure.

- [ ] **Step 1: Failing tests.**
  - A player we rank far above ADP surfaces; one we merely rank highly does not. **A star is not a sleeper.**
  - A disagreement with no attributable cause ranks BELOW an equal disagreement that has one. Unexplained disagreement is usually our error, not the market's.
  - Upside is measured from the projection's distribution, not its mean — the honest claim is "his ceiling far exceeds his cost", not "he will score more".
- [ ] **Step 2: RED.**
- [ ] **Step 3:** Implement. Reasons come from features already computed, never invented here: vacated opportunity not yet repriced (Phase 3 redistribution), a play-caller change that lifts the position, efficiency suppressed by a line or quarterback that improved, draft capital far above current usage.
- [ ] **Step 4: Commit** `feat(projections): sleepers — where we disagree with the market, and why`

### Task 5: Weekly start/sit

**Files:** `src/projections/decide/lineup.ts` + test

Distinct from draft value: this week's expected points for THIS matchup, with floor and ceiling, against the league's real scoring and roster slots.

- [ ] **Step 1: Failing tests.** A high-floor player is preferred when you are favoured; a high-ceiling player when you need points. Pin that the recommendation actually changes with the matchup context — otherwise it is just a ranking wearing a different hat.
- [ ] **Step 2: RED, implement, commit** `feat(projections): start/sit — floor when you are ahead, ceiling when you are behind`

### Task 6: Score the decisions, not just the predictions

**Files:** `docs/research/2026-08-27-decision-quality.md`, extend `scripts/projection-report.ts`

Prediction accuracy is not decision quality. A model can rank well and still advise badly.

- [ ] **Draft:** replay historical drafts. Would our recommendation have produced a roster that scored more than what was actually taken? That is the only question that matters.
- [ ] **Sleepers:** publish last season's list and score it. **Include the misses.** A sleeper list without a hit rate is horoscope.
- [ ] **Start/sit:** decision regret — points left on the bench versus the optimal lineup in hindsight.
- [ ] **Commit** `docs(projections): decision quality, measured separately from prediction`

## Self-review notes

- The temptation is to make the draft recommendation clever. Resist: a manager needs to understand why they were told to take someone, and an explanation they cannot follow is worth less than a simpler recommendation they can act on.
- If sleepers cannot be given a reason from the model's own features, ship fewer sleepers. A list of unexplained disagreements is a list of our errors.
- Replacement level is the highest-leverage single idea in this phase. If only one task lands, make it Task 1 — it changes every board in the product.
