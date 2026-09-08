# Fact Sheet Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The fact sheet the writer receives carries every verified fact this product holds that an expert would cite, each grounded so the validator lets the writer quote it, with absence rendered as absence.

**Architecture:** Every new fact is a new field on one new `PlayerFacts.depth` group, built by pure readers under `src/capsules/facts/` and rendered as one appended section in `src/capsules/render-depth.ts`. `facts.ts`, `render.ts`, `collect.ts` and `collect-one.ts` change ADDITIVELY only (one new field, one new section call, one new batched collector call), because a parallel engineer owns the writer round on the same files and lands first.

**Tech Stack:** TypeScript strict, Next.js 15, Drizzle over Postgres, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-07-fact-sheet-depth-design.md`

## Global Constraints

- Honest data is absolute. Every number traces to a store row, every name to a roster, coaches or universe row, every date to a capture. Nothing inferred, nothing defaulted to zero for a season the store lacks.
- Absence is rendered as absence: no line at all, never a guess and never a fabricated zero.
- Copy rules on the sheet: no em-dashes, no semicolons, no competitor names.
- Functions under 50 lines, files under 800 lines, immutability, explicit errors, no `any`.
- Do not touch `src/capsules/validate.ts`, `src/capsules/write.ts`, `src/capsules/narrative.ts`, the sweep job, or the acceptance script. The parallel writer round owns those and merges first.
- Every fact wired cites its row in `docs/research/2026-09-07-fact-sheet-inventory.md`.
- Commit messages use conventional prefixes and the two trailers `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS`.
- Gates per task: `npx tsc --noEmit -p .`, `npx eslint <touched files>`, targeted `npx vitest run <touched test files>`.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/capsules/facts/types.ts` | Every new `PlayerFactsDepth*` interface, plus the `PlayerFactsDepth` aggregate. Types only, no logic. |
| `src/capsules/facts/ledger.ts` | `depthNumbers(depth)` and `depthNames(depth)`: the ledger contribution of the whole depth group, walked in one fixed field order. |
| `src/capsules/facts/availability.ts` | Facts 1 and 2: season-ending absences per prior season and games missed by season. |
| `src/capsules/facts/injury-history.ts` | Fact 3: this season's designation changes, from the harvest captures. |
| `src/capsules/facts/coaching.ts` | Fact 4: head coach and offensive play caller by name, each with a new-this-year flag. |
| `src/capsules/facts/pedigree.ts` | Fact 5: age on opening day, seasons played, draft year, round, pick, drafting club. |
| `src/capsules/facts/depth-chart.ts` | Fact 6: his listed slot and the players listed around him, dated. |
| `src/capsules/facts/role.ts` | Facts 7 and 8: role trend inside last season, and his team's top two target earners. |
| `src/capsules/facts/scoring-usage.ts` | Fact 9: red-zone and inside-ten touches, targets and average depth of target, with ranks. |
| `src/capsules/facts/team-context.ts` | Fact 10: last season's team pace, pass rate and points, plus week one's implied team total and spread. |
| `src/capsules/facts/schedule.ts` | Fact 11: week-one opponent, home and road split, dome games, weeks 15 to 17 opponents. |
| `src/capsules/facts/market-movement.ts` | Fact 12: ADP now against the oldest capture in the window. |
| `src/capsules/facts/career.ts` | Facts 13 and 14: weekly volatility, and the three prior seasons at a glance. |
| `src/capsules/facts/collect-depth.ts` | The one batched collector: every database read the depth facts need, once per board, plus the per-player merge. |
| `src/capsules/render-depth.ts` | `renderDepthSection(facts)`: the depth facts as plain sentences under one heading. |

**Modified**

| File | Change |
| --- | --- |
| `src/capsules/facts.ts` | One new field `depth: PlayerFactsDepth`, added to the canonical hash object, and two calls into `facts/ledger.ts`. |
| `src/capsules/render.ts` | One appended section from `render-depth.ts`. |
| `src/capsules/collect.ts` | One new batched call in the existing `Promise.all`, one new field on `ColorFacts`, one new field in `factsInputFor`. |
| `src/capsules/collect-one.ts` | The same three, narrowed to one player. |
| `data/play-callers/play-callers.csv` | A ninth `head_coach` column. |
| `src/projections/nflverse/play-callers.ts` | Parse and validate the ninth column; a head-coach lookup. |
| `scripts/validate-play-callers.ts` | Pass the head-coach coverage window to the validator. |

---

### Task 1: The inventory

**Files:**
- Create: `docs/research/2026-09-07-fact-sheet-inventory.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the row every later task cites, and the "needs a production backfill" list Task 16 reports.

- [ ] **Step 1: Read production coverage with one grouped count per table**

Production is read ONLY through counts, never a content scan, per the standing rule. One query per table, run from a throwaway script outside the repo tree:

```js
const rows = await sql.unsafe(`select season, count(*)::bigint as n from ${table} group by 1 order by 1`);
```

Tables: `nflverse_injuries`, `nflverse_roster_weeks`, `nfl_draft_picks`, `player_week_observations`, `team_week_observations`, `player_week_teams`, `preseason_rosters`. Plus one grouped count over `player_week_observations (source, metric)` and `team_week_observations (source, metric)`, one over `capture_snapshots (source)`, one over `adp_snapshots (source, format)`, and a plain `count(*)` for `nfl_players`, `adp_snapshots`, `nfl_games`, `players`, `player_capsules`.

- [ ] **Step 2: Write the table**

Columns exactly as the spec names them: fact, source table and metric, seasons covered in DEV, production coverage, on the sheet today, expert value, grounding shape. One row per candidate fact, not one per wired fact, so a fact judged low value still records why.

- [ ] **Step 3: Write the "needs a production backfill" section**

Each entry names the missing rows, the script that fills them, and which sheet line stays absent until it runs.

- [ ] **Step 4: Commit**

```bash
git add docs/research/2026-09-07-fact-sheet-inventory.md
git commit -m "docs(capsules): the fact sheet inventory, dev coverage against one production count per table"
```

---

### Task 2: The depth group's skeleton, its ledger, and its heading

**Files:**
- Create: `src/capsules/facts/types.ts`, `src/capsules/facts/ledger.ts`, `src/capsules/facts/ledger.test.ts`, `src/capsules/render-depth.ts`, `src/capsules/render-depth.test.ts`
- Modify: `src/capsules/facts.ts`, `src/capsules/render.ts`, `src/capsules/collect.ts`, `src/capsules/collect-one.ts`

**Interfaces:**
- Consumes: `PlayerFacts` from `src/capsules/facts.ts`.
- Produces:
  - `export interface PlayerFactsDepth { readonly seasonEndings: readonly PlayerFactsSeasonEnding[]; readonly gamesMissed: readonly PlayerFactsGamesMissed[]; readonly injuryHistory: readonly PlayerFactsInjuryDesignation[]; readonly coaching: PlayerFactsCoaching | null; readonly pedigree: PlayerFactsPedigree | null; readonly depthChart: PlayerFactsDepthChart | null; readonly roleTrend: PlayerFactsRoleTrend | null; readonly targetCompetition: PlayerFactsTargetCompetition | null; readonly scoringUsage: PlayerFactsScoringUsage | null; readonly teamContext: PlayerFactsTeamContext | null; readonly schedule: PlayerFactsSchedule | null; readonly marketMovement: PlayerFactsMarketMovement | null; readonly volatility: PlayerFactsVolatility | null; readonly priorSeasons: readonly PlayerFactsPriorSeason[]; }`
  - `export const EMPTY_DEPTH: PlayerFactsDepth` — every list empty, every object `null`. The honest "the store held nothing" value, and the value every existing test keeps without change.
  - `export function depthNumbers(depth: PlayerFactsDepth): readonly number[]`
  - `export function depthNames(depth: PlayerFactsDepth): readonly string[]`
  - `export function renderDepthSection(facts: PlayerFacts): string | null`
  - `PlayerFacts.depth: PlayerFactsDepth` and `PlayerFactsInput.depth: PlayerFactsDepth`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/capsules/render-depth.test.ts
it("renders no depth section at all when the store held nothing", () => {
  const facts = buildPlayerFacts(baseInput());
  expect(renderDepthSection(facts)).toBeNull();
  expect(renderFactsForModel(facts).includes("The record:")).toBe(false);
});
```

```ts
// src/capsules/facts/ledger.test.ts
it("contributes nothing to either ledger for an empty depth group", () => {
  expect(depthNumbers(EMPTY_DEPTH)).toEqual([]);
  expect(depthNames(EMPTY_DEPTH)).toEqual([]);
});
```

- [ ] **Step 2: Run them to watch them fail**

Run: `npx vitest run src/capsules/render-depth.test.ts src/capsules/facts/ledger.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the skeleton**

`types.ts` declares `PlayerFactsDepth` with all fourteen fields typed as the later tasks will define them, plus `EMPTY_DEPTH`. `ledger.ts` walks the fourteen fields in declaration order and returns empty arrays while every field is empty. `render-depth.ts` collects section lines and returns `null` when there are none. `facts.ts` adds `depth: input.depth` to its content object, adds `content.depth` to `computeFactsHash`'s canonical object, and appends `...depthNumbers(facts.depth)` / the names to the two ledger builders. `render.ts` appends:

```ts
const depth = renderDepthSection(facts);
if (depth !== null) sections.push(depth);
```

`collect.ts` and `collect-one.ts` pass `EMPTY_DEPTH` for now, so every existing test still passes unchanged.

- [ ] **Step 4: Run the gates**

Run: `npx tsc --noEmit -p .` then `npx vitest run src/capsules/render.test.ts src/capsules/facts.test.ts src/capsules/render-depth.test.ts src/capsules/facts/ledger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/capsules/facts src/capsules/render-depth.ts src/capsules/render-depth.test.ts src/capsules/facts.ts src/capsules/render.ts src/capsules/collect.ts src/capsules/collect-one.ts
git commit -m "feat(capsules): the depth fact group, its ledger and its own heading, empty for now"
```

---

### Task 3: Season-ending absences, per prior season (spec fact 1)

**Files:**
- Create: `src/capsules/facts/availability.ts`, `src/capsules/facts/availability.test.ts`
- Modify: `src/capsules/facts/types.ts`, `src/capsules/facts/ledger.ts`, `src/capsules/render-depth.ts`

**Interfaces:**
- Consumes: `deriveSeasonEnding`, `SeasonEnding` from `@/projections/availability/season-end`.
- Produces:
  - `export interface PlayerFactsSeasonEnding { readonly season: number; readonly lastPlayedWeek: number; readonly firstMissedWeek: number; readonly source: "report" | "status"; readonly reportStatus: string | null; readonly rosterStatus: string | null; readonly primaryInjury: string | null; }`
  - `export interface SeasonEndingInput { readonly season: number; readonly injuryRows: readonly WeeklyInjuryReport[]; readonly statusRows: readonly WeeklyRosterStatus[]; readonly gamesPlayedWeeks: readonly number[]; }`
  - `export function seasonEndingsFor(inputs: readonly SeasonEndingInput[]): readonly PlayerFactsSeasonEnding[]` — one entry per season the evidence supports, ascending by season, never an entry for a season the store held no rows for.

- [ ] **Step 1: Write the failing test**

```ts
it("reports the season the report anchored, and says nothing about a season with no rows", () => {
  const endings = seasonEndingsFor([
    { season: 2025, injuryRows: [{ week: 5, reportStatus: "Out", primaryInjury: "Knee" }], statusRows: [], gamesPlayedWeeks: [1, 2, 3, 4] },
    { season: 2024, injuryRows: [], statusRows: [], gamesPlayedWeeks: [] },
  ]);
  expect(endings).toEqual([
    { season: 2025, lastPlayedWeek: 4, firstMissedWeek: 5, source: "report", reportStatus: "Out", rosterStatus: null, primaryInjury: "Knee" },
  ]);
});

it("falls back to the roster status with no body part invented", () => {
  const [ending] = seasonEndingsFor([
    { season: 2025, injuryRows: [], statusRows: [{ week: 6, status: "RES" }, { week: 7, status: "RES" }], gamesPlayedWeeks: [1, 2, 3, 4, 5] },
  ]);
  expect(ending).toEqual({ season: 2025, lastPlayedWeek: 5, firstMissedWeek: 6, source: "status", reportStatus: null, rosterStatus: "RES", primaryInjury: null });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/capsules/facts/availability.test.ts`
Expected: FAIL, `seasonEndingsFor` is not exported.

- [ ] **Step 3: Implement**

`seasonEndingsFor` maps each input through `deriveSeasonEnding` and drops the `null`s. A `"report"` result carries `reportStatus` and `primaryInjury` and a `null` `rosterStatus`; a `"status"` result carries `rosterStatus` and two `null`s. Nothing is re-derived.

- [ ] **Step 4: Render, ledger and their tests**

`render-depth.ts` gains, under the same heading:

```ts
function seasonEndingLines(depth: PlayerFactsDepth): readonly string[] {
  return depth.seasonEndings.map((ending) => {
    const cause = ending.source === "report"
      ? `the injury report said ${ending.reportStatus}${ending.primaryInjury === "" || ending.primaryInjury === null ? "" : `, ${ending.primaryInjury.toLowerCase()}`}`
      : `the weekly roster listed him ${ending.rosterStatus} with no body part on file`;
    return `His ${ending.season} season ended after week ${ending.lastPlayedWeek}. He was not available from week ${ending.firstMissedWeek} on and ${cause}.`;
  });
}
```

`ledger.ts` pushes `season`, `lastPlayedWeek` and `firstMissedWeek` per entry. The render test asserts the line is present with data and absent without; the ledger test asserts the three numbers are on `numberLedger`.

- [ ] **Step 5: Run the gates and commit**

```bash
npx tsc --noEmit -p . && npx eslint src/capsules/facts src/capsules/render-depth.ts && npx vitest run src/capsules/facts src/capsules/render-depth.test.ts
git commit -m "feat(capsules): season-ending absences per prior season on the fact sheet"
```

---

### Task 4: Games missed by season (spec fact 2)

**Files:**
- Modify: `src/capsules/facts/availability.ts`, `src/capsules/facts/availability.test.ts`, `src/capsules/facts/types.ts`, `src/capsules/facts/ledger.ts`, `src/capsules/render-depth.ts`

**Interfaces:**
- Produces:
  - `export interface PlayerFactsGamesMissed { readonly season: number; readonly missed: number; readonly teamGames: number; }`
  - `export function gamesMissedFor(inputs: readonly GamesMissedInput[]): readonly PlayerFactsGamesMissed[]` where `GamesMissedInput = { readonly season: number; readonly teamGames: number; readonly rosteredWeeks: readonly number[]; readonly gamesPlayedWeeks: readonly number[]; }`.

The count is `rosteredWeeks` he did not play, never `teamGames` minus games played: a player who was not on any roster that week is not a player who missed a game, and `teamGames` is only carried so the sentence can say the denominator honestly. A season with no roster rows at all produces NO entry, never a zero.

- [ ] **Step 1: Write the failing test**

```ts
it("counts only the weeks the roster actually carried him, and omits a season the roster never carried", () => {
  expect(gamesMissedFor([
    { season: 2025, teamGames: 17, rosteredWeeks: [1, 2, 3, 4, 5, 6], gamesPlayedWeeks: [1, 2, 3] },
    { season: 2024, teamGames: 17, rosteredWeeks: [], gamesPlayedWeeks: [] },
  ])).toEqual([{ season: 2025, missed: 3, teamGames: 17 }]);
});
```

- [ ] **Step 2: Run it, watch it fail, implement, run it again**

- [ ] **Step 3: Render and ledger**

One sentence for all seasons: `He missed 3 of a possible 17 games in 2025 and 0 in 2024. The store holds no roster weeks for any other season.` The trailing clause is emitted only from the seasons actually asked for, never as a claim about seasons the caller did not name.

- [ ] **Step 4: Gates and commit**

```bash
git commit -m "feat(capsules): games missed by season, counted from the weeks the roster carried him"
```

---

### Task 5: Injury designations this season, as a history (spec fact 3)

**Files:**
- Create: `src/capsules/facts/injury-history.ts`, `src/capsules/facts/injury-history.test.ts`
- Modify: `src/capsules/facts/types.ts`, `src/capsules/facts/ledger.ts`, `src/capsules/render-depth.ts`

**Interfaces:**
- Produces:
  - `export interface PlayerFactsInjuryDesignation { readonly designation: string; readonly description: string | null; readonly firstSeenAt: string; readonly lastSeenAt: string; readonly captureCount: number; }`
  - `export interface InjuryCapture { readonly capturedAt: Date; readonly designations: ReadonlyMap<string, { readonly designation: string; readonly description: string | null }>; }`
  - `export function injuryHistoryFor(playerId: string, captures: readonly InjuryCapture[]): readonly PlayerFactsInjuryDesignation[]`
  - `export function parseInjuryCapture(payload: unknown, capturedAt: Date): InjuryCapture`
  - `export async function injuryCapturesFor(db: ReadonlyDb, since: Date, limit: number): Promise<readonly InjuryCapture[]>`

Runs of the same designation collapse into one entry with a first and last capture instant and how many captures carried it, so "questionable for three straight weeks" is a fact rather than three identical lines. The body part comes from the feed's own description text, `null` when the feed carried none. A player never named in any capture yields an empty list, which renders nothing.

- [ ] **Step 1: Write the failing test**

```ts
it("collapses a run of the same designation and keeps a real change as its own entry", () => {
  const at = (iso: string) => new Date(iso);
  const cap = (iso: string, designation: string, description: string | null): InjuryCapture => ({
    capturedAt: at(iso),
    designations: new Map([["p1", { designation, description }]]),
  });
  expect(injuryHistoryFor("p1", [
    cap("2026-08-25T00:00:00.000Z", "Q", "Hamstring"),
    cap("2026-09-01T00:00:00.000Z", "Q", "Hamstring"),
    cap("2026-09-05T00:00:00.000Z", "O", "Hamstring"),
  ])).toEqual([
    { designation: "Q", description: "Hamstring", firstSeenAt: "2026-08-25", lastSeenAt: "2026-09-01", captureCount: 2 },
    { designation: "O", description: "Hamstring", firstSeenAt: "2026-09-05", lastSeenAt: "2026-09-05", captureCount: 1 },
  ]);
});
```

- [ ] **Step 2: Run it, watch it fail, implement, run it again**

`injuryCapturesFor` reads `capture_snapshots` where `source = 'tank01_injuries_by_date'` and `captured_at >= since`, oldest first, capped by `limit` — the same single-source read `injurySnapshot` already performs, widened from `LIMIT 1` to a bounded window.

- [ ] **Step 3: Render and ledger**

`Injury designations captured this season: Q from 2026-08-25 to 2026-09-01 across 2 captures, hamstring. O on 2026-09-05, hamstring.` Numbers ledgered: each capture count and each date's year, month and day parts, matching `printedTextNumbers`' existing rule for the injury line's own date.

- [ ] **Step 4: Gates and commit**

```bash
git commit -m "feat(capsules): this season's injury designations as a dated history from the harvest captures"
```

---

### Task 6: Coaches (spec fact 4)

**Files:**
- Modify: `data/play-callers/play-callers.csv`, `src/projections/nflverse/play-callers.ts`, `src/projections/nflverse/play-callers.test.ts`, `scripts/validate-play-callers.ts`
- Create: `src/capsules/facts/coaching.ts`, `src/capsules/facts/coaching.test.ts`
- Modify: `src/capsules/facts/types.ts`, `src/capsules/facts/ledger.ts`, `src/capsules/render-depth.ts`

**Interfaces:**
- Produces:
  - `PlayCallerRow` gains `readonly headCoach: string`.
  - `export function headCoachLookup(rows: readonly PlayCallerRow[]): (team: string, season: number) => string | null`
  - `export interface PlayerFactsCoaching { readonly season: number; readonly headCoach: string | null; readonly headCoachIsNew: boolean | null; readonly playCaller: string | null; readonly playCallerRole: "HC" | "OC" | null; readonly playCallerIsNew: boolean | null; }`
  - `export function coachingFor(team: string, season: number, rows: readonly PlayCallerRow[]): PlayerFactsCoaching | null`

**The head-coach column ruling.** The CSV gains a ninth `head_coach` column. Populating 945 historical rows from model memory would be fabricating the citation the `source` column exists to carry, so the column is filled ONLY for the seasons a fact sheet reads, from a source actually fetched and recorded in `note`, and `validatePlayCallers` requires it non-empty for exactly those seasons through a new `headCoachSeasons` argument. Every other row carries an empty `head_coach`, which renders as absence.

`headCoachIsNew` / `playCallerIsNew` are `null`, never `false`, when the file has nothing for the prior season: "we cannot tell" is not "he is not new".

- [ ] **Step 1: Write the failing parser and validator tests**

```ts
it("parses the head coach column and reports a season missing one", () => {
  const rows = parsePlayCallers("season,team,name,role,start_week,end_week,source,note,head_coach\n2026,SF,Klay Kubiak,OC,1,17,wikipedia,,Kyle Shanahan\n");
  expect(rows[0]!.headCoach).toBe("Kyle Shanahan");
  expect(validatePlayCallers(rows, [2026], () => ["SF"], () => 17, [2026])).toEqual([]);
  const blank = parsePlayCallers("season,team,name,role,start_week,end_week,source,note,head_coach\n2026,SF,Klay Kubiak,OC,1,17,wikipedia,,\n");
  expect(validatePlayCallers(blank, [2026], () => ["SF"], () => 17, [2026])).toEqual(["SF 2026: empty head_coach."]);
});
```

- [ ] **Step 2: Run, watch it fail, widen the parser to nine columns and the validator to the new argument**

- [ ] **Step 3: Fill the column for the covered seasons**

Fetch the head coaches for the covered seasons from Wikipedia, record the URL in each filled row's `note`, and run `npm run facts:play-callers` until it exits zero. If the fetch cannot be made, the column stays empty everywhere, the coverage window is empty, the line renders as absence, and the inventory records it under "needs a production backfill" instead. Never type a name from memory into a row whose `source` claims a citation.

- [ ] **Step 4: Write the fact, render and ledger tests, implement, run them**

`Coaches for 2026: head coach Kyle Shanahan, in his ninth season. Offensive play caller Klay Kubiak, new this year.` The word "new" appears only where the flag is `true`; a `null` flag prints the name with no tenure claim at all.

- [ ] **Step 5: Gates and commit**

```bash
git commit -m "feat(capsules): head coach and play caller by name, with a new-this-year flag from the curated table"
```

---

### Task 7: Age, experience and pedigree (spec fact 5)

**Files:**
- Create: `src/capsules/facts/pedigree.ts`, `src/capsules/facts/pedigree.test.ts`
- Modify: `src/capsules/facts/types.ts`, `src/capsules/facts/ledger.ts`, `src/capsules/render-depth.ts`

**Interfaces:**
- Produces:
  - `export interface PlayerFactsPedigree { readonly ageOnOpeningDay: number | null; readonly seasonsPlayed: number | null; readonly draftYear: number | null; readonly draftRound: number | null; readonly draftPick: number | null; readonly draftClub: string | null; readonly undrafted: boolean | null; }`
  - `export function pedigreeFor(input: PedigreeInput): PlayerFactsPedigree | null`

Sources, all real rows: `preseason_rosters.birth_date` / `draft_year` / `draft_pick` / `draft_club` for the product season, `nfl_players.rookie_season` for seasons played, `nfl_draft_picks.round` for the round. Age is computed to one decimal from the birth date and the season's first kickoff instant, both stored values. `undrafted` is `true` only when the roster row itself carries a `draft_pick` of `null` alongside a real `draft_year`; it is `null` when the roster row is absent, because a missing row is not evidence of anything. College is not held anywhere in this store and is therefore not a field.

- [ ] **Step 1: Write the failing test**

```ts
it("computes age from the stored birth date and opening day, and reports an absent round as absent", () => {
  expect(pedigreeFor({
    birthDate: "2001-07-15", openingDay: new Date("2026-09-10T00:20:00.000Z"),
    rookieSeason: 2023, productSeason: 2026, draftYear: 2023, draftPick: 22, draftClub: "NYG", draftRound: null,
  })).toEqual({ ageOnOpeningDay: 25.2, seasonsPlayed: 3, draftYear: 2023, draftRound: null, draftPick: 22, draftClub: "NYG", undrafted: false });
});

it("returns null when the store holds no pedigree row at all", () => {
  expect(pedigreeFor({ birthDate: null, openingDay: null, rookieSeason: null, productSeason: 2026, draftYear: null, draftPick: null, draftClub: null, draftRound: null })).toBeNull();
});
```

- [ ] **Step 2: Run, fail, implement, pass**

- [ ] **Step 3: Render and ledger**

`Age 25.2 on opening day, entering his fourth season. Drafted in 2023 at pick 22 by NYG.` Every clause is dropped independently when its own value is `null`.

- [ ] **Step 4: Gates and commit**

```bash
git commit -m "feat(capsules): age, experience and draft pedigree from the roster and draft archives"
```

---

### Task 8: Depth chart (spec fact 6)

**Files:**
- Create: `src/capsules/facts/depth-chart.ts`, `src/capsules/facts/depth-chart.test.ts`
- Modify: `src/capsules/facts/types.ts`, `src/capsules/facts/ledger.ts`, `src/capsules/render-depth.ts`

**Interfaces:**
- Produces:
  - `export interface PlayerFactsDepthChart { readonly season: number; readonly asOf: string; readonly slot: number; readonly aroundHim: readonly { readonly name: string; readonly slot: number }[]; }`
  - `export function depthChartFor(playerId: string, team: string, position: Position, rows: readonly DepthRow[], names: ReadonlyMap<string, string>): PlayerFactsDepthChart | null`

`DepthRow` is `{ playerId, team, position, slot, season, asOf }`, built by the collector from `player_week_observations` source `nflverse_depth_charts`, metric `depth_team`, joined to the player's team through `player_week_teams`. `aroundHim` is every teammate at his own position with a real slot, ascending, at most four, excluding him.

- [ ] **Step 1: Write the failing test**

```ts
it("lists his slot and the teammates around him, and nothing when the chart never names him", () => {
  const rows = [
    { playerId: "a", team: "NYG", position: "WR", slot: 1, season: 2026, asOf: new Date("2026-09-01T00:00:00.000Z") },
    { playerId: "b", team: "NYG", position: "WR", slot: 2, season: 2026, asOf: new Date("2026-09-01T00:00:00.000Z") },
  ];
  const names = new Map([["a", "Malik Nabers"], ["b", "Wan'Dale Robinson"]]);
  expect(depthChartFor("a", "NYG", "WR", rows, names)).toEqual({
    season: 2026, asOf: "2026-09-01", slot: 1,
    aroundHim: [{ name: "Wan'Dale Robinson", slot: 2 }],
  });
  expect(depthChartFor("z", "NYG", "WR", rows, names)).toBeNull();
});
```

- [ ] **Step 2: Run, fail, implement, pass**

- [ ] **Step 3: Render and ledger**

`Depth chart as of 2026-09-01: listed first among NYG WRs, with Wan'Dale Robinson second.` Names go on `nameLedger`, slots and the date parts on `numberLedger`.

- [ ] **Step 4: Gates and commit**

```bash
git commit -m "feat(capsules): the dated depth chart slot and who is listed around him"
```

---

### Task 9: Role trend inside a season, and target competition (spec facts 7 and 8)

**Files:**
- Create: `src/capsules/facts/role.ts`, `src/capsules/facts/role.test.ts`
- Modify: `src/capsules/facts/types.ts`, `src/capsules/facts/ledger.ts`, `src/capsules/render-depth.ts`

**Interfaces:**
- Produces:
  - `export interface PlayerFactsRoleTrend { readonly season: number; readonly earlyWeeks: readonly number[]; readonly lateWeeks: readonly number[]; readonly snapShare: PlayerFactsSplitShare | null; readonly targetShare: PlayerFactsSplitShare | null; }` with `PlayerFactsSplitShare = { readonly early: number; readonly late: number }`.
  - `export interface PlayerFactsTargetCompetition { readonly season: number; readonly team: string; readonly leaders: readonly { readonly name: string; readonly share: number }[]; readonly combinedShare: number; }`
  - `export function roleTrendFor(season: number, weeks: readonly PlayerWeekShare[]): PlayerFactsRoleTrend | null`
  - `export function targetCompetitionFor(season: number, team: string, teamWeeks: readonly TeamPlayerTargets[], names: ReadonlyMap<string, string>): PlayerFactsTargetCompetition | null`

The split is the FIRST four and the LAST four weeks he actually has readings for, named explicitly on the object so the sentence can state them. Fewer than eight readings yields `null`, never an overlapping window. Target competition needs at least two players with a real team-target denominator; `leaders` is the top two by season share.

- [ ] **Step 1: Write the failing tests**

```ts
it("splits the first four readings against the last four and names both windows", () => {
  const weeks = [1, 2, 3, 4, 5, 6, 7, 8].map((week) => ({ week, snapShare: week / 10, targetShare: null }));
  expect(roleTrendFor(2025, weeks)).toEqual({
    season: 2025, earlyWeeks: [1, 2, 3, 4], lateWeeks: [5, 6, 7, 8],
    snapShare: { early: 0.25, late: 0.65 }, targetShare: null,
  });
});

it("refuses a split it cannot make without overlapping windows", () => {
  expect(roleTrendFor(2025, [1, 2, 3].map((week) => ({ week, snapShare: 0.5, targetShare: null })))).toBeNull();
});

it("names the two biggest target earners and their combined share", () => {
  const names = new Map([["a", "Ja'Marr Chase"], ["b", "Tee Higgins"], ["c", "Andrei Iosivas"]]);
  expect(targetCompetitionFor(2025, "CIN", [
    { playerId: "a", targets: 175, teamTargets: 580 },
    { playerId: "b", targets: 125, teamTargets: 580 },
    { playerId: "c", targets: 60, teamTargets: 580 },
  ], names)!.leaders.map((l) => l.name)).toEqual(["Ja'Marr Chase", "Tee Higgins"]);
});
```

- [ ] **Step 2: Run, fail, implement, pass**

- [ ] **Step 3: Render and ledger**

`His snap share went from 25% over weeks 1 to 4 of 2025 to 65% over weeks 14 to 17.` and `On CIN in 2025, Ja'Marr Chase took 30% of the targets and Tee Higgins took 22%, 52% between them.`

- [ ] **Step 4: Gates and commit**

```bash
git commit -m "feat(capsules): the in-season role trend and last season's target competition"
```

---

### Task 10: Red-zone and near-goal usage (spec fact 9)

**Files:**
- Create: `src/capsules/facts/scoring-usage.ts`, `src/capsules/facts/scoring-usage.test.ts`
- Modify: `src/capsules/facts/types.ts`, `src/capsules/facts/ledger.ts`, `src/capsules/render-depth.ts`

**Interfaces:**
- Produces:
  - `export interface PlayerFactsScoringUsage { readonly season: number; readonly redZoneTouches: PlayerFactsRankedStat | null; readonly insideTenTouches: PlayerFactsRankedStat | null; readonly targetDepth: PlayerFactsRankedStat | null; }`
  - `export function scoringUsageFor(season: number, tallies: ReadonlyMap<string, ScoringTally>, positions: ReadonlyMap<string, Position>, names: ReadonlyMap<string, string>): ReadonlyMap<string, PlayerFactsScoringUsage>`

`ScoringTally` sums `red_zone_carries + red_zone_targets`, `inside_ten_carries + inside_ten_targets`, and `air_yards / air_yard_targets`, all from `player_week_observations` source `nflverse_pbp_player`. Ranks reuse `rankWithinGroups` over the peers with a real reading of the same quantity, exactly as `rankedDiscoveryQuantity` already does. Average depth of target is `null` when `air_yard_targets` is zero, never an infinity.

- [ ] **Step 1: Write the failing test**

```ts
it("ranks red-zone touches among peers with a real reading and refuses a depth with no targets behind it", () => {
  const out = scoringUsageFor(2025,
    new Map([["a", { redZoneCarries: 30, redZoneTargets: 6, insideTenCarries: 12, insideTenTargets: 2, airYards: 0, airYardTargets: 0 }],
             ["b", { redZoneCarries: 10, redZoneTargets: 1, insideTenCarries: 3, insideTenTargets: 0, airYards: 400, airYardTargets: 50 }]]),
    new Map([["a", "RB"], ["b", "RB"]]), new Map([["a", "A Back"], ["b", "B Back"]]));
  expect(out.get("a")!.redZoneTouches).toEqual({ value: 36, positionRank: 1, qualifierCount: 2, namedNeighbor: null });
  expect(out.get("a")!.targetDepth).toBeNull();
  expect(out.get("b")!.targetDepth!.value).toBe(8);
});
```

- [ ] **Step 2: Run, fail, implement, pass**

- [ ] **Step 3: Render and ledger**

`Scoring-range usage (2025): red-zone touches 36, RB1 among 48 qualifying backs, best at the position. Touches inside the ten 14. Average depth of target 8.0 yards.`

- [ ] **Step 4: Gates and commit**

```bash
git commit -m "feat(capsules): red-zone, inside-the-ten and target-depth usage with honest ranks"
```

---

### Task 11: Team context (spec fact 10)

**Files:**
- Create: `src/capsules/facts/team-context.ts`, `src/capsules/facts/team-context.test.ts`
- Modify: `src/capsules/facts/types.ts`, `src/capsules/facts/ledger.ts`, `src/capsules/render-depth.ts`

**Interfaces:**
- Produces:
  - `export interface PlayerFactsTeamContext { readonly priorSeason: number; readonly paceSecondsPerPlay: number | null; readonly passRate: number | null; readonly pointsScored: number | null; readonly weekOneImpliedTotal: number | null; readonly weekOneSpread: number | null; }`
  - `export function teamContextFor(team: string, priorSeason: number, priorRows: readonly TeamMetricRow[], weekOneRows: readonly TeamMetricRow[]): PlayerFactsTeamContext | null`

Pace and pass rate are the season MEAN of the weeks the store holds, the same honest rule `seasonMeans` already keeps. Points scored is the SUM of `nflverse_kickoff` `game_result`'s companion, the team's own points, read from the schedule store; when the store holds no points rows the field is `null` rather than zero. `weekOneImpliedTotal` and `weekOneSpread` come from the product season's week one `nflverse_kickoff` rows. A team with nothing at all yields `null` and no line.

- [ ] **Step 1: Write the failing test**

```ts
it("averages the weeks the store holds and leaves an absent metric absent", () => {
  expect(teamContextFor("NYG", 2025,
    [{ week: 1, metric: "pace_seconds_per_play", value: 28 }, { week: 2, metric: "pace_seconds_per_play", value: 30 }],
    [{ week: 1, metric: "implied_team_total", value: 21.5 }])).toEqual({
    priorSeason: 2025, paceSecondsPerPlay: 29, passRate: null, pointsScored: null, weekOneImpliedTotal: 21.5, weekOneSpread: null,
  });
});
```

- [ ] **Step 2: Run, fail, implement, pass**

- [ ] **Step 3: Render and ledger**

`NYG in 2025 averaged 29.0 seconds a play. The books price their week one game at an implied 21.5 points.`

- [ ] **Step 4: Gates and commit**

```bash
git commit -m "feat(capsules): last season's team pace and pass rate beside week one's market view"
```

---

### Task 12: Schedule (spec fact 11)

**Files:**
- Create: `src/capsules/facts/schedule.ts`, `src/capsules/facts/schedule.test.ts`
- Modify: `src/capsules/facts/types.ts`, `src/capsules/facts/ledger.ts`, `src/capsules/render-depth.ts`

**Interfaces:**
- Produces:
  - `export interface PlayerFactsSchedule { readonly weekOneOpponent: PlayerFactsFixture | null; readonly homeGames: number; readonly roadGames: number; readonly indoorGames: number | null; readonly playoffWeeks: readonly PlayerFactsFixture[]; }` with `PlayerFactsFixture = { readonly week: number; readonly opponent: string; readonly home: boolean }`.
  - `export function scheduleFor(team: string, games: readonly ScheduledGame[], indoorsByWeek: ReadonlyMap<number, boolean>): PlayerFactsSchedule | null`

`ScheduledGame` is `{ week, homeTeam, awayTeam }` from `nfl_games`. Playoff weeks are 15, 16 and 17, named as opponents only, with no strength judgment. `indoorGames` is `null` when the schedule store carries no `indoors` rows for the team at all, never zero.

- [ ] **Step 1: Write the failing test**

```ts
it("reports the week one fixture, the home and road split and the playoff opponents", () => {
  const games = [
    { week: 1, homeTeam: "NYG", awayTeam: "DAL" },
    { week: 15, homeTeam: "PHI", awayTeam: "NYG" },
  ];
  expect(scheduleFor("NYG", games, new Map([[1, false], [15, false]]))).toEqual({
    weekOneOpponent: { week: 1, opponent: "DAL", home: true },
    homeGames: 1, roadGames: 1, indoorGames: 0,
    playoffWeeks: [{ week: 15, opponent: "PHI", home: false }],
  });
});
```

- [ ] **Step 2: Run, fail, implement, pass**

- [ ] **Step 3: Render and ledger**

`Schedule: opens at home against DAL in week 1. 1 home game and 1 road game on the published schedule, 0 of them indoors. Weeks 15 to 17: at PHI in week 15.` Opponent codes go on `nameLedger` through the same `teamNameForms` expansion the identity team already uses.

- [ ] **Step 4: Gates and commit**

```bash
git commit -m "feat(capsules): the published schedule, week one through the fantasy playoff weeks"
```

---

### Task 13: Market movement (spec fact 12)

**Files:**
- Create: `src/capsules/facts/market-movement.ts`, `src/capsules/facts/market-movement.test.ts`
- Modify: `src/capsules/facts/types.ts`, `src/capsules/facts/ledger.ts`, `src/capsules/render-depth.ts`

**Interfaces:**
- Produces:
  - `export interface PlayerFactsMarketMovement { readonly latestAdp: number; readonly latestAt: string; readonly earlierAdp: number; readonly earlierAt: string; readonly picks: number; }`
  - `export function marketMovementFor(history: readonly { readonly adp: number; readonly capturedAt: Date }[]): PlayerFactsMarketMovement | null`

The comparison is the newest capture against the OLDEST capture in the history handed in, with both dates printed, so the sentence never claims thirty days when the archive holds three. Fewer than two captures, or two captures on the same day, yields `null`. `picks` is `earlierAdp - latestAdp`, positive when the market has moved him up.

- [ ] **Step 1: Write the failing test**

```ts
it("states both dated captures and refuses a single one", () => {
  expect(marketMovementFor([
    { adp: 24, capturedAt: new Date("2026-08-08T00:00:00.000Z") },
    { adp: 13, capturedAt: new Date("2026-09-07T00:00:00.000Z") },
  ])).toEqual({ latestAdp: 13, latestAt: "2026-09-07", earlierAdp: 24, earlierAt: "2026-08-08", picks: 11 });
  expect(marketMovementFor([{ adp: 13, capturedAt: new Date("2026-09-07T00:00:00.000Z") }])).toBeNull();
});
```

- [ ] **Step 2: Run, fail, implement, pass**

- [ ] **Step 3: Render and ledger**

`The market has moved him up 11 picks, from 24 on 2026-08-08 to 13 on 2026-09-07.`

- [ ] **Step 4: Gates and commit**

```bash
git commit -m "feat(capsules): dated ADP movement between the two captures the archive actually holds"
```

---

### Task 14: Weekly volatility and the prior seasons at a glance (spec facts 13 and 14)

**Files:**
- Create: `src/capsules/facts/career.ts`, `src/capsules/facts/career.test.ts`
- Modify: `src/capsules/facts/types.ts`, `src/capsules/facts/ledger.ts`, `src/capsules/render-depth.ts`

**Interfaces:**
- Produces:
  - `export interface PlayerFactsVolatility { readonly season: number; readonly weeksPlayed: number; readonly weeksAboveThreshold: number; readonly threshold: number; readonly worstWeek: { readonly week: number; readonly points: number }; }`
  - `export interface PlayerFactsPriorSeason { readonly season: number; readonly points: number; readonly gamesPlayed: number; readonly positionRank: number; readonly qualifierCount: number; }`
  - `export function volatilityFor(season: number, weeks: readonly { readonly week: number; readonly points: number }[], threshold: number): PlayerFactsVolatility | null`
  - `export function priorSeasonsFor(playerId: string, seasons: readonly SeasonRankPass[]): readonly PlayerFactsPriorSeason[]`

The threshold is a named constant `START_WORTHY_POINTS = 15`, stated in the rendered sentence so the number is on the page rather than a hidden convention. A season the store holds no weeks for produces no entry at all.

- [ ] **Step 1: Write the failing test**

```ts
it("counts weeks above the stated threshold and names the worst week", () => {
  expect(volatilityFor(2025, [{ week: 1, points: 22 }, { week: 2, points: 4.5 }, { week: 3, points: 16 }], 15))
    .toEqual({ season: 2025, weeksPlayed: 3, weeksAboveThreshold: 2, threshold: 15, worstWeek: { week: 2, points: 4.5 } });
  expect(volatilityFor(2025, [], 15)).toBeNull();
});
```

- [ ] **Step 2: Run, fail, implement, pass**

- [ ] **Step 3: Render and ledger**

`He cleared 15 points in 2 of his 3 played weeks in 2025, and his worst was 4.5 in week 2.` and `The three prior seasons: 2025, 248 points over 15 games, RB4 among 62. 2024, 190 over 14, RB11 among 60.`

- [ ] **Step 4: Gates and commit**

```bash
git commit -m "feat(capsules): weekly volatility and the three prior seasons at a glance"
```

---

### Task 15: The batched collector

**Files:**
- Create: `src/capsules/facts/collect-depth.ts`, `src/capsules/facts/collect-depth.test.ts`
- Modify: `src/capsules/collect.ts`, `src/capsules/collect-one.ts`, `src/capsules/collect.test.ts`

**Interfaces:**
- Produces:
  - `export interface DepthFactsPass { readonly byGsisId: ReadonlyMap<string, PlayerFactsDepth>; }`
  - `export async function collectDepthFacts(db: Db, options: DepthCollectOptions): Promise<DepthFactsPass>` where `DepthCollectOptions = { readonly productSeason: number; readonly priorSeasons: readonly number[]; readonly positions: ReadonlyMap<string, Position>; readonly playerIds: readonly string[]; readonly teamByPlayerId: ReadonlyMap<string, string>; readonly asOf: Date; }`.

Every read is batched once for the whole population, the same discipline `collect.ts` already keeps: one `nflverse_injuries` read over the wanted seasons and players, one `nflverse_roster_weeks` read, one bounded `capture_snapshots` read, one `preseason_rosters` read, one `nfl_draft_picks` read, one `player_week_observations` read per season for the pbp-player and depth-chart metrics, one `team_week_observations` read, one `nfl_games` read, one `adp_snapshots` read. The curated coach table is read from disk once.

`collect.ts` adds exactly one entry to its second `Promise.all` and one field to `ColorFacts`; `factsInputFor` gains `depth: color.depthByGsisId.get(gsisId) ?? EMPTY_DEPTH`. `collect-one.ts` calls the same function with a one-player population.

- [ ] **Step 1: Write the failing integration test**

```ts
it("attaches an empty depth group for a player the depth stores hold nothing for", async () => {
  await seedBoard(db);
  const [facts] = await collectAllPlayerFacts(db, asOf);
  expect(facts!.depth).toEqual(EMPTY_DEPTH);
});
```

- [ ] **Step 2: Run, fail, implement, pass**

- [ ] **Step 3: Run the wider gates**

Run: `npx vitest run src/capsules` then `npx vitest run src/projections`
Expected: PASS except the recorded pre-existing failures.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(capsules): one batched collector for every depth fact, wired into both collectors"
```

---

### Task 16: The token measurement and the merge

**Files:**
- Create: `scripts/measure-fact-sheet-tokens.ts`
- Modify: `docs/research/2026-09-07-fact-sheet-inventory.md`

- [ ] **Step 1: Measure five players before and after**

The estimate is characters divided by four, the standard rough tokens-per-character for English prose, stated as an estimate in the record rather than as a tokenizer's count. Five real dev players, `renderFactsForModel` on each, the before figure taken from `git stash`ing the depth section off.

- [ ] **Step 2: Record it**

Add a "prompt size" section to the inventory with the five before and after figures, the mean growth, and the note that the new lines sit under one appended heading so the stable prefix ahead of them is unchanged and stays cacheable.

- [ ] **Step 3: Merge main and resolve**

```bash
git fetch origin && git merge origin/main
```

Resolve any conflict in `facts.ts`, `render.ts`, `collect.ts` and `collect-one.ts` in favour of keeping BOTH sides: this round's changes are additive by construction, so a conflict is a formatting collision, never a semantic one.

- [ ] **Step 4: Run every gate**

Run, one directory at a time so the test lane's connection ceiling is never crossed:

```bash
npx tsc --noEmit -p .
npx vitest run src/capsules
npx vitest run src/projections
npx vitest run src/league-service
npx vitest run src/design
```

- [ ] **Step 5: Commit**

```bash
git commit -m "docs(capsules): the prompt-size measurement before and after the depth section"
```

---

## Self-Review

**Spec coverage.** Section 3's inventory is Task 1. Section 4's fourteen facts are Tasks 3 to 14, in the spec's own order (1 and 2 in Tasks 3 and 4, 3 in Task 5, 4 in Task 6, 5 in Task 7, 6 in Task 8, 7 and 8 in Task 9, 9 in Task 10, 10 in Task 11, 11 in Task 12, 12 in Task 13, 13 and 14 in Task 14). Section 5's rules are the global constraints. Section 6's fixture tests are the render tests in every wiring task, and the acceptance script belongs to the parallel writer round. Section 4's prompt-token measurement is Task 16.

**Known gaps carried deliberately.** The college is not held in any store, so spec fact 5's "the college if held" renders as absence and the inventory says so. Production holds no `nfl_draft_picks` rows and no `nflverse_pbp` team metrics, so the draft round and last season's team pace stay absent in production until the backfills in Task 1's list run.
