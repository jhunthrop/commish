# Vegas Laws Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vegas season win totals (2003-2026) enter the facts store and the discovery harness as two team-quality quantities; anything that survives the evidence bar prices onto the board; a null ships as loudly as a confirmation.

**Architecture:** A curated dataset under the repo's data/ convention feeds season-scoped team observations with preseason-honest stamps; two new quantities mirror the incoming-coach shape; the whole discovery family regenerates under the grown BH correction; board integration happens only behind a confirmed verdict.

**Tech Stack:** TypeScript, Postgres/Drizzle, vitest (serial only), nflverse + curated Vegas dataset (no scraping beyond one-time human-rate page fetches, committed raw).

**Spec:** `docs/superpowers/specs/2026-09-01-vegas-laws-design.md`

## Global Constraints

- ONE vitest runner at a time, `--no-file-parallelism`, never concurrent.
- Replay-arm and live-guard leakage guarantees are UNTOUCHABLE; win-total stamps must pass the ORDINARY as-of gates, never a carve-out.
- Two quantities exactly (`incomingTeamWinTotal`, `incomingTeamWinTotalDelta`); the family's BH budget is the point.
- Any regeneration of `discovered.json`/`measured.json` reports verdict CHANGES prominently in the ledger and the close-out, never silently.
- No em-dashes in printed or rendered output (`script-copy.source.test.ts` auto-covers new scripts). Every figure from a run or a measured object; a step that cannot produce an honest number stops and says what it needs.
- Tri-state facts: a team-season with no line is null, never zero.
- The board changes ONLY if a law confirms (then: blend regen, v7 bump, five-season re-persist, replay-unchanged proof where the law cannot reach, scorecard re-run, close-out addendum).

---

### Task 1: The dataset

**Files:**
- Create: `data/win-totals/win-totals.csv` (season, team, win_total, over_price, under_price, actual_wins, source)
- Create: `data/win-totals/README.md` (provenance: nfelo win-totals page primary, covers.com sportsoddshistory cross-check; fetch dates; the parse's raw material reference)
- Create: `scripts/validate-win-totals.ts` (npm `projections:win-totals:validate`)

**Interfaces:**
- Consumes: the nfelo win-totals page content (the controller fetches and hands over raw table material; the implementer never scrapes in a loop), the store's schedule-derived actual wins.
- Produces: the curated CSV every later task reads; validation proving (a) 32 teams per season 2003-2025 (except real expansion/rename edge cases, documented), (b) actual_wins matches the store's schedule-derived wins for every season both know, exact, (c) win totals within [0, 17], prices within sane American-odds bounds, (d) at least 3 seasons spot-checked against the covers archive with results recorded in the README.

- [ ] Steps: controller hands raw table material into the workspace -> parse to CSV -> write validation TDD-first on fixture rows -> run validation against the real store, paste output -> commit `feat(data): vegas win totals 2003-2026, validated`.

---

### Task 2: Store and stamps

**Files:**
- Modify: `src/projections/team-store.ts` (TEAM_METRICS gains `vegasWinTotal`, `vegasWinTotalOverPrice`, `vegasWinTotalUnderPrice`; season-scoped rows following the store's existing season-fact convention)
- Modify: `src/projections/nflverse/ingest.ts` or a new `src/projections/vegas/ingest.ts` if cohesion favors it (read the CSV, write observations)
- Test: extend team-store tests; a new stamp-visibility audit

**Interfaces:**
- Consumes: Task 1's CSV. Produces: store observations for 2003-2026 with stamps at the season's first kickoff minus the legacy eve convention (`firstKickoffFor` is the one kickoff truth; reuse it).
- AUDIT (spec-binding, TDD-first): (a) a measurement-time read for a historical season SEES its win total (the harness's own as-of), (b) a replay moment for 2021-2024 SEES it, (c) the LIVE 2026 moment sees the 2026 row through the ordinary as-of gate (it is preseason-published), (d) a season with no CSV row reads null.

- [ ] Steps: audit tests (fail) -> implement metrics + ingest -> run the real ingest, report row counts per season -> serial suites -> commit `feat(projections): vegas win totals in the team store, preseason-stamped`.

---

### Task 3: Quantities and the harness re-run

**Files:**
- Modify: `src/projections/laws/discovery/templates.ts` (QUANTITY_DEFS + two entries, nouns in the registry's plain-prose style)
- Modify: the discovery-facts builder (`src/projections/laws/discovery-facts.ts` and its store reads) to surface both quantities tri-state; `incomingTeamWinTotalDelta` = predicted-season total minus prior-season ACTUAL wins (schedule-derived, the same source Task 1 validated against)
- Regenerate: `src/projections/laws/discovered.json` via `npm run laws:discover` (write mode); `laws:measure -- --check` must stay exit 0 (tribal side untouched)
- Test: extend discovery-facts and templates tests; generator count assertions updated to the new family size

**Interfaces:**
- Consumes: Task 2's metrics. Produces: the regenerated candidate family and verdicts; a ledger + report table of EVERY verdict change against the prior discovered.json (id, old verdict, new verdict, why: family growth vs new data).

- [ ] Steps: TDD facts plumbing -> regenerate discovery for real -> diff verdicts, paste the change table (expect the existing 4 confirmed to survive; ANY change reported prominently) -> `laws:discover -- --check` re-baselined in the same commit -> serial suites -> commit `feat(laws): team win-total quantities join the discovery family`.

---

### Task 4: The board, conditional

**Files (only if Task 3 confirms at least one new law):**
- Regenerate: `src/projections/market/blend-fitted.ts` (write mode, same commit discipline)
- Modify: `src/projections/preseason/board-store.ts` BOARD_SOURCE -> v7
- Re-run: five-season persist, scorecard, `projections:board:top 2026 50`
- Modify: `docs/research/2026-08-31-market-edge-closeout.md` (addendum with re-measured figures)

**Interfaces:**
- Consumes: Task 3's verdicts; the existing gate (position-gated `lawReasonsFor`, trainEffect, fitted caps). Produces: the v7 board and the re-measured scorecard, or, on a null harvest, NOTHING except the close-out's record of the null.
- The null path is first-class: if no law confirms, this task's deliverable is the one-paragraph ledger entry saying so, and the board stays v6.

- [ ] Steps (confirm path): blend regen -> v7 bump -> persist all five -> replay-unchanged proof for seasons where no new law fires (SQL, byte-identical discipline from the v5/v6 precedent) -> scorecard re-run, paste bar verdicts -> top-50 reprint, paste -> addendum -> commit `feat(projections): win-total laws price the board` + docs commit. Steps (null path): ledger entry, no commits.

---

### Task 5: Close-out

**Files:**
- Create: `docs/research/2026-09-01-vegas-laws-closeout.md`

- [ ] Steps: record the dataset provenance and validation results; the stamp-visibility audit; the verdict-change table; confirmed laws with effect sizes and CIs, or the null, stated with equal prominence; the founder's Achane question answered directly with whatever the harness found; deferrals (the historical props backfill and props-as-anchor measurement round, designed from Task 6's schema; implied offense totals from game lines). Commit `docs(research): vegas laws close-out`.

---

### Task 6: The player-props archive starts now (amended 2026-09-01, founder key received)

The Odds API key (env `ODDS_API_KEY`, 20,000 credits/month, verified live) exposes on this
tier: current NFL game-level player props (verified: `player_pass_yds`,
`player_reception_yds`, `player_receptions`, `player_rush_yds` returning real week-1 lines)
AND the historical snapshot archive (verified: a 2024-09-04 snapshot returned 200). Season-long
player props do not exist as API markets; the player-level signal is weekly game props. Every
week not archived from here forward is history we cannot buy back at this tier's cost, so the
forward archive starts in THIS round; the historical backfill (2023-2025) and any
props-as-anchor measurement are the NEXT round, designed in the close-out's deferrals.

**Files:**
- Create: migration + `src/projections/odds/props-store.ts` (append-only player-prop
  observations: event id, commence time, bookmaker, market, player name string as given,
  line, over price, under price, `fetched_at` stamp; NO name resolution to nfl_players yet,
  the raw string is the honest record and resolution is the next round's problem)
- Create: `scripts/odds-props-snapshot.ts` (npm `projections:odds:snapshot`): fetches all
  upcoming NFL events, then the four verified player markets per event (US region,
  DraftKings preferred, store whatever books return), writes observations, prints per-event
  and per-market counts and the credits used/remaining from the response headers. Fail fast
  on missing `ODDS_API_KEY`. No em-dashes in output.
- Test: engine-style tests on the parse/store path with a fixture JSON payload (the real
  fetch is not exercised in tests)

**Interfaces:**
- Consumes: `ODDS_API_KEY` from env; The Odds API v4 events + event-odds endpoints.
- Produces: the archive table and one REAL first snapshot (week 1, run at implementation
  time), with counts pasted in the report. Explicitly NOT consumed by any model, board, or
  law in this round.

- [ ] Steps: TDD parse/store -> migration dev+test DBs -> run the real snapshot once ->
  paste counts + credit usage -> serial suites -> commit `feat(odds): the player props
  archive begins`.

---

## Self-review (performed at write time)

- **Spec coverage:** Part 1 -> Tasks 1-2; Part 2 -> Task 3 (quantities); Part 3 -> Task 3 (harness); Part 4 -> Task 4; out-of-scope items -> Task 5 deferrals.
- **Placeholders:** none; validation checks enumerated; audit tests enumerated; the null path is specified as first-class.
- **Type consistency:** metric names (`vegasWinTotal`, `vegasWinTotalOverPrice`, `vegasWinTotalUnderPrice`) and quantity ids (`incomingTeamWinTotal`, `incomingTeamWinTotalDelta`) stated once each and reused; `firstKickoffFor` named as the one kickoff truth per the live-board round's ruling.
