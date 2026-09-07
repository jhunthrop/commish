# Fact Sheet Depth

**Status:** founder direction 2026-09-07: "add those, and find all things we can find that give the writing depth", after "are we passing prior year injuries, coaching changes, etc. to the LLM?" (answer: partly, not those). Standing directive from 2026-09-05: analysis as good as a human expert, pass the model every capturable verified fact ([[analysis-expert-grade-directive]]).

## 1. Goal

The fact sheet the writer receives (`src/capsules/render.ts`, from `PlayerFacts` in `src/capsules/facts.ts`) carries every verified fact we hold about a player that an expert would cite, each grounded so the validator lets the writer quote it. The writer then has something to say beyond the box score: why last season was short, who is calling plays now, how the role is trending, what the schedule and the market say.

## 2. What the sheet carries today

Projection and range; market price and our gap; per-game rank; snap, target and red-zone shares with ranks; last season's totals, per game, best week, weeks above median, touches and receiving-yards ranks; year-over-year trend; current injury designation with date; recent headlines with dates; props lines and team win total; board beats (changed team, rookie and pick, new play caller at team).

## 3. Task A: the inventory, before any wiring

An engineer lists every table and metric the store holds (`src/db/schema.ts`, the observation stores' metric keys, the harvest captures, the archives) against the sheet, in a table: fact, source table and metric, seasons covered in production, on the sheet today (yes/no), expert value (high/medium/low, one line why), grounding shape (a number, a name, a date, a code). The inventory is committed as `docs/research/2026-09-07-fact-sheet-inventory.md` before wiring starts, and every fact wired in Task B cites its row. Production coverage is checked with ONE read per table against production, per [[prod-db-is-for-backfills-only]] (counts only, no scans), and a fact whose production coverage is missing is wired anyway and listed under "needs a production backfill" with the script that fills it.

## 4. Task B: the facts to wire (the known set; the inventory may add more)

Each is a new `PlayerFacts` field, a rendered sheet line in the same plain, dated, sourced voice as the existing lines, ledger entries for every number, name, date and code it prints, and absence rendered as absence (no line, or a line that says the store holds nothing, never a guess).

1. **Season-ending absences, per prior season.** From the availability combiner already built and verified (`deriveSeasonEnding` over `nflverse_injuries` and `nflverse_roster_weeks`): "His 2025 season ended after week 4: reserve list, ACL per the injury report." One line per season it happened, for the seasons the sheet already reads.
2. **Games missed by season.** From roster status per week (RES, INA, PUP, and the like) and the schedule: "Missed 13 games in 2025, 0 in 2024, 3 in 2023." Counted from what the store holds, and the seasons it holds nothing for are not listed as zero.
3. **Injury designations this season, as a history.** From the harvest captures: every designation change with its date, so "Questionable for three straight weeks with a hamstring" is a fact the writer can state. The injury body part or description comes from the report text when the feed carries it, never inferred.
4. **Coaches.** Head coach and offensive play caller by name, with a new-this-year flag for each, from the curated play-callers file (`scripts/validate-play-callers.ts`), which gains a head-coach column per team-season under the same validation. A curated 32-row-per-season table is the discipline that file already follows; it is not a manual pull from a stats site.
5. **Age, experience and pedigree.** From the historical universe and the draft-picks archive: age on opening day, seasons played, draft year, round and pick or undrafted, the college if held.
6. **Depth chart.** From `nflverse` depth charts (2019 onward) and the harvest's current depth chart: his listed slot and who is listed around him at the position on his team, dated.
7. **Role trend inside a season.** From weekly observations: snap share and target share over the last four weeks of last season versus the first four, so a rising or fading role is a fact ("his snap share went from 41% in September to 78% by December").
8. **Target competition.** From the same weekly rows: the top two target earners on his team last season with their shares, so "Chase and Higgins took 52% of the targets" is on the sheet.
9. **Red-zone and near-goal usage.** From the play-by-play derived rows already fit by the model (`model/red-zone-fit.ts`, `target-depth-fit.ts`): red-zone touches, targets inside the 10, average depth of target, with ranks.
10. **Team context.** From the team observation store: last season's team pace, pass rate, points scored, and this season's market view (win total, and the implied team total and spread for week one from the odds harvest).
11. **Schedule.** Bye week (already), week-one opponent, home and road split, dome games, and the fantasy playoff weeks' opponents (weeks 15 to 17) as names, without a strength judgment unless one is measured.
12. **Market movement.** From `adp_snapshots`: ADP now versus thirty days ago, so "the market has moved him up eleven picks since August" is a fact.
13. **Weekly volatility.** From last season's weeks: the share of weeks above 15 points and the worst week, both already computable from the weeks the sheet holds.
14. **Prior seasons at a glance.** Points, games and rank for each of the three prior seasons in one line, so a career arc is visible.

## 5. Rules

- Honest data is absolute. Every number traces to a store row; every name to a roster, coaches or universe row; every date to a capture. Nothing is inferred (no "likely ACL"), nothing is defaulted to zero for a season the store lacks.
- Grounding by construction: the ledger is built from the rendered sheet text (the writer round's rule), so any line added here is quotable the moment it renders.
- Copy on the sheet is for the model, not the reader, but keeps the house rules anyway: no em-dashes, no semicolons, no competitor names.
- The sheet's length grows; measure the prompt tokens before and after on five players and record it. If it crosses the model's cached-prefix advantage badly, group the new lines under one heading so the stable part of the prompt stays cacheable.
- Functions under 50 lines, files under 800 (`render.ts` and `facts.ts` are close; split by section if needed), immutability, no `any`.

## 6. Testing

A fixture player with every fact present renders every line; a fixture with none renders no invented line; each new fact has a unit test on its reader; the acceptance script (writer round) runs 30 players on dev after wiring to confirm the writer's pass rate did not fall and the prose cites the new facts (five side-by-side reads recorded in the ledger).

## 7. Rollout

Merge behind the writer round. Any production backfill the inventory named runs once, then the peek facts refresh, the capsule regeneration (which the writer round gates), and the document rebuild.
