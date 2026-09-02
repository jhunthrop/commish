# Discovery Expansion: deeper history, wider templates, one honest re-measure

Date: 2026-09-01
Status: approved direction (Round B of the batched roadmap; founder-confirmed rookie-curve
survivorship defect makes the history extension load-bearing; ultracode applies to the
measurement review)
Owner: engine
Backbone: docs/research/2026-09-01-vegas-laws-closeout.md (deferrals), memory
law-discovery-next-round (the scout's ordered levers; the rookie-curve defect entry)

## Why one round, not three

Three planned layers all churn the same measured surface: extending stat lines to 2003-2012
grows every law's training pairs; low-side templates and production-conditional templates grow
the candidate family. Each alone forces a full discovery regeneration and verdict re-check.
Landing them together means ONE regeneration, ONE BH re-correction, ONE verdict-change table,
instead of three compounding churns.

## Part 1 - The history extension (2003-2012)

- Derive weekly stat lines for 2003-2012 from nflverse play-by-play through the EXISTING
  validated derivation (0.9999 rank agreement / 0.28 MAE method control on 2018; the same path
  that produced 2019 and 2025). STAT_LINE_GAPS grows accordingly ONLY if those seasons lack
  published weekly stats upstream; where nflverse publishes weekly stats for a season, ingest
  the published feed instead (published beats derived, the standing containment ruling).
- Rosters/draft context for those seasons to the extent nflverse serves them; the rookie-curve
  refit (Round C) needs draft picks (already ingested to 2003) joined to rookie season outcomes.
- Every existing measurement re-checked after the store grows: the five drift checks run and
  any movement is adjudicated, never absorbed. laws:measure WILL move (more pairs is a
  legitimate re-measure, not drift): the tribal verdict changes are reported with the same
  prominence discovery verdict changes get, and measured.json regenerates deliberately in its
  own commit with a before/after table.

## Part 2 - The template expansion

- LOW-SIDE thresholds: q30/q20/q10 conditions (the collapse direction; the founder's Achane
  hypothesis becomes directly testable, including on incomingTeamWinTotal and its delta).
- PRODUCTION-CONDITIONAL templates: pointsPerGame enters as a CONDITION quantity (the scout's
  first lever), so candidates like "high-ppg RB entering age N" become expressible.
- Vocabulary width: add store metrics the facts builder already computes or can cheaply
  surface; cap the addition so the testable family stays within an order of magnitude of
  today's 1,800 (the BH budget is the point; the implementer proposes the list, the controller
  ratifies before generation).

## Part 3 - The one re-measure

- Regenerate quantiles, candidates, discovered.json in one pass on the grown store and family.
- Full verdict-change table (old family vs new): every existing confirmed law's survival or
  fall is the headline either way. The two win-total laws and the four prior discovered laws
  face the larger family AND deeper data; honest outcomes only.
- Board integration of any NEW confirmations belongs to Round C's single fit round (this round
  does NOT touch the blend, the board, or BOARD_SOURCE).

## Out of scope

The rookie-curve refit itself, the anchor test, nested-law dedup, recency availability (all
Round C, one fit + one scorecard cycle). The in-season loop. 2025 props backfill (October).

## Constraints

Serial vitest; tri-state; no em-dashes printed; figures from runs; leakage gates ordinary;
published-beats-derived per season; ultracode review on the regeneration; drift protocol total.
