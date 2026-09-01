# Live Board: the 2026 season becomes projectable

Date: 2026-09-01
Status: approved direction (founder asked for the 2026 top 50; standing autonomous loop)
Owner: engine
Backbone: docs/research/2026-08-28-live-season.md (the scoping note; its order of work binds,
adjusted for what the market-edge round already delivered)

## What already exists (do NOT rebuild)

- The pbp-derived stat-line machinery, validated at 0.9999 rank agreement / 0.28 MAE against a
  season with both feeds, with self-superseding writes and week-max stamps
  (src/projections/nflverse/derived-stat-lines.ts; the scoping doc's step 1 is DONE).
- STAT_LINE_GAPS (one home, nflverse/stat-lines.ts) and the explicit admitDerived seam.
- 2026 ingested today: week-one rosters (3,154), depth charts (new dated schema, committed),
  FFC ADP 2026 (219 resolved, 81.7%), ECR 2026. The market anchor is in the store.
- The blended v4 board pipeline end to end, and the fitted constants (applying a fitted model
  to 2026 is what a fitted model is for).
- 2025 upstream reality (re-verify at execution): snap counts, pbp, depth charts, rosters all
  present; stats_player_week_2025.csv absent (the newest is 2024).

## Part 1 — 2025 through the derived path

- Add 2025 to STAT_LINE_GAPS; run the derived backfill for 2025 (participation from the
  published 2025 snap counts; stat lines from 2025 pbp). The 2018 validation bar already
  proved the derivation; a 2025-specific sanity report (row counts per week, games-delta
  distribution vs the 2024 shape) is required, not a second agreement bar (no published 2025
  feed exists to compare against — state that plainly).
- RULING (extends the containment ruling): the LIVE board path may admit derived stat lines
  for gap seasons where NO published feed exists. The original ruling ranked published over
  derived; it never required starving a board of a season the publisher skipped. Implement as
  an explicit per-season admission (the gap list plus a documented live-path flag), never a
  blanket admitDerived=true, and document it at the seam.
- Re-run the drift protocol: any measurement-relevant store change re-runs laws:measure
  --check; if 2025 entering the window CHANGES any verdict (it should not — MEASURE_SEASONS
  ends at 2024 predictors; verify rather than assume), the change is reported prominently.

## Part 2 — The live moment

- A discriminated BoardMoment: { kind: "replay" } (existing derivation, byte-identical
  behavior, assertion intact) vs { kind: "live", at } (real wall-clock capped by the season's
  first scheduled kickoff, so a live board can never be stamped after the season starts).
- The live arm's guard: refuse ANY observation from the projected season itself (stronger
  than the replay assertion, per the scoping note). Audit test written FIRST.
- The two moments must be unconfusable: a live-stamped board must be un-scoreable by the
  backtest (the scorecard refuses kind: "live" rows) so the third leakage defect is
  structurally impossible.

## Part 3 — The roster stamp

- week1RosterAsOf's fixed September-1 convention bounded by publication reality, the same
  treatment the ECR stamp already got. It is load-bearing for four seasons of published
  measurements: the change re-runs those measurements and shows they did not move (or reports
  what moved and why that is correct).

## Part 4 — The 2026 board

- Build, persist (v4 source, live moment), and render the 2026 blended board. The player
  screen's Model cell fills where a row exists.
- The deliverable and acceptance test: the PPR top 50 printed with blended points, ADP rank,
  and reason chips, delivered to the founder. Every law chip that fires on it must trace to a
  confirmed law's condition on real 2025 facts.
- The board's own screen copy must NOT quote the held-out scorecard beside the live board as
  though it measured this season; the honest line is that 2026 is unmeasurable until played.

## Out of scope

Weekly in-season updates (the live loop is its own round), FAAB/auction, new UI surfaces
beyond filling existing cells, Tank01 spends, any relaxation of the replay arm's guarantees.

## Test and copy rules

As every round: engine suites TDD and serial; UI suites deferred; no em-dashes anywhere
printed or rendered; every figure from a measured object; fail fast; never fabricate.
