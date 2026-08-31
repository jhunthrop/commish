# Market Edge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A market-anchored preseason board that beats ADP on held-out seasons through confirmed-evidence deviations, fed by recalibrated models, discovered laws under false-discovery control, and a strengthened evidence base.

**Architecture:** Four layers in dependency order. Evidence first (historical birth dates, pbp-derived 2019 stat lines, draft picks, rolling replication folds), then calibration of the raw model's diagnosed losses, then FDR-controlled law discovery on the existing matched-DiD harness, then the blend: an ADP-derived market curve plus capped, reason-carrying deviations gated on confirmed evidence. Final scorecard on untouched held-out outcomes (2023, 2024).

**Tech Stack:** TypeScript, Postgres/Drizzle, vitest (serial only), existing projections stores and harness (`src/projections/laws/`), nflverse open data (no Tank01 spends).

**Spec:** `docs/superpowers/specs/2026-08-31-market-edge-design.md`

## Global Constraints

- ONE vitest runner at a time, always `--no-file-parallelism`.
- Leakage discipline absolute: condition-side reads as-of-gated; every fitted constant (blend caps, market curve, calibration terms, rookie curve) fit on TRAIN predictor seasons ≤ 2021 only; final-scorecard outcomes 2023–2024 untouched by any fitting.
- No em-dashes in any user-facing OR printed (console) string — `script-copy.source.test.ts` scans script output.
- Every published figure renders from measured objects (Sunday v5 law 7); failed/debunked results ship as content.
- Discovery FDR: Benjamini–Hochberg q = 0.10 over the FULL candidate set; survivors need replication (direction holds on EVERY fold with pairs) AND a floor of ≥ 40 full-window matched pairs.
- Replication folds after this round: predictor seasons {2021, 2022, 2023} (outcomes 2022–2024); the tribal verdict rule generalizes to per-fold direction agreement, capped at weak when any fold with pairs disagrees.
- nflverse only; no Tank01 ingestion scripts; PFR never fetched by code.
- UI test suites stay on the deferred UX ledger; engine suites are maintained TDD.
- The registry drift guard (`npm run laws:measure -- --check`) must exit 0 at every commit that touches laws.

---

### Task 1: Historical preseason rosters (birth dates to 2013)

**Files:**
- Modify: `src/projections/preseason/store.ts` / the roster ingestion path (read `scripts/preseason-ingest.ts` and `src/projections/preseason/ingest.ts` first to find where rosters are pulled; extend the season range it can ingest)
- Create/Modify: whichever script backfills rosters (follow the existing script's pattern; add a season-range argument if absent)
- Test: extend the store's existing test file

**Interfaces:**
- Consumes: nflverse rosters assets (the client already fetches rosters for recent seasons; verify asset availability back to 2013 and STOP at the first season whose asset genuinely 404s, recording the floor as a constant with a docblock, exactly like `MEASURE_SEASONS`' snap-count floor).
- Produces: `preseasonRostersAsOf` answering birth dates/positions for every season the assets cover (target 2013+), so `ageAtSeason` feeds `rb_age_curve` and Task 3's experience term across the full window.

- [ ] Steps: read the ingestion path → failing test pinning a pre-2021 season's roster read → extend ingestion → run the backfill against the dev DB (report per-season row counts and the discovered floor) → suite green serially → commit `feat(projections): historical preseason rosters back to the nflverse floor`.

---

### Task 2: 2019 stat lines derived from play-by-play

**Files:**
- Create: `src/projections/nflverse/derived-stat-lines.ts` (+ test)
- Modify: `scripts/projection-backfill.ts` (gap-season branch)

**Interfaces:**
- Consumes: the ingested 2019 pbp (already in the store), `statMetricName`/stat-line observation shape from `src/projections/lines.ts` and `nflverse/stat-lines.ts` (read both first).
- Produces: stat-line observations for gap seasons under source `"nflverse_pbp_derived"` — a SECOND source id, never mixed with `STAT_LINE_SOURCE` rows; `statLinesAsOf` gains an option (or a wrapper) to admit the derived source for gap seasons only, controlled by an explicit `STAT_LINE_GAPS` list imported from one place.

**Validation requirement (spec-binding):** derive a NON-gap season (2018) the same way and compare against its published lines: season-points rank correlation ≥ 0.99 across players with ≥ 8 games; the comparison runs in a test against store fixtures AND once for real in the backfill script run, printing the measured agreement. If the bar fails, the task's honest outcome is a report of why, not a shipped derivation.

- [ ] Steps: failing tests (derivation math on fixture pbp aggregates; agreement comparison harness) → implement → real 2018 agreement run (record the number) → real 2019 backfill → laws suites still green → commit `feat(projections): pbp-derived stat lines fill the 2019 window hole`.

---

### Task 3: Rolling replication folds and tribal re-measure

**Files:**
- Modify: `src/projections/laws/config.ts` (folds constant replaces the pair-of-years shape), `src/projections/laws/registry.ts` (`verdictForFullWindow` → per-fold rule), `scripts/measure-laws.ts` (fold partition + per-fold effects in `measured.json`)
- Test: extend `registry.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2 (fuller window). Produces: `REPLICATION_FOLDS: readonly number[]` = [2021, 2022, 2023] (predictor seasons); `measured.json` entries carry `foldEffects: readonly { season: number; effect: number | null }[]` replacing the single `heldOutEffect`; verdict = confirmed only when full-window CI excludes zero, sign matches, and every fold WITH pairs agrees in direction; any disagreeing fold caps at weak; zero folds with pairs caps at weak.
- Blend-safety note for later tasks: predictor seasons ≤ 2021 remain the only fitting window; folds 2022–2023 predictors are evaluation-only.

- [ ] Steps: failing registry tests for the per-fold rule (agree/disagree/empty-fold fixtures) → implement → re-run `npm run laws:measure` for real (verdicts land wherever the data says; report the new table prominently) → `--check` exit 0 → update `/player-laws` copy ONLY if the elaboration sentences need the fold language (mechanical from object state, as before) → commit `feat(laws): rolling replication folds and re-measured verdicts`.

---

### Task 4: Draft-capital rookie prior

**Files:**
- Create: `src/projections/nflverse/draft-picks.ts` (+ test), `src/projections/preseason/rookie-curve.ts` (+ test)
- Modify: `src/projections/preseason/rookies.ts` (consume the curve; read it first)

**Interfaces:**
- Consumes: nflverse draft-picks asset (check the client's asset naming; picks back to 1999 exist upstream); historical rookie outcomes via `statLinesAsOf`.
- Produces: `rookieCurve(position, overallPick): number` — expected rookie season points fit on TRAIN seasons only (≤ 2021 rookie classes), monotone-decreasing in pick within position (enforce isotonic or log fit; pin monotonicity in a test); `rookies.ts` uses it as the baseline, keeping the existing `rookie` BoardReason shape.

- [ ] Steps: failing tests (asset parse; curve fit on fixture outcomes; monotonicity; train-season gate) → implement → backfill picks into the store → preseason suite green serially → commit `feat(projections): draft-capital rookie curve fit on train seasons`.

---

### Task 5: WR/TE starter-band recalibration and the experience term

**Files:**
- Modify: `src/projections/model/opportunity.ts` (WR/TE share shrinkage), `src/projections/model/efficiency.ts` or the rate-prior site for the experience term (trace where per-game rates get priors; read `model/fit.ts` and `preseason/fit.ts` first)
- Create: `scripts/calibration-report.ts` (+ npm script `projections:calibrate`) printing before/after starter-band scorecards per position on VALIDATION folds (predictor 2021 outcomes), never the final held-out years
- Tests: extend the touched model test files

**Interfaces:**
- Consumes: Task 1's experience data (career year = season − first roster season). Produces: refit shrinkage constants for WR/TE (fit ≤ 2021), an experience-year multiplier for years 4–6 cohorts (same gate), each behind a named constant with the fitting provenance in its docblock.
- Acceptance per spec: each fix lands only if the calibration report shows the target cohort improving without degrading others on the validation fold; a fix that fails is REVERTED and the negative result recorded in the close-out. The report script prints the numbers either way.

- [ ] Steps: failing tests pinning the new terms' shapes → implement + fit → calibration report run (record) → keep-or-revert per acceptance → full projections suite serial → commit `feat(model): starter-band recalibration and experience-year prior` (or the revert + record).

---

### Task 6: Discovery candidate generator

**Files:**
- Create: `src/projections/laws/discovery/templates.ts`, `src/projections/laws/discovery/generate.ts` (+ tests)

**Interfaces:**
- Consumes: `LawConditionFacts` quantities plus additional gated facts already in stores (red-zone share, air-yards/target depth, snap share, play-caller tenure/PROE, age, experience year, team pace) — extend `factsForSeason` (or a sibling `discoveryFactsForSeason`) with any quantity not yet surfaced, each through existing as-of-gated reads only.
- Produces: `interface CandidateLaw { readonly id: string; readonly position: Law["position"]; readonly template: CandidateTemplate; readonly condition: (facts: DiscoveryFacts) => boolean | null; readonly claimParts: ClaimParts }` and `generateCandidates(): readonly CandidateLaw[]` — threshold crossings (quantiles 0.7/0.8/0.9 of the train distribution per quantity per position), year-over-year deltas (rise/fall past the same quantiles), and pairwise ANDs of at most two single conditions; deterministic ids from the template; a documented hard cap on total candidates (≤ 2,000 — log the exact count).
- `ClaimParts` renders a plain-words sentence from the template mechanically (quantity noun, threshold with its unit, position, direction) — one renderer, tested, no per-candidate prose. No em-dashes.

- [ ] Steps: failing tests (id determinism, tri-state conditions, claim rendering, cap, quantile computation train-only) → implement → commit `feat(laws): discovery candidate generator with speakable claims`.

---

### Task 7: Discovery harness — BH control plus fold replication

**Files:**
- Create: `src/projections/laws/discovery/measure.ts` (+ test), `scripts/discover-laws.ts` (+ npm script `laws:discover`)
- Create: `src/projections/laws/discovered.json` (generated, committed)
- Modify: `src/projections/laws/registry.ts` (admit discovered laws with `origin: "discovered"`; tribal entries get `origin: "tribal"`)

**Interfaces:**
- Consumes: Task 6's candidates, the existing harness (`matchedPairsStratified`, `measureEffect`), Task 3's folds.
- Produces: the discovery pipeline: measure every candidate on TRAIN predictor seasons (≤ 2021) with stratified matching → two-sided p-values from the seeded bootstrap → Benjamini–Hochberg at q = 0.10 across ALL candidates → survivors measured full-window → replication rule (every fold with pairs agrees) AND ≥ 40 full-window pairs → `discovered.json` with the same measured shape plus `origin`, `template`, and the pipeline counts `{ tested, bhSurvivors, replicated }`. `registry()` merges tribal + discovered; the drift guard covers both files. `verdictForFullWindow` applies unchanged; only `confirmed` discovered laws are chip/deviation-eligible.
- Determinism: same canonical-ordering + seeded-bootstrap discipline; `laws:discover -- --check` re-derives and diffs.

- [ ] Steps: failing tests (BH math on planted p-value fixtures — a known-null battery yields ~q false survivors at most; pipeline counts; registry merge + origin; drift check) → implement → REAL discovery run (report the counts and every survivor's claim + numbers prominently; zero survivors is a legitimate, publishable result) → `--check` both files exit 0 → commit `feat(laws): FDR-controlled law discovery with fold replication`.

---

### Task 8: Discovered laws on the laws page and chips

**Files:**
- Modify: `src/app/player-laws/page.tsx` (discovered section + pipeline-counts sentence), `src/projections/laws/board-reasons.ts` (admit confirmed discovered laws), magnitude semantics per template in one documented map
- Tests: engine side only (board-reasons); page verified by tsc/eslint (+ screenshot post-merge)

- [ ] Steps: failing board-reasons tests (discovered-confirmed emits, discovered-weak does not; magnitude per template) → implement → page section (grouped after tribal, same verdict framing, one plain sentence on how discovery is controlled, every count from `discovered.json`) → tsc/eslint clean → commit `feat(app): discovered laws with their discovery counts`.

---

### Task 9: The market curve

**Files:**
- Create: `src/projections/market/curve.ts` (+ test), `src/projections/market/store-reads.ts` if historical ADP needs a dedicated read (trace how `BENCHMARK_SOURCES.adp` rankings reach the backtest — read `preseason/benchmarks.ts` and the capture store first)

**Interfaces:**
- Consumes: historical ADP rankings per season (the benchmark path already resolves them for scoring; reuse that read), actual season points via `statLinesAsOf`.
- Produces: `marketCurve(season, position, adpRank): number` — expected season points at an ADP slot, fit per position on TRAIN seasons (≤ 2021 predictor years' ADP vs their outcomes), smooth and monotone-decreasing in rank (pin in tests); plus `marketBoard(db, season): Promise<readonly MarketPriorEntry[]>` (`{ playerId, position, adpRank, marketPoints }`) for the current/backtest season's ADP snapshot at the board's as-of.

- [ ] Steps: failing tests (monotonicity, train-gate, per-position fit on fixtures) → implement → commit `feat(market): ADP-to-points market curve fit on train seasons`.

---

### Task 10: The deviation engine and the blended board

**Files:**
- Create: `src/projections/market/blend.ts` (+ test)
- Modify: `src/projections/preseason/source.ts` / `board.ts` (blended candidates become the shipped board; read the current assembly first), `scripts/preseason-persist.ts` only if the call shape changes

**Interfaces:**
- Consumes: Task 9's market board, the raw model board (existing `preseasonCandidates`), the registry (confirmed laws, tribal + discovered), availability outlooks, Task 4's rookie curve.
- Produces: `blendBoard(market, model, evidence): readonly BoardCandidate[]` — per player: start from `marketPoints`; admit deltas ONLY from (a) confirmed-law conditions holding (delta = law effect × exposure scaling, capped), (b) availability gap between model expected-games and the market's implicit assumption (capped), (c) rookie curve replacing the market point for rookies. Caps and scalings are constants fit on TRAIN seasons via a small grid search in `scripts/blend-fit.ts` (create; npm `projections:blend:fit`), committed as named constants with provenance docblocks. Every admitted delta emits a `BoardReason` (the existing law/rookie/availability codes) — a blended board with no admitted evidence for a player equals the market for that player EXACTLY (pin this identity in a test).
- Unlisted players (no ADP): fall back to the raw model with a documented reason code.

- [ ] Steps: failing tests (identity-to-market with no evidence; capped delta; reason emission; unlisted fallback; train-gate on fit script) → implement + fit → wire as the shipped board (the raw board stays available behind a flag for the scorecard comparison) → preseason suite green serially → commit `feat(market): evidence-gated blended board`.

---

### Task 11: Final scorecard and close-out

**Files:**
- Create: `docs/research/2026-08-31-market-edge-closeout.md`

- [ ] Steps: run the benchmark scorecard on held-out outcome seasons 2023 and 2024: blended vs raw vs ADP vs ECR vs naive, overall and starter bands per position → the close-out records: the bar (beat ADP both seasons, never lose a starter band beyond noise) met or missed, stated plainly; the re-measured tribal verdict table; discovery counts and survivors; calibration keeps/reverts with numbers; evidence-base changes (roster floor found, 2018 agreement number, 2019 fill, picks); deferrals with ledger pointers; and if the bar is missed, the diagnosis. No em-dashes; every number from a run or named file; verification commands in the header → commit `docs(research): market edge close-out`.

---

## Self-review (performed at write time)

- **Spec coverage:** Part 4 → Tasks 1–4 (birth dates, 2019, folds, rookie prior); Part 2 → Task 5; Part 3 → Tasks 6–8; Part 1 → Tasks 9–10; the bar → Task 11. Sequencing matches the spec's. Out-of-scope respected (no weekly work, no ECR input, no Tank01).
- **Placeholder scan:** the spec's "minimum sample floor" is pinned (≥ 40 pairs); BH q pinned (0.10); folds pinned ({2021, 2022, 2023}); candidate cap pinned (≤ 2,000); agreement bar pinned (≥ 0.99). Tasks name read-first files where the implementer must discover current shapes rather than trust stale line numbers.
- **Type consistency:** `CandidateLaw`/`DiscoveryFacts` (T6) consumed by T7; `foldEffects` (T3) consumed by T7's replication and T8's page copy; `marketCurve`/`marketBoard` (T9) consumed by T10; `rookieCurve` (T4) consumed by T10; `origin` field (T7) consumed by T8. Names match across tasks.
