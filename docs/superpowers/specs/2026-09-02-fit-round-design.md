# The Fit Round: every open pricing question, one measurement cycle

Date: 2026-09-02
Status: approved direction (founder: "let's do it"; Round C of the batched roadmap; ultracode
on the re-measure and fit reviews)
Owner: engine
Backbone: docs/research/2026-09-01-discovery-expansion-closeout.md (deferrals), memory
law-discovery-next-round (the rookie-curve defect entry and Round B record)

## Why one round

Five open pricing questions (rookie curve, blend-on-22-laws, props anchor, recency
availability, nested-law handling) all end in the same held-out scorecard, and the data they
need (old-decade rosters, the player-team map) re-measures the discovery family the moment it
lands. Batching means: data lands once, the family re-measures once, the fit runs once, the
held-out scorecard renders ONE verdict. The held-out set is never a selection signal: the fit
selects on train; the scorecard only judges the winner.

## Part 1 - Data prep

- Richardson id gap: the 2012 pick-3 draft record does not join his stat lines; fix the
  crosswalk (find the class: is it one player or a family of pre-2013 draft-pick id misses;
  report the count either way, fix the class).
- Rosters 2003-2012: ingest (upstream reaches 2002; the kickoff stamps exist). The floor
  raises ride WITH the ingestion in this round, adjudicated consumer by consumer from Round
  B's enumeration: firstRosterSeasonsThrough/experienceCohort (backtest, projection-fit),
  seasonContext's window-gated read, historicalWeek1RosterAsOf's throw, and
  model/efficiency's career-stage censoring. Each consumer's behavior change is deliberate,
  tested, and reported: this round re-fits everything downstream anyway, which is exactly why
  the raises belong here and nowhere else.
- player_week_teams 2003-2012: backfill from the published weekly stats' own team column
  (the decade's stat lines already carry provenance from that feed). This is the collapse
  question's reopening key.
- Validations: per-season counts; the bust-cohort table (the six 2003-2012 top-5 RBs) fully
  resolved with games and points; spot checks against upstream.

## Part 2 - The re-measure event

- After Part 1's store growth: tribal re-measure (age/experience laws now see the old decade;
  expected movers reported before/after), quantile refit, discovery regeneration, one
  combined verdict-change table under the same BH discipline. The collapse-direction
  candidates get their reopened hearing with the decade in evidence: named call-out with
  numbers, confirmed or dead, whatever they say.
- Drift protocol total; the five checks; movement adjudicated never absorbed.

## Part 3 - Fit-harness extensions (code, no runs)

- PROPS ANCHOR: a candidate anchor channel built from the archived 2023/2024 week-1-adjacent
  player props (name-resolved), expressed the way the fit can grid over it (e.g. anchor =
  ADP-only vs props-blended at fitted weight). Leakage: props rows carry archive fetched_at;
  the anchor for season S uses only pre-kickoff-S rows.
- RECENCY AVAILABILITY: the availability model's games history gains a fitted recency weight
  (today's behavior = the flat special case, so the grid contains the incumbent).
- LAW CHANNEL: nested-law dedup and/or a fitted per-player law-channel cap as grid
  dimensions (the incumbent per-law-cap semantics stay in the grid as the null option).
- ROOKIE CURVE: refit machinery extended to the full 2003-2021 cohort (floor-dependent),
  same knots discipline, landing-multiplier untouched.
- Every extension TDD'd on fixtures; the grid's train-only selection is structural (the
  scorecard's held-out seasons are unreachable from the fit's objective; pin with a test).

## Part 4 - The fit, the verdict, the board

- One grid run on train seasons; winning configuration reported with the full grid table.
- ONE held-out scorecard run. THE BAR: decisive-2024 blend vs ADP BEYOND NOISE with the
  interval excluding zero. Bar holds: BOARD_SOURCE bumps to v8, all archives re-persist, the
  live 546-player board re-persists, replay-diff proof scoped to what changed, top 50 and
  top 200 refreshed, market-edge close-out addendum. Bar breaks: STOP, report, nothing
  ships; the incumbent v7 configuration stands and the close-out records the negative.
- Love, McCaffrey, Henry, Achane: the close-out revisits each founder-examined row under the
  winning configuration, numbers side by side.

## Out of scope

The in-season weekly loop (Round D: Tank01 freshness layer, read-layer one-generation
assertion, weekly re-projection cadence). 2025 props backfill (October credits). The
/player-laws UX scale work (deferred UX ledger). pbp-context widening correction step
(ledgered debt) unless Part 1's team-map work happens to close it for free (report if so).

## Constraints

As always: serial vitest ONE runner; tri-state; no em-dashes printed or rendered; every
figure from a run; leakage gates ordinary; published-beats-derived; live tables retire their
previous claim (the standing rule); the held-out set selects nothing.
