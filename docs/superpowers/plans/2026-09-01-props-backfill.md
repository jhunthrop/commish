# Props Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The props archive extends backward through 2023-2025 (one pre-kickoff snapshot per week, honest archive timestamps, budget-guarded), and a name-resolution map makes it joinable to nfl_players.

**Architecture:** One task, two deliverables, both inside src/projections/odds/ + scripts. The backfill reuses the snapshot round's parse/store path against the historical endpoints; the resolver is an offline pass over archived rows. No measurement, no model, no board.

**Tech Stack:** TypeScript, Postgres/Drizzle, vitest (serial only), The Odds API historical endpoints (key in env).

**Spec:** `docs/superpowers/specs/2026-09-01-props-backfill-design.md`

## Global Constraints

- ONE vitest runner, `--no-file-parallelism`. No em-dashes in printed output. Tri-state; gaps recorded, never synthesized. Append-only store; archive rows carry the API's snapshot timestamp as fetched_at, never wall-clock. Key never printed, never in URLs on error paths. Budget guard per the spec (--budget, default 9000, clean stop with resume point). Nothing outside src/projections/odds/, src/db (one migration for props_player_map), scripts/, and docs.

---

### Task 1: Backfill + resolver (one batch)

**Files:**
- Create: `scripts/odds-props-backfill.ts` (npm `projections:odds:backfill`) reusing the parse/store internals of `src/projections/odds/props-store.ts` and the snapshot script's fetch shaping (extract shared helpers into `src/projections/odds/` rather than duplicating; the snapshot script keeps working)
- Create: migration for `props_player_map` + `src/projections/odds/player-map.ts` (builder + reader) + `scripts/odds-props-resolve.ts` (npm `projections:odds:resolve`)
- Test: fixture-driven tests for the week-instant selection (one snapshot instant per week, strictly before the week's first kickoff, from the store's schedule), the resume/skip logic, and the resolver's normalization + ambiguity handling (failure paths included)

**Interfaces:**
- Consumes: historical endpoints `/v4/historical/sports/americanfootball_nfl/events` and `/v4/historical/sports/americanfootball_nfl/events/{id}/odds` (date param = the chosen instant); `firstKickoffFor`/schedule metrics for week instants; migration 0064's props table; season rosters for name matching.
- Produces: archived observations for 2023-2025 (fetched_at = archive timestamps); `props_player_map` rows (name string, season, player id, method) + an unmatched report printed and saved to the workspace.

- [ ] Steps: TDD the instant-selection, resume, and resolver logic on fixtures -> implement (shared helpers extracted, both npm scripts wired) -> serial suites green, tsc 43-baseline, eslint clean -> commit `feat(odds): historical props backfill and player map` -> run the REAL backfill (report per-season week coverage, row counts, credits used/remaining, any gaps; budget-guarded) -> run the resolver for real (report match rate by season and observation count, paste the unmatched summary) -> ledger the run results.

---

### Task 2: Close-out note

**Files:**
- Modify: `docs/research/2026-09-01-vegas-laws-closeout.md` (a short dated addendum to its props section: coverage achieved, credits spent, match rate, gaps; the anchor test remains Round C)

- [ ] Steps: write from Task 1's run output only -> commit `docs(research): props backfill addendum`.

---

## Self-review (performed at write time)

- **Spec coverage:** Part 1 -> Task 1 (backfill deliverable); Part 2 -> Task 1 (resolver deliverable); the is-not scope guard -> Global Constraints; close-out -> Task 2.
- **Placeholders:** none; endpoints, flags, defaults, and report contents named.
- **Type consistency:** table name `props_player_map` and script names stated once each; `firstKickoffFor` reused as the kickoff truth.
