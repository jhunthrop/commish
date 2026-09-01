# Live Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 2026 season becomes projectable: 2025 ingested through the validated derived path, a live board moment that cannot be confused with a replay, and the 2026 blended PPR board persisted and rendered, with the top 50 as the acceptance deliverable.

**Architecture:** Three prerequisite layers then the board. 2025 stat lines derive from published pbp/snap-counts under the existing self-superseding machinery with an explicit live-path admission ruling; `BoardMoment` becomes a discriminated union whose live arm refuses any same-season observation and whose rows the scorecard refuses to grade; the week-one roster stamp gets publication-bounded with the four published measurements re-run to prove stability. Then the existing v4 blend pipeline runs for 2026 at the live moment.

**Tech Stack:** TypeScript, Postgres/Drizzle, vitest (serial only), nflverse open data (no Tank01).

**Spec:** `docs/superpowers/specs/2026-09-01-live-board-design.md` (backbone: `docs/research/2026-08-28-live-season.md`)

## Global Constraints

- ONE vitest runner at a time, `--no-file-parallelism`, never concurrent.
- Replay-arm leakage guarantees are UNTOUCHABLE: every change to `loadPreseason`/`preseasonMomentFor` keeps the replay path byte-identical in behavior, pinned by the existing suites.
- The live arm's rule is stricter than the replay assertion: refuse ANY observation from the projected season. Audit tests before implementation.
- Derived-2025 admission is explicit and per-season (gap list + documented live-path flag), never a blanket `admitDerived: true` on the live path.
- Drift protocol: any task that changes measurement-relevant store state re-runs `laws:measure -- --check` (and `laws:discover -- --check`) and reports; verdict changes are reported prominently, never silently committed.
- No em-dashes in printed or rendered output (`script-copy.source.test.ts` auto-covers new scripts). Every figure from a run or a measured object. Never fabricate: a step that cannot produce an honest number stops and says what it needs.
- nflverse only. UI test suites stay on the deferred UX ledger; engine suites are maintained TDD.

---

### Task 1: 2025 through the derived path

**Files:**
- Modify: `src/projections/nflverse/stat-lines.ts` (STAT_LINE_GAPS gains 2025 with a docblock naming the upstream absence and the verification date)
- Modify: `scripts/projection-backfill.ts` (2025 runs the gap-season branch: participation from published snap counts, stat lines derived from pbp; the validation step for gap seasons without a published twin prints the sanity report instead of the agreement bar)
- Create: the 2025 sanity report logic beside the existing validation (per-week row counts, games-delta distribution shape vs 2024's published season, position mix) — printed, no em-dashes
- Test: extend `derived-stat-lines.test.ts` / backfill-adjacent tests for the no-published-twin path (it must NOT claim an agreement number; it must print the sanity shape)

**Interfaces:**
- Consumes: existing `deriveStatLines`, `ingestDerivedStatLines` (self-superseding), `validateAgainstPublished` (2018-proven).
- Produces: 2025 stat-line observations under `nflverse_pbp_derived`; 2025 participation rows; the printed sanity report.

- [ ] Steps: TDD the no-twin sanity path → run `npm run projections:context 2025 2025` if 2025 pbp/team facts are not yet ingested (check first; the script's injuries step may hit old-vocabulary issues — 2025 uses the modern vocabulary, should pass) → run the 2025 backfill for real → paste the sanity report → run BOTH drift guards (`laws:measure -- --check`, `laws:discover -- --check`) and report (MEASURE_SEASONS ends at 2024 predictors, so no verdict should move; if one does, STOP and report before committing) → serial suites green → commit `feat(projections): 2025 ingested through the derived path`.

---

### Task 2: The live moment

**Files:**
- Modify: `src/projections/preseason/source.ts` (`preseasonMomentFor` → the replay arm of a discriminated `BoardMoment`; `loadPreseason` threads the moment kind)
- Modify: `src/projections/preseason/board-store.ts` (persisted rows record the moment kind — a `moment_kind` column via the repo's migration flow, default `replay` backfilled for the four historical seasons)
- Modify: the scorecard read path (`src/projections/preseason/scorecard.ts` / `scripts/market-edge-scorecard.ts`): REFUSES `live` rows with a clear message
- Test: `source.test.ts` extensions + a new audit block

**Interfaces:**
- Produces: `type BoardMoment = { readonly kind: "replay"; readonly at: Date } | { readonly kind: "live"; readonly at: Date }`; `liveMomentFor(db, season, clock)` = min(now, one ms before the season's first scheduled kickoff — from the already-ingested schedule; throws if the season has already started: a started season has a replay moment); the live arm's read guard refuses ANY observation stamped from the projected season.
- AUDIT FIRST (the spec's order): write the audit tests before touching the implementation — (a) replay behavior byte-identical (existing suites are the pin; add an explicit both-arms test), (b) a live board for season S with a smuggled season-S observation in the store THROWS, (c) the scorecard refuses a live row, (d) liveMomentFor caps at first kickoff and refuses started seasons.

- [ ] Steps: audit tests (fail) → implement → migration applied dev+test → full preseason + market suites serial → commit `feat(projections): the live board moment, unconfusable with a replay`.

---

### Task 3: The roster stamp, publication-bounded

**Files:**
- Modify: `src/projections/nflverse/rosters.ts` (`week1RosterAsOf`'s September-1 convention bounded by the file's own publication reality, the same treatment `parseExpertConsensus` received — read that fix first and mirror its shape)
- Test: extend `rosters.test.ts`

**Interfaces:**
- Consumes: the ECR stamp fix's pattern. Produces: for archives the convention still wins (published measurements must not move); for a season whose file is published before September 1 (2026 today), the stamp is the honest earlier bound.
- RE-MEASUREMENT (spec-binding): after the change, re-run the four published measurements the stamp is load-bearing for — `laws:measure -- --check`, `laws:discover -- --check`, `projections:blend:fit -- --check`, `projections:rookie-curve:fit -- --check` (and `projections:market:fit -- --check`) — all must exit 0, proving nothing moved; any drift is reported and adjudicated, never silently re-committed.

- [ ] Steps: TDD (archive unchanged; early-published season bounded) → implement → run all five drift/fit checks, paste results → serial suites → commit `fix(projections): week-one roster stamp bounded by publication`.

---

### Task 4: The 2026 board

**Files:**
- Modify: `scripts/preseason-persist.ts` (season selection gains the live season via the live moment; the live path passes the explicit derived-2025 admission per the spec's ruling; the persist prints which moment kind each season used)
- Modify: whatever the player screen's Model cell reads (verify it fills from the v4 row — trace, likely zero code)
- Create: `scripts/board-top.ts` (npm `projections:board:top`) — prints the top N of a season's persisted board: rank, name, position, NFL team, blended points, ADP rank, reason codes (law chips by id). No em-dashes.
- Test: engine-side only (the admission flag's plumbing; the script's formatting on fixture rows)

**Interfaces:**
- Consumes: Tasks 1-3; the existing blend pipeline (v4 source), 2026 rosters/depth/ADP (ingested), the live moment.
- Screen copy rule (spec): wherever the board renders beside the held-out scorecard's figures, the live season carries the honest line that 2026 is unmeasurable until played — check `preseason-report`/player-screen copy for any quote of the held-out rho beside live rows; fix mechanically if present.

- [ ] Steps: TDD plumbing → run the real 2026 persist (report row counts + moment kind) → run `npm run projections:board:top 2026 50` for real → paste THE TOP 50 TABLE in the report and return it → lab screenshot of the player screen's filled Model cell if the dev server is up (else note) → commit `feat(projections): the 2026 live board ships`.

---

### Task 5: Close-out

**Files:**
- Create: `docs/research/2026-09-01-live-board-closeout.md`

- [ ] Steps: record — the 2025 sanity report; the drift-protocol results (all five checks, before/after Task 3); the live-moment audit inventory; the 2026 board's headline rows and reason-chip statistics (how many players carry law chips, which laws fire most); the honest scorecard note (no measurement until 2026 plays out; the held-out figures describe 2023/2024); deferrals with pointers. Commit `docs(research): live board close-out`.

---

## Self-review (performed at write time)

- **Spec coverage:** Part 1 → Task 1; Part 2 → Task 2; Part 3 → Task 3; Part 4 → Tasks 4-5. The scoping doc's order (derive → ingest → moment → stamps → board) is preserved with step 1 already satisfied by the market-edge round's validation.
- **Placeholders:** none; the no-twin sanity report's contents are enumerated; the audit tests are enumerated; the re-measurement list names all five checks.
- **Type consistency:** `BoardMoment` (T2) consumed by T4's persist; STAT_LINE_GAPS + the explicit admission flag (T1) consumed by T4's live path; `liveMomentFor` signature stated once.
