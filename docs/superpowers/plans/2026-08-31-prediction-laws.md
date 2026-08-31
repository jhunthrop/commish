# Prediction Laws Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sourced play-caller facts table feeding the existing coaching mechanism, a law registry of measured fantasy claims with verdicts, and rankings that explain themselves on the draft board, the player card, and a public laws page.

**Architecture:** Three sequenced layers on the existing `src/projections/` engine. Layer 1 commits a play-caller CSV (Wikipedia-assembled, PFR-verifiable) and swaps `coaches.ts` attribution from head coach to play-caller where covered. Layer 2 adds `src/projections/laws/` — a registry of declarative claims measured through the existing as-of-gated stores against matched baselines on held-out seasons. Layer 3 stores board reasons, extends `BoardReason` with a law variant, and renders explanation chips plus a `/player-laws` reference page.

**Tech Stack:** TypeScript, Postgres/Drizzle, vitest, Next.js app router, existing projections stores (`observationsAsOf`, `teamObservationsAsOf`, `statLinesAsOf`).

**Spec:** `docs/superpowers/specs/2026-08-31-prediction-laws-design.md`

## Global Constraints

- Test-DB discipline: ONE vitest runner at a time, always `--no-file-parallelism`.
- Leakage discipline: every historical read goes through the as-of-gated store reads (`statLinesAsOf`, `observationsAsOf`, `teamObservationsAsOf`); never a raw table read of outcomes.
- PFR ruling (phase-8 ledger 2026-08-31): play-caller names come from Wikipedia's sanctioned API and PFR account exports at human rates; NEVER a crawler against PFR; `source` column on every row; the names never render in the product.
- Copy rules: no em-dashes in user-facing copy; UX explains itself (no tips); every user-facing figure renders from the registry, never typed into copy (Sunday v5 law 7); at most two reason chips per player (law 4).
- Held-out seasons for every law verdict: `2023, 2024` (constant `HELD_OUT_SEASONS` in `src/projections/laws/config.ts`).
- Verdict rules (mechanical): `confirmed` = bootstrap 95% CI excludes zero on held-out data; `weak` = direction holds, CI spans zero; `debunked` = otherwise.
- UI test suites are on the deferred UX ledger; engine suites are maintained TDD.
- Immutability, small files (<800 lines), fail-fast validation per repo conventions.

---

### Task 1: Play-caller row types, CSV parser, and coverage validator

**Files:**
- Create: `src/projections/nflverse/play-callers.ts`
- Test: `src/projections/nflverse/play-callers.test.ts`

**Interfaces:**
- Consumes: nothing new (pure module; CSV text in, rows out).
- Produces:
  - `interface PlayCallerRow { readonly season: number; readonly team: string; readonly name: string; readonly role: "HC" | "OC"; readonly startWeek: number; readonly endWeek: number; readonly source: "wikipedia" | "pfr" | "both"; readonly note: string }`
  - `parsePlayCallers(csv: string): readonly PlayCallerRow[]` — throws `Error` naming line number on malformed rows.
  - `validatePlayCallers(rows: readonly PlayCallerRow[], seasons: readonly number[], teamsBySeason: (season: number) => readonly string[], finalWeekOf: (season: number) => number): readonly string[]` — returns human-readable problems (empty = valid): a team-season with no rows, week ranges that overlap or leave gaps in `1..finalWeekOf(season)`, `startWeek > endWeek`, empty names.
  - `playCallerLookup(rows: readonly PlayCallerRow[]): (team: string, season: number, week: number) => string | null`

- [ ] **Step 1: Write the failing tests**

```ts
// src/projections/nflverse/play-callers.test.ts
import { describe, expect, it } from "vitest";
import { parsePlayCallers, playCallerLookup, validatePlayCallers } from "./play-callers";

const HEADER = "season,team,name,role,start_week,end_week,source,note";
const row = (s: string) => `${HEADER}\n${s}\n`;

describe("parsePlayCallers", () => {
  it("parses a well-formed row", () => {
    const rows = parsePlayCallers(row("2024,DET,Ben Johnson,OC,1,18,both,"));
    expect(rows).toEqual([
      { season: 2024, team: "DET", name: "Ben Johnson", role: "OC", startWeek: 1, endWeek: 18, source: "both", note: "" },
    ]);
  });
  it("throws with the line number on a malformed role", () => {
    expect(() => parsePlayCallers(row("2024,DET,Ben Johnson,QB,1,18,both,"))).toThrow(/line 2/);
  });
  it("throws with the line number on a non-numeric week", () => {
    expect(() => parsePlayCallers(row("2024,DET,Ben Johnson,OC,one,18,wikipedia,"))).toThrow(/line 2/);
  });
});

describe("validatePlayCallers", () => {
  const teams = () => ["DET", "KC"];
  const finalWeek = () => 18;
  it("accepts a season fully partitioned by week ranges", () => {
    const rows = parsePlayCallers(
      `${HEADER}\n2024,DET,Ben Johnson,OC,1,18,both,\n2024,KC,Andy Reid,HC,1,9,wikipedia,\n2024,KC,Matt Nagy,OC,10,18,wikipedia,midseason change\n`,
    );
    expect(validatePlayCallers(rows, [2024], teams, finalWeek)).toEqual([]);
  });
  it("names a missing team-season", () => {
    const rows = parsePlayCallers(row("2024,DET,Ben Johnson,OC,1,18,both,"));
    expect(validatePlayCallers(rows, [2024], teams, finalWeek).join(" ")).toContain("KC 2024");
  });
  it("names a gap and an overlap in week coverage", () => {
    const rows = parsePlayCallers(
      `${HEADER}\n2024,DET,A,OC,1,8,wikipedia,\n2024,DET,B,OC,11,18,wikipedia,\n2024,KC,C,HC,1,10,wikipedia,\n2024,KC,D,OC,10,18,wikipedia,\n`,
    );
    const problems = validatePlayCallers(rows, [2024], teams, finalWeek).join(" ");
    expect(problems).toContain("DET 2024");
    expect(problems).toContain("KC 2024");
  });
});

describe("playCallerLookup", () => {
  it("answers by week within a midseason change and null off the table", () => {
    const rows = parsePlayCallers(
      `${HEADER}\n2024,KC,Andy Reid,HC,1,9,wikipedia,\n2024,KC,Matt Nagy,OC,10,18,wikipedia,\n`,
    );
    const lookup = playCallerLookup(rows);
    expect(lookup("KC", 2024, 9)).toBe("Andy Reid");
    expect(lookup("KC", 2024, 10)).toBe("Matt Nagy");
    expect(lookup("KC", 2023, 1)).toBeNull();
    expect(lookup("DET", 2024, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/projections/nflverse/play-callers.test.ts --no-file-parallelism`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement the module**

CSV parsing: split lines, skip header, split on commas (note is the last field and may be empty; no quoted commas are permitted — the validator's job is facts, not prose). Every parse failure throws `new Error(\`play-callers.csv line ${n}: ${what}\`)`. Validation walks each requested season × team: collect that team-season's rows, sort by `startWeek`, then check exact partition of `1..finalWeekOf(season)`. Lookup builds a `Map` keyed `team|season` to sorted rows and binary-searches or scans (32×27 rows, a scan is fine).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/projections/nflverse/play-callers.test.ts --no-file-parallelism`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/projections/nflverse/play-callers.ts src/projections/nflverse/play-callers.test.ts
git commit -m "feat(projections): play-caller CSV parser, validator, and week-accurate lookup"
```

---

### Task 2: Assemble the play-caller CSV, 1999 to present

**Files:**
- Create: `data/play-callers/play-callers.csv`
- Create: `data/play-callers/README.md` (sources, ruling pointer, how to refresh)
- Create: `scripts/validate-play-callers.ts`
- Modify: `package.json` (add script `"facts:play-callers": "tsx scripts/validate-play-callers.ts"`)

**Interfaces:**
- Consumes: Task 1's `parsePlayCallers`, `validatePlayCallers`; nflverse schedule for `teamsBySeason`/`finalWeekOf` (via `createScheduleClient` from `src/projections/nflverse/schedule.ts` — read its exports before wiring; the validator script may also hardcode the season→final-week table: 17 games/18 weeks from 2021, 16/17 before, matching `teamGamesIn` in `src/projections/preseason/availability.ts`).
- Produces: the committed CSV every later task reads.

**This is a data-assembly task, not a code task.** The worker (or a fan-out of research subagents) sweeps Wikipedia team-season articles ("2019 Kansas City Chiefs season" and each franchise's season list) through the MediaWiki API for every team-season 1999–2025, recording WHO CALLED THE PLAYS: the listed offensive coordinator unless the article states the head coach called plays, in which case the head coach with role `HC`. Midseason changes get separate rows with week ranges (use the article's stated firing/change date against that season's schedule). `source` is `wikipedia`; rows later hand-verified against the founder's PFR account get upgraded to `both`. Ambiguous rows (article silent on play-calling, disputed attribution) go into `data/play-callers/verification-queue.md` with the best guess in the CSV and `note` explaining the doubt. NEVER fetch pro-football-reference.com from any script or agent.

- [ ] **Step 1: Write `scripts/validate-play-callers.ts`**

```ts
// Validates data/play-callers/play-callers.csv and exits nonzero on any problem.
// Run: npm run facts:play-callers
import { readFileSync } from "node:fs";
import { parsePlayCallers, validatePlayCallers } from "@/projections/nflverse/play-callers";
import { NFL_TEAMS_BY_SEASON, finalWeekOf, FACT_SEASONS } from "@/projections/nflverse/team-eras";

const csv = readFileSync("data/play-callers/play-callers.csv", "utf8");
const rows = parsePlayCallers(csv);
const problems = validatePlayCallers(rows, FACT_SEASONS, NFL_TEAMS_BY_SEASON, finalWeekOf);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log(`play-callers.csv: ${rows.length} rows, every team-season 1999-2025 covered`);
```

Create `src/projections/nflverse/team-eras.ts` alongside: `FACT_SEASONS` (1999..2025), `finalWeekOf(season)` (18 from 2021, 17 before), and `NFL_TEAMS_BY_SEASON(season)` handling franchise moves and the 2002 Texans expansion using the abbreviations already used by `team-map.ts` (read it first; reuse its constants rather than retyping the 32 abbreviations). Unit-test `team-eras.ts` for: 31 teams in 1999–2001, 32 from 2002, `OAK`→`LV` at 2020, `SD`→`LAC` at 2017, `STL`→`LA` at 2016, final week 17 in 2020 and 18 in 2021.

- [ ] **Step 2: Assemble the CSV**

Sweep Wikipedia via the MediaWiki API (fan out by franchise; each agent returns that franchise's 1999–2025 rows plus doubts). Merge, sort by season then team, write the CSV.

- [ ] **Step 3: Validate**

Run: `npm run facts:play-callers`
Expected: exit 0, row count printed (roughly 850–950 rows including midseason changes).

- [ ] **Step 4: Spot-verify a random 40-row sample**

Cross-check 40 random rows against a second source by hand (franchise season lists, coach articles). Record the sample and result in `data/play-callers/README.md`. Anything wrong: fix, re-validate, widen the sample for that era.

- [ ] **Step 5: Commit**

```bash
git add data/play-callers scripts/validate-play-callers.ts src/projections/nflverse/team-eras.ts src/projections/nflverse/team-eras.test.ts package.json
git commit -m "feat(data): sourced play-caller table 1999-2025 with validator"
```

---

### Task 3: Play-caller attribution in the coaching mechanism

**Files:**
- Modify: `src/projections/nflverse/coaches.ts`
- Modify: `src/projections/nflverse/ingest.ts` (the `ingestCoaches` wiring, around line 212)
- Test: `src/projections/nflverse/coaches.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1's `playCallerLookup`; existing `coachByTeamSeason`, `coachObservations`, `COACH_METRICS`, `SeasonMetricLookup`, `TeamGame`.
- Produces: `coachObservations(games, seasonMean, seasons, playCaller?: (team: string, season: number, week: number) => string | null)` — a new optional final parameter; when provided, attribution per team-season uses the play-caller name for the MAJORITY of that season's weeks (same most-frequent rule, now over the lookup's week-accurate answers), falling back to the head coach from `games.csv` where the lookup answers null. Tenure counts consecutive prior seasons the SAME NAME called this team's plays, role-agnostic. `ingestCoaches` reads the committed CSV and passes the lookup.

Read `coaches.ts` fully before editing; the existing docblock explicitly anticipates this change ("the mechanism below is indifferent to which name it is given"). Update that docblock: the cost paragraph (OC change under a kept HC is invisible) is now resolved for covered spans; keep the head-coach fallback honesty note.

- [ ] **Step 1: Write the failing tests** (extend `coaches.test.ts`; read its existing fixtures and follow their shape)

```ts
it("attributes a team-season to the play-caller, not the head coach, where the table covers it", () => {
  // games say KC's coach is "Andy Reid" all season; the table says Matt Nagy called plays wks 1-18
  const lookup = (team: string, season: number) => (team === "KC" && season === 2024 ? "Matt Nagy" : null);
  const rows = coachObservations(kcGames2024, meansWithHistoryFor("Matt Nagy"), [2024], lookup);
  const tenure = rows.find((r) => r.metric === "coach_tenure_seasons");
  expect(tenure?.value).toBe(0); // Nagy's first season calling KC's plays => a coaching change
});

it("falls back to the head coach where the lookup answers null", () => {
  const rows = coachObservations(kcGames2024, means, [2024], () => null);
  const noLookup = coachObservations(kcGames2024, means, [2024]);
  expect(rows).toEqual(noLookup);
});

it("counts tenure across a role change for the same name", () => {
  // same name called plays 2022 (OC rows) and 2023-2024; tenure in 2024 is 2
});
```

Write the third test in full with fixtures (two prior seasons in the lookup for the same name, tenure expected 2). Fixtures: build `TeamGame[]` arrays the way the existing tests in `coaches.test.ts` do.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/projections/nflverse/coaches.test.ts --no-file-parallelism`

- [ ] **Step 3: Implement**

Inside `coachObservations`: derive each team-season's attributed name as the lookup's most frequent non-null weekly answer, else the `games.csv` coach. Tenure and `elsewhere` history walk the ATTRIBUTED names (build an attributed `TeamSeasonCoach[]` first, then reuse the existing logic unchanged over it). `ingestCoaches` gains the CSV read: `parsePlayCallers(readFileSync("data/play-callers/play-callers.csv", "utf8"))` → `playCallerLookup(rows)`, passed through; a missing file is a hard throw (fail fast; the data is committed, absence is a broken checkout).

- [ ] **Step 4: Run the full coaches + ingest suites**

Run: `npx vitest run src/projections/nflverse/coaches.test.ts src/projections/nflverse/ingest.test.ts --no-file-parallelism` (check the second file exists; run whatever ingest tests do)
Expected: PASS, including every pre-existing test (the no-lookup path is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/projections/nflverse/coaches.ts src/projections/nflverse/ingest.ts src/projections/nflverse/coaches.test.ts
git commit -m "feat(projections): week-accurate play-caller attribution with head-coach fallback"
```

---

### Task 4: Law registry types, config, and the measurement harness

**Files:**
- Create: `src/projections/laws/types.ts`
- Create: `src/projections/laws/config.ts`
- Create: `src/projections/laws/harness.ts`
- Test: `src/projections/laws/harness.test.ts`

**Interfaces:**
- Consumes: nothing from the stores (the harness is pure; store-reading population builders come per-law in Task 5).
- Produces:
  - `types.ts`:
    ```ts
    export type LawVerdict = "confirmed" | "weak" | "debunked";
    export interface LawMeasurement {
      readonly effect: number;                  // points/game delta, condition minus matched baseline
      readonly ci: readonly [number, number];   // bootstrap 95%
      readonly sample: number;                  // condition player-seasons measured
      readonly seasons: string;                 // e.g. "2011-2024, held out 2023-2024"
    }
    export interface Law {
      readonly id: string;
      readonly position: "QB" | "RB" | "WR" | "TE" | "all";
      readonly claim: string;                   // plain words, user-facing
      readonly measured: LawMeasurement;
      readonly verdict: LawVerdict;
      readonly modelPath: string | null;        // fitted feature it gates; null = content only
    }
    export interface PlayerSeasonPoint {
      readonly playerId: string;
      readonly season: number;
      readonly pointsPerGame: number;           // season N, PPR per game
      readonly nextPointsPerGame: number | null;// season N+1, null = did not play
      readonly matchKey: number;                // the matching covariate (usually pointsPerGame)
      readonly condition: boolean;              // does the law's antecedent hold?
    }
    ```
  - `config.ts`: `export const HELD_OUT_SEASONS = [2023, 2024] as const;` `export const MEASURE_SEASONS = { from: 2011, to: 2024 } as const;` `export const BOOTSTRAP = { resamples: 1000, seed: 20260831 } as const;`
  - `harness.ts`:
    ```ts
    export function matchedPairs(points: readonly PlayerSeasonPoint[], caliper: number): readonly { condition: PlayerSeasonPoint; control: PlayerSeasonPoint }[];
    export function measureEffect(pairs: readonly { condition: PlayerSeasonPoint; control: PlayerSeasonPoint }[]): LawMeasurement;
    export function verdictFor(measurement: LawMeasurement, expectedSign: -1 | 1): LawVerdict;
    ```

`matchedPairs`: greedy nearest-neighbor without replacement on `matchKey` within `caliper` (condition rows sorted by `matchKey` descending pair against the closest unused control; unmatched condition rows are dropped and their count reduces `sample`). Drops any point with `nextPointsPerGame === null` from BOTH pools (survivorship is a matched property here: both sides must have a next season; the harness measures decline among returners, and the claim copy must say so). `measureEffect`: effect = mean over pairs of `(condition.next - condition.now) - (control.next - control.now)` (difference-in-differences, so shared regression to the mean cancels); CI by seeded bootstrap over pairs (implement a small mulberry32 PRNG from `BOOTSTRAP.seed`; never `Math.random`). `verdictFor`: confirmed if CI excludes 0 AND sign matches `expectedSign`; weak if point effect's sign matches but CI spans 0; debunked otherwise.

- [ ] **Step 1: Write the failing tests — planted effects**

```ts
// harness.test.ts
import { describe, expect, it } from "vitest";
import { matchedPairs, measureEffect, verdictFor } from "./harness";
import type { PlayerSeasonPoint } from "./types";

/** A synthetic population: `n` condition/control pairs at identical matchKeys, with the
 *  condition group's next season shifted by `plantedEffect` beyond the control's. */
function planted(n: number, plantedEffect: number, seed = 7): readonly PlayerSeasonPoint[] { /* deterministic LCG noise ±0.5 */ }

it("recovers a planted -2.0 effect within the CI", () => {
  const pairs = matchedPairs(planted(400, -2.0), 0.5);
  const m = measureEffect(pairs);
  expect(m.effect).toBeLessThan(-1.5);
  expect(m.ci[1]).toBeLessThan(0);
  expect(verdictFor(m, -1)).toBe("confirmed");
});

it("returns debunked on a pure-regression population with no planted effect", () => {
  const m = measureEffect(matchedPairs(planted(400, 0), 0.5));
  expect(verdictFor(m, -1)).not.toBe("confirmed");
  expect(Math.abs(m.effect)).toBeLessThan(0.5);
});

it("never matches outside the caliper and reports the reduced sample", () => { /* two condition rows, one control far away */ });

it("is reproducible: two runs yield identical measurements", () => {
  const a = measureEffect(matchedPairs(planted(100, -1), 0.5));
  const b = measureEffect(matchedPairs(planted(100, -1), 0.5));
  expect(a).toEqual(b);
});
```

Write `planted` in full in the test file (LCG: `x = (1103515245 * x + 12345) % 2**31`, noise from it, condition rows get `nextPointsPerGame += plantedEffect`).

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/projections/laws/harness.test.ts --no-file-parallelism`

- [ ] **Step 3: Implement `types.ts`, `config.ts`, `harness.ts`** per the signatures above.

- [ ] **Step 4: Run to verify pass** — same command.

- [ ] **Step 5: Commit**

```bash
git add src/projections/laws
git commit -m "feat(laws): registry types and matched-baseline measurement harness with planted-effect tests"
```

---

### Task 5: The six law population builders

**Files:**
- Create: `src/projections/laws/populations.ts`
- Test: `src/projections/laws/populations.test.ts` (DB-backed, follows the fixture style of `src/projections/backtest.test.ts` — read it first)

**Interfaces:**
- Consumes: `statLinesAsOf` (`../lines`), `observationsAsOf`/`LAST_POSSIBLE_WEEK` (`../store`), `teamObservationsAsOf` (`../team-store`), `playerTeamsAsOf`, `ageAtSeason` (`../preseason/availability`), `computeFantasyPoints` (`@/scoring/compute`), Task 4's `PlayerSeasonPoint`.
- Produces: `export interface LawSpec { readonly id: string; readonly position: Law["position"]; readonly claim: string; readonly expectedSign: -1 | 1; readonly caliper: number; readonly modelPath: string | null; readonly population: (db: ReadonlyDb, seasons: readonly number[]) => Promise<readonly PlayerSeasonPoint[]> }` and `export const LAW_SPECS: readonly LawSpec[]` with exactly these six ids: `rb_workload_cliff`, `rb_age_curve`, `wr_target_competition`, `play_caller_fingerprint`, `target_share_persistence`, `td_regression`.

Population definitions (each returns per-player-season points with PPR points/game for season N and N+1, `matchKey` = season-N points/game unless stated):

- `rb_workload_cliff` (RB, sign -1): condition = carries + receptions ≥ 300 in season N (from `statLinesAsOf` fields `carries`/`receptions` summed over the season's weeks).
- `rb_age_curve` (RB, sign -1): condition = `ageAtSeason(birthDate, N) >= 28`; birth dates from `nflPlayers` the way `backtest.ts` reads them.
- `wr_target_competition` (WR, sign -1): condition = a teammate WR/TE with season-N target share within 5 points of the player's own arrives OR the player's team adds a top-64-ADP pass catcher for season N+1 — SIMPLIFY to what the stores answer without leakage: condition = team's returning target share at other WR/TE spots for season N+1 exceeds 60% (from `playerTeamsAsOf` + target observations). Whatever simplification the implementer lands on must be stated in the law's `claim` copy so the page never overclaims. Measured effect is on the INCUMBENT.
- `play_caller_fingerprint` (all, sign +1, `matchKey` = season-N points/game): condition = the player's team-season N+1 has `coach_tenure_seasons = 0` AND the incoming caller's `coach_prior_pass_rate_over_expected > 0` (both from `teamObservationsAsOf` at the schedule-publication stamp); expected positive for WR/TE-heavy output. Position scope `all` but the population is WR+TE.
- `target_share_persistence` (WR, sign +1): condition = season-N target share ≥ 24% (targets from the participation metrics in the observation store; team target totals summed the same way); this law's claim is that share predicts N+1 output beyond points.
- `td_regression` (all, sign -1): condition = season-N touchdown points ≥ 1.5× the position-season median share of the player's own points; `matchKey` = season-N points/game.

Each builder must read ONLY through as-of-gated reads with `asOf` = the moment season N+1's schedule published (`schedulePublishedAsOf(N + 1)` from `nflverse/schedule.ts`), so no builder can see season N+1 outcomes when forming the condition. Season N+1 actuals are read separately and deliberately without the gate, mirroring `backtest.ts`'s two-reads pattern (quote its docblock discipline in this module's own docblock).

- [ ] **Step 1: Write failing DB-backed tests** — one per builder against small seeded fixtures (seed players + stat-line observations + team observations for two synthetic seasons; assert the condition flags, the points/game arithmetic, and that a season-N+1-only fact cannot flip a condition). Follow `backtest.test.ts` fixture helpers exactly; keep to ONE test db.
- [ ] **Step 2: Run to verify failure** — `npx vitest run src/projections/laws/populations.test.ts --no-file-parallelism`
- [ ] **Step 3: Implement `populations.ts`** (keep under 400 lines: one small builder function per law, shared season-aggregation helpers at top).
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(laws): six law populations behind as-of-gated reads"`

---

### Task 6: Measurement script, committed registry, and drift test

**Files:**
- Create: `scripts/measure-laws.ts`
- Create: `src/projections/laws/registry.ts`
- Create: `src/projections/laws/measured.json` (generated by the script, committed)
- Test: `src/projections/laws/registry.test.ts`
- Modify: `package.json` (`"laws:measure": "dotenv -e .env.local -- tsx scripts/measure-laws.ts"`)

**Interfaces:**
- Consumes: `LAW_SPECS` (Task 5), harness (Task 4), config seasons.
- Produces: `registry(): readonly Law[]` — merges each `LawSpec`'s static fields with its entry in `measured.json`; THROWS if any spec lacks a measurement or any measurement lacks a spec (fail fast, no silent drift). `measured.json` shape: `{ readonly [lawId: string]: LawMeasurement & { readonly verdict: LawVerdict } }`.

- [ ] **Step 1: Write the failing registry tests** — `registry()` throws on a missing/orphaned measurement (temporarily-shaped fixtures via dependency injection: `registryFrom(specs, measuredJson)` is the pure testable core; `registry()` is the thin file-reading wrapper); every returned `Law` carries a verdict consistent with `verdictFor(measurement, spec.expectedSign)`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement `registry.ts` and `scripts/measure-laws.ts`.** The script: for each spec, build the population over `MEASURE_SEASONS`, split held-out (`HELD_OUT_SEASONS`) from the rest, measure on held-out only, print a table (id, effect, CI, sample, verdict), and write `measured.json` sorted by id. A `--check` flag recomputes and exits 1 on any difference from the committed file (this is the drift guard; document in the script header that it costs DB reads, not API requests).
- [ ] **Step 4: Run the real measurement** — `npm run laws:measure` against the dev DB (nflverse history must be ingested; if `ingestCoaches`/schedule/pbp backfills are missing seasons, run the documented backfill scripts first — see `scripts/projection-backfill.ts`). Commit whatever verdicts the data returns. Do not tune calipers or thresholds to reach a wanted verdict; a debunked founder-favorite law is a RESULT (the spec ships debunked laws as content).
- [ ] **Step 5: Run `npm run laws:measure -- --check`** — expect exit 0. Run the registry tests. Commit:

```bash
git add scripts/measure-laws.ts src/projections/laws package.json
git commit -m "feat(laws): measured registry with drift-checked committed verdicts"
```

---

### Task 7: Board reasons store and the law reason variant

**Files:**
- Modify: `src/projections/preseason/board.ts` (extend `BoardReason`)
- Modify: `src/projections/preseason/board-store.ts` (persist reasons — the module's own docblock declares this omission deliberate and temporary; lift it)
- Create: migration `drizzle/00XX_board_reasons.sql` via the repo's migration flow (read how 0052–0058 were generated; follow it exactly)
- Modify: `src/db/schema.ts` (`preseasonBoardReasons` table: `source text`, `season int`, `playerId text`, `code text`, `payload jsonb`, PK `(source, season, playerId, code)`)
- Test: extend `src/projections/preseason/board-store.test.ts`

**Interfaces:**
- Consumes: Task 6's `registry()`; existing `BoardCandidate.reasons`, `projectionRows`, `BOARD_SOURCE`.
- Produces:
  - `BoardReason` union gains: `| { readonly code: "law"; readonly lawId: string; readonly effect: number; readonly magnitude: number }`.
  - Board assembly attaches law reasons: for each candidate, each CONFIRMED law whose condition holds for him next season (re-using the population builders' condition logic — extract the per-player condition predicate from Task 5 into `populations.ts` exports so board and measurement share one definition) yields a law reason with `magnitude` = the player's own value of the condition quantity (touches, age, share, caller PROE).
  - `board-store.ts`: `reasonRows(board, stamp)` writing `preseason_board_reasons`; a read function `boardReasons(db, source, season): Promise<ReadonlyMap<string, readonly BoardReason[]>>`.
- [ ] Steps: failing store test (write rows, read them back typed; unknown `code` rows are DROPPED on read with a counted warning, never a throw) → fail → migrate dev+test DBs → implement → pass → run the full preseason suite serially → commit `feat(projections): persist board reasons; law-backed reason variant`.

---

### Task 8: Reason chips in the draft room and PlayerPeek outlook

**Files:**
- Modify: `src/draft-room/components/draft-board.tsx` (chips per player row; read its current props first)
- Modify: `src/league-room/components/player-peek.tsx` (an "Outlook" section)
- Create: `src/components/ui/reason-chip.tsx`
- Modify: whichever server route/loader feeds each surface (trace from the components; pass `boardReasons` maps through existing props patterns)
- Tests: UI suites are on the deferred UX ledger; verify with `npx tsc --noEmit` and lab screenshots per the screenshot protocol.

**Interfaces:**
- Consumes: Task 7's `boardReasons`, `registry()` (for law claims in copy).
- Produces: `ReasonChip({ reason, registry })` rendering structured copy per code. Law chips render the claim clause with the player's magnitude and the measured effect, e.g. `Age 29 season: measured -1.8 pts/game` (copy assembled from registry numbers, nothing typed; no em-dashes). At most TWO chips per player row (strongest |effect| first); PlayerPeek's Outlook shows the full chain.
- [ ] Steps: implement → `npx tsc --noEmit` clean on production code → screenshots of draft board + PlayerPeek via lab scripts → commit `feat(ui): law-backed reason chips on the board and player card`.

---

### Task 9: The /player-laws page

**Files:**
- Create: `src/app/player-laws/page.tsx` (mirror `src/app/league-rules/` structure and register alongside it in nav/footer where league-rules is linked; read that page first)
- Tests: deferred UX ledger; `tsc` + screenshot.

**Interfaces:**
- Consumes: `registry()`.
- Produces: a public reference page: one section per law — claim in plain words, verdict rendered as a plain sentence ("Confirmed", "Not supported by the data" for debunked), measured effect with CI, sample, seasons measured. Debunked laws get equal billing with copy framing what the data actually shows. Sunday v5; no em-dashes; every figure from the registry.
- [ ] Steps: implement → `tsc` → screenshot → commit `feat(app): player laws reference page`.

---

### Task 10: The bar — ADP scorecard and close-out

**Files:**
- Create: `docs/research/2026-08-31-prediction-laws-closeout.md`

- [ ] **Step 1:** Run the existing preseason benchmark comparison (`npm run projections:preseason` / `preseason-diagnose` — read `scripts/preseason-report.ts` to pick the right one) on held-out seasons with the play-caller table and confirmed-law gating in place.
- [ ] **Step 2:** Record in the close-out doc: the board-vs-ADP scorecard (spearman/MAE per `ScoreCard`) before and after this round, every law's verdict table, the play-caller coverage stats, and what was deferred. If ADP is not beaten, the doc says so plainly and states the best current hypothesis.
- [ ] **Step 3:** Commit `docs(research): prediction laws close-out with ADP scorecard`.

---

## Self-review (performed at write time)

- **Spec coverage:** Part 1 → Tasks 1–3; Part 2 → Tasks 4–6; Part 3 → Tasks 7–9; Part 4 → Task 10. Sequencing matches the spec's. Out-of-scope list respected (no new DB engine, no rookie college modeling, no PFR crawling, no PFR names in product).
- **Placeholders:** none knowingly left; Task 5's `wr_target_competition` names its simplification rule explicitly rather than hiding a TBD (the implementer must state the final condition in the law's claim).
- **Type consistency:** `PlayCallerRow`, `PlayerSeasonPoint`, `LawMeasurement`, `Law`, `LawSpec`, the `"law"` reason variant, and `boardReasons` are each defined once and consumed by name in later tasks.
