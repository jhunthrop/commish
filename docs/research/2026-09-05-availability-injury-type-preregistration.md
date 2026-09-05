# Pre-registration: injury-type-conditioned availability

**Status: QUEUED.** Written 2026-09-05, before any feature was built or any fit was run. This document is the binding pre-registration for the round; the eventual results doc must cite it and report against exactly these gates. Motivating case: Malik Nabers (our board WR24 on ~10.7 expected games vs a market price of pick 24.3) — but the round ships for the whole recovered-injury class or not at all, never as a per-player adjustment.

## Blocked on (in order)

1. Phase-3 branch (`worktree-draft-hq-room`) merges to main.
2. Injuries branch (`worktree-agent-ac34da7ac381c3b7c`, commit 5c7f31c, review-approved) merges on top.
3. Backfill: `nflverse_injuries` ingested for 2009-2025 (module accepts any season; 2024-2025 verified during the build).

## Hypothesis

Expected-games error and interval coverage improve when availability shrinkage is conditioned on ABSENCE CLASS rather than raw games missed: a single discrete season-ending absence (played, got hurt, out for the remainder, with qualifying Out rows anchoring the first missed week) reverts toward the position's healthy baseline minus a fitted year-one penalty, while recurring multi-spell absence keeps the harsher discount.

## Features (all derived from `nflverse_injuries` + game logs, no hand-set values)

- `absenceClass`: healthy | discrete_terminal | recurring (spell count over the season, terminal spell per `deriveSeasonEndingAbsence`).
- `terminalAbsenceAgeMonths`: months from first missed week to next season's kickoff.
- `bodyPartClass`: report_primary_injury text mapped to a small fixed vocabulary (knee, hamstring, ankle, shoulder, concussion, other) — mapping table committed before fitting.
- `spellCount`, `longestSpellWeeks`.
- `questionablePlayedRate`: weeks listed Questionable where the player appeared.

## Fit and judgment

- Fit window: 2018-2024 player-seasons (injury reports + games; 2018 start matches the advanced-era cut used elsewhere). Sensitivity check on 2009-2024 reported but not gating.
- Judged EXACTLY ONCE on held-out 2025. 2026 stays pristine per the standing rule.
- Same harness as `docs/research/2026-09-05-availability-backtest.md` (the failed August round) for comparability.

## Gates (all must pass)

1. Expected-games MAE on held-out 2025 improves vs the current model.
2. p10-p90 interval coverage on held-out 2025 moves toward nominal by at least 0.05 (the failed round's 0.651 → 0.665 was ruled noise; that ruling binds the threshold here).
3. No degradation on the healthy population (MAE within noise for players with no prior-two-season absence).
4. The discrete-terminal class effect is fit, not assumed, and its sign/size is reported with its uncertainty.

## Decision rule

Pass → model updates, factsHash moves the affected class, capsules regenerate in the nightly sweep, results doc + register note. Fail → honest revert exactly like the August round, results doc records the null, the register grades the model-vs-market disagreement on the 2026 season as designed.

## UX rider (ships regardless of gate outcome)

The peek and full page state the decomposition plainly: per-game projection rank beside expected games ("Per game he projects like a top-12 receiver. The question is games: our model expects 11."). Talent and availability are separate claims and the card says both.
