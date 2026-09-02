# Discovery Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ten more seasons of history (2003-2012), low-side and production-conditional templates, a bounded vocabulary widening, and ONE honest re-measure of everything that rests on them.

**Architecture:** Data first (Part 1), templates second (Part 2), one regeneration last (Part 3); the board and blend are untouched (Round C's job). The tribal measured.json re-measures deliberately when the data lands; the discovery family regenerates once when both data and templates are in.

**Tech Stack:** TypeScript, Postgres/Drizzle, vitest (serial only), nflverse (published weekly stats where they exist, validated pbp derivation where they do not).

**Spec:** `docs/superpowers/specs/2026-09-01-discovery-expansion-design.md`

## Global Constraints

- ONE vitest runner, `--no-file-parallelism`. No em-dashes printed. Tri-state. Figures from runs. Published-beats-derived per season (check upstream per season; derive only where no published weekly feed exists). Leakage gates ordinary, no carve-outs. The five drift checks run after every store-growing task; movement is adjudicated and regenerated deliberately in its own commit with a before/after table, never absorbed. Board, blend, BOARD_SOURCE untouched this round. Ultracode review on the regeneration task; lean reviews elsewhere per the speed calibration.

---

### Task 1: The history extension (2003-2012)

**Files:**
- Modify: `src/projections/nflverse/stat-lines.ts` (coverage floors/gap lists per the per-season published-vs-derived audit), `scripts/projection-backfill.ts` (season range), ingestion configs whose floors are 2011/2013 (`HISTORICAL_ROSTER_FLOOR` consumers are NOT raised silently: enumerate what reads it and report; raising it is Round C's rookie-refit call)
- Create: nothing new unless the derivation genuinely needs a seam; reuse the validated path
- Test: extend coverage tests for the new seasons' branch decisions

**Interfaces:**
- Consumes: nflverse published weekly stats (verify per season 2003-2012 which exist), pbp for derivation where not, schedules (already 2003+ via kickoff backfill), rosters as upstream serves them.
- Produces: weekly stat lines for 2003-2012 in the store; a per-season source table (published vs derived vs gap) pasted in the report; per-season row counts and a sanity shape (games-per-player distribution vs an adjacent known season).

- [ ] Steps: per-season upstream audit first (paste the table) -> ingest/derive for real, season by season, counts pasted -> run ALL FIVE drift checks; laws:measure -- --check is EXPECTED to move (more pairs): regenerate measured.json deliberately in its OWN commit with the full before/after tribal verdict table (any verdict change is the headline); the other four checks adjudicated per result -> serial engine suites green; tsc 43-baseline; eslint clean -> commits: `feat(data): 2003-2012 weekly stat lines` + `feat(laws): tribal measurements re-earned on the deeper window`.

---

### Task 2: Templates and vocabulary

**Files:**
- Modify: `src/projections/laws/discovery/templates.ts` (low-side quantile levels q10/q20/q30 with sign handling; production-conditional support: `pointsPerGame` as a condition quantity), `generate.ts` (template rules for the new kinds; AND-pair rules extended deliberately, not combinatorially), `discovery-facts.ts` (any new vocabulary quantities)
- Test: template/generation tests for the new kinds (counts, rendering, exclusions)

**Interfaces:**
- Consumes: Task 1's grown store. Produces: the widened family, NOT yet regenerated; a family-size projection (candidates by template kind, testable estimate) pasted for the controller's ratification BEFORE Task 3 runs; the vocabulary addition list likewise ratified (target: testable family within an order of magnitude of 1,800).

- [ ] Steps: TDD templates -> family-size projection pasted, WAIT for controller ratification in the ledger -> commit `feat(laws): low-side and production-conditional templates`.

---

### Task 3: The one regeneration

**Files:**
- Regenerate: quantile table, `discovered.json`, `laws:discover -- --check` baseline (same commit)
- Test: generator count assertions updated

**Interfaces:**
- Consumes: Tasks 1-2. Produces: the FULL verdict-change table (every prior confirmed law's survival or fall, prominently, including the two win-total laws and the four earlier discovered laws; every new confirmation with complete evidence); the Achane collapse-direction candidates' results called out by name whatever they say.

- [ ] Steps: regenerate for real -> verdict-change table pasted -> both laws checks exit 0 on the committed tree -> serial suites -> commit `feat(laws): the family regenerated on deeper data and wider templates` -> ULTRACODE review workflow (statistics + leakage lenses, adversarial verify).

---

### Task 4: Close-out

**Files:**
- Create: `docs/research/2026-09-01-discovery-expansion-closeout.md`

- [ ] Steps: the per-season source table; the tribal before/after; the family growth and verdict-change table; the collapse-direction answer stated plainly; deferrals (Round C list carried forward). Commit `docs(research): discovery expansion close-out`.

---

## Self-review (performed at write time)

- **Spec coverage:** Part 1 -> Task 1; Part 2 -> Task 2; Part 3 -> Task 3; close-out -> Task 4. Out-of-scope guarded in Global Constraints.
- **Placeholders:** none; ratification gates named; regeneration ownership unambiguous (Task 3 only).
- **Type consistency:** template kind names and the ratification artifacts stated once; no new module names invented beyond existing files.
