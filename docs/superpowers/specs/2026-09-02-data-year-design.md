# The Data Year: the prospective register and the season-long machine

Date: 2026-09-02
Status: approved direction (founder: launch pushed to 2027; "do what needs to be done for the
long term success and accuracy of the product"; memory launch-2027-data-year-2026)
Owner: engine
Backbone: docs/research/2026-09-02-fit-round-closeout.md (the frozen state, the quarantine,
the Round D list)

## The premises this round builds on

- THE 2026 QUARANTINE: nothing reads 2026 outcomes for fit, verdict, or selection until the
  2027 fit round. The register GRADES against 2026 outcomes after games are played; grading
  is bookkeeping about frozen predictions, never an input to anything that prices or selects.
  The wall between "grade and report" and "fit and choose" is structural and tested.
- THE FROZEN STATE: the board is v7 as stored; FROZEN_BOARD_SOURCES refuses forging writes.
  The register never re-persists the preseason board; it snapshots what the product serves.
- Kickoff is 2026-09-10T00:15Z. The machine must be running before it.

## Part 1 - The prospective register

- A new append-only store: weekly frozen predictions. Each week W of 2026: one FREEZE taken
  strictly before week W's first kickoff, recording for every rostered skill player the
  board's claim at that instant (the served v7 board's points/value stance) plus the market
  benchmarks beside it (current ADP-derived and ECR stances, and the week's player props
  consensus from the odds archive as its own benchmark column). Frozen rows carry the freeze
  instant and are immutable (the live-tables lesson does not apply: a register IS an archive
  by construction; a re-freeze before kickoff supersedes by a new freeze instant, rows never
  update).
- GRADING: after week W completes and stats are ingested, a grading pass computes outcomes
  against every frozen column (board vs ADP vs ECR vs props), appends graded results keyed to
  the freeze they grade, and prints/records a running season scoreboard. Grading reads
  outcomes; it writes only register rows and a report file; a structural test pins that no
  fit, law, or board path imports the register.
- The register is the 2027 launch evidence: a full season of pre-kickoff timestamped claims.

## Part 2 - The weekly cadence, automated

- ONE weekly command (npm run season:week) that runs the whole cadence in order: ingest the
  week's published stats when available, snapshot props (the existing snapshot script), grade
  last week's freeze, take this week's freeze, print the scoreboard. Idempotent: safe to run
  twice; each step reports what it did or skipped and why. Budget-aware (props step reports
  credits).
- Scheduling: a local scheduled run (cron) twice weekly (a mid-week data pass and a
  pre-kickoff freeze pass), with the runbook documented in the close-out for manual runs when
  the machine is off. The Sep 9 kickoff-eve depth ingest is the first scheduled event.
- The October 2025-props backfill is a dated runbook entry (npm run projections:odds:backfill
  -- --seasons=2025 after the credit refresh), not new code.

## Part 3 - The debt that bites during a long season

- Board-source clutter: a one-off, ruling-backed cleanup of the stale 2026 live generations
  under retired sources (v4 2,277 rows/3 stamps, v5, v6, v8, v9) and NOTHING else (archive
  seasons keep all nine sources: they are measured history). Scoped SQL, counts before/after.
- The read-layer one-generation assertion (board-top and the player page refuse a live board
  with more than one as_of per source) so a future writer regression is loud.
- Test tmpfs sizing (docker-compose: the 1.4GB tmpfs that fills on whole-repo runs).
- Explicitly OUT: the participation-floor extension and pbp-context correction (measurement-
  input expansions; they run mid-season as their own deliberate mini-round with the drift
  protocol, not in the machine round); any fitted-file regeneration (2027); Tank01 freshness
  layer (queued for when a launch product needs daily status; the register runs on nflverse
  cadence).

## Constraints

As always: serial vitest ONE runner (halves for wide runs); tri-state; no em-dashes printed
or rendered; figures from runs; leakage gates ordinary; the freeze guard untouched; the
register never feeds pricing. Lean reviews per the speed calibration except the register's
quarantine wall, which gets a focused leakage read.
