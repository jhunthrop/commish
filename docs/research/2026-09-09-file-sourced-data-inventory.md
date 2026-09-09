# File-Sourced Data Inventory

**Date:** 2026-09-09. **Directive:** founder, 2026-09-08: "I want to find everything still sourced from files and remove it. Do it the proper way." **Trigger:** the curated coaches CSV was read from disk at request time and threw ENOENT in production (team page, capsule sweep); it now lives in the `coaches` table behind `npm run coaches:ingest` and `src/coaches/store.ts`.

This is the inventory that round two of that work is built on. Nothing below is guessed: every entry was found by sweeping `src`, `scripts` and `drizzle` for `node:fs` reads (`readFileSync`, `readFile`, `statSync`, `readdirSync`, `existsSync`, `createReadStream`), for static `import` of `.json`/`.csv`/`.txt`/`.md`, for string literals naming a `data/` path, for committed fitted tables (`*-fitted.ts`, `fitted.ts`, `curve-fitted-*.ts`, the laws registry and its JSON, the discovery quantile table), and for `.env` reads outside `src/lib/env.ts`. There is no `public/` directory in this repository.

## Method

- `grep -rnE "readFileSync|readFile\b|statSync|createReadStream|readdirSync|existsSync|from \"(node:)?fs" src scripts drizzle` and the same for static data imports; every non-test hit is listed by name below. Test files (`*.test.ts`, `*.test.tsx`) and `test-support.ts` helpers appear only in the fixture class.
- Readers were traced by import graph, not by file name: for every artifact module, every `src` and `scripts` importer of it, and for the functions that default a parameter to a committed table, every call site that relies on the default.
- Row and byte counts are `wc` over the worktree at commit `8c1ddcef`; fit stamps are the last commit that rewrote each generated file.

## Classes

- **Reference data**: facts about the world. Belongs in a table with a validated, idempotent ingest script and one repository read.
- **Model artifacts**: fitted parameters a fit script produced, versioned with the model. Belongs in `model_artifacts`, keyed by name and version, written by the fit scripts, read through one loader that pins the version the code expects and throws when the store lacks it.
- **Code constants**: enumerations and rules a person writes and reviews as code. Stay in code; each is argued in one line.
- **Test and fixture only**: read by tests, the e2e build, or the fixture recorder. Stays; listed for completeness.

## 1. Reference data

| # | Path | Holds | Readers | Size | Produced | Changes | State after this round |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | `data/play-callers/play-callers.csv` | Who called the offensive plays for every team-season 1999-2026, with head coach for 2026 | `scripts/validate-play-callers.ts`, `scripts/coaches-ingest.ts` via `scripts/lib/play-callers-csv.ts` (script only). Request path reads `coaches` through `src/coaches/store.ts` | 944 rows, 61,377 B | Curated by hand from Wikipedia and PFR, 2026-08-31 | By hand, each offseason; `npm run coaches:ingest` republishes | Already a table (`coaches`, migration 0085). README gains the ingest line. |
| R2 | `data/win-totals/win-totals.csv` | Preseason regular-season win total lines, over and under prices, 2003-2026 | `src/projections/vegas/ingest.ts#ingestVegasWinTotals` (`readFileSync` inside a `src` module whose constants `VEGAS_SOURCE`/`VEGAS_METRICS` are imported by `capsules/collect.ts`, `teams/service.ts`, `laws/discovery-facts.ts` and `jobs/defs/win-totals-job.ts`, so `node:fs` is traced into the request bundle); `scripts/validate-win-totals.ts`, `scripts/vegas-win-totals-ingest.ts` | 768 rows, 52,503 B | Fetched once from nfelosrs, curated 2026-09-01 | Ingested once per season; the live publisher job (`win-totals-job`) writes the current season from the network | Already a table (`team_week_observations` under `VEGAS_SOURCE`). The file read moves out of `src` into `scripts/lib/win-totals-csv.ts`; `ingest.ts` keeps the parser and the verified writer and imports nothing from `node:fs`. README gains the ingest line. |
| R3 | `nfl_draft_picks` | Draft picks 1980-2026 | `src/projections/nflverse/draft-picks.ts` | 11,084 rows (dev) | `npm run projections:draft-picks` from nflverse over the network | Once per draft | Already a table; listed because the directive names draft picks. No file is involved. |
| R4 | Four one-time PFR/Stathead exports (2024-25) | Seed rows for the K/DEF measurement | Nothing in `src` or `scripts` reads a PFR file; `grep -rniE "pfr[-_/][a-z]*\.(csv|json)|stathead|data/pfr"` returns nothing outside prose | Not in the repository | Human export, once | Never (PFR ruling 2026-09-05) | No action; recorded so nobody re-searches. |

`data/play-callers/verification-queue.md` (28,062 B) is a human work queue; no code reads it.

Environment files: no code outside `src/lib/env.ts` reads a `.env*` file. Every `.env.local` mention in `src` and `scripts` is an error message telling the operator which npm script loads it.

## 2. Model artifacts

Eleven committed tables in nine modules and two JSON files, plus one hand-written composition module. "Blocked" means a reader lives in `src/projections/market/blend.ts` or `src/projections/preseason/availability-history.ts`, which another engineer holds this hour; those readers are listed by line so the next round can switch them without re-tracing.

| # | Path | Holds | Readers (non-test) | Lines | Fit script | Fit stamp (last regeneration) | This round |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | `src/projections/preseason/game-variance-fitted.ts` | Per-game points variance, QB/RB/WR/TE, rookie and veteran | `fitted-variance.ts`; `scripts/rookie-calibration-backtest.ts:226` | 24 | `game-variance-fit.ts` (2023-2024) | 2026-09-04 `f8c7bd7c` | **Moved** to `preseason/game-variance-skill` v1. Module deleted. |
| M2 | `src/projections/preseason/kdef-fitted.ts` (variance slice) | Per-game points variance, K and DEF | `fitted-variance.ts` | part of 6,324 | `kdef-fit.ts` (2013-2024) | 2026-09-05 `63cd8c6e` | **Moved** to `preseason/game-variance-kdef` v1. The export leaves the module; `kdef-fit.ts` writes the store for this slice. |
| M2b | `src/projections/preseason/kdef-fitted.ts` (kicker and defence priors) | `FITTED_KICKER_PRIORS`, `FITTED_DEFENSE_PRIORS` (6,270 `leagueAllowed` game pairs) | `blend.ts:15`; `scripts/kdef-judgment.ts:36` | 6,324 | `kdef-fit.ts` | 2026-09-05 | **Blocked** by `blend.ts:15`. Next round: `preseason/kicker-priors`, `preseason/defense-priors`. |
| M3 | `src/projections/preseason/fitted-variance.ts` | Hand-written composition of M1 and M2 into `SHIPPED_GAME_VARIANCE` | `board.ts:7,391` (default for `preseasonBoard`); `scripts/kdef-judgment.ts:27` | 25 | none (hand-written) | n/a | **Replaced** by `loadShippedGameVariance(db)` in `game-variance-artifacts.ts`; `preseasonBoard` now requires `gameVariance`. Module deleted. |
| M4 | `src/projections/market/props-anchor-fitted.ts` | `FITTED_PROPS_ANCHOR_WEIGHT` (0.18) | `scripts/preseason-persist.ts:65,178` | 22 | `props-anchor-fit.ts` (2023+2024, judge 2025) | 2026-09-05 `b0d84eb9` | **Moved** to `market/props-anchor-weight` v1. Module deleted; the fit script writes the store. |
| M5 | `src/projections/market/curve-fitted.ts` | PPR market curve knots | `market/curve.ts:11` (defaults of `marketCurve`, `marketBoard`), `market/format-anchor.ts:4` | 2,101 | `market-curve-fit.ts` (2013-2021) | 2026-08-31 `1ae14f31` | **Blocked**: `blend.ts:1036-1043` calls `formatAnchorFor(format)` and `marketBoard(..., anchor.curve, ...)` synchronously. |
| M6 | `src/projections/market/curve-fitted-half.ts` | Half-PPR market curve | `format-anchor.ts:5` | 1,634 | `market-curve-fit.ts` | 2026-09-08 `6c5378de` | Blocked with M5. |
| M7 | `src/projections/market/curve-fitted-std.ts` | Standard market curve | `format-anchor.ts:6` | 2,202 | `market-curve-fit.ts` | 2026-09-08 `6c5378de` | Blocked with M5. |
| M8 | `src/projections/preseason/rookie-curve-fitted.ts` | Draft-capital points curve | `rookie-curve.ts:13` (default of `rookieCurve`), read through the default by `rookies.ts:158-162` and `blend.ts:593` | 3,089 | `rookie-curve-fit.ts` (2003-2021) | 2026-09-02 `0aa1df33` | **Blocked**: `blend.ts:592-593,630` rely on the module defaults. |
| M9 | `src/projections/preseason/rookie-historical-games-fitted.ts` | Rookie games rate by draft bucket, curve evidence counts | `rookie-curve.ts:12`; through defaults `blend.ts:592,630` | 3,135 | `rookie-historical-games-fit.ts` | 2026-09-04 `ca74856b` | Blocked with M8. |
| M10 | `src/projections/market/blend-fitted.ts` | `FITTED_BLEND_CONSTANTS` | `blend.ts:29,1037`; six scripts | 52 | `blend-fit.ts` (2013-2021) | 2026-09-02 `f6d044c1` | **Blocked** by `blend.ts:29`. |
| M11 | `src/projections/model/fitted.ts` | Weekly model priors (opportunity, efficiency, context) plus `FIT_SEASONS`/`HELD_OUT_SEASONS` | `model/source.ts:7` builds `FITTED_MODEL`; `availability-history.ts:4,82` imports `FITTED_MODEL`; nine scripts | 307 | `projection-fit.ts` (2021-2022) | 2026-08-31 `df2d9469` | **Blocked** by `availability-history.ts:4`. `FIT_SEASONS`/`HELD_OUT_SEASONS` are a spec, not a fit output, and should move to `model/config.ts` when the family moves. |
| M12 | `src/projections/preseason/fitted.ts` | Availability, career, depth and rookie priors | `availability-history.ts:9` (`FITTED_DEPTH_PRIORS`); eleven scripts | 514 | `preseason-fit.ts` (2021-2022; rookie durability 2023-2024) | 2026-09-08 `4a3ab732` | **Blocked** by `availability-history.ts:9`. |
| M13 | `src/projections/laws/measured.json` | Measured evidence for the six tribal laws | `laws/registry.ts:58` (static import); `registry()` is called by `draft/board/page.tsx:109`, `api/drafts/[draftId]/players/route.ts:44`, `preseason/source.ts:645`, `capsules/{collect,collect-one,peek-document}.ts`, and `blend.ts:565,761` | 3,980 B | `measure-laws.ts` | 2026-09-02 `43466c3c` | **Blocked** by `blend.ts:565,761` (`registry()` as a default). Every other reader is editable and is listed here for the switch. |
| M14 | `src/projections/laws/discovered.json` | Discovered-law evidence | `laws/registry.ts:59` | 249,147 B | `discover-laws.ts` | 2026-09-02 `21f05f5e` | Blocked with M13. |
| M15 | `src/projections/laws/discovery/quantiles.ts` | Train-window quantiles the candidate generator cuts on | `discovery/generate.ts:4`, `discovery/measure.ts:14`; reached from `registry()` and `board-reasons.ts` | 554 | `discovery-quantile-fit.ts` (2003-2021) | 2026-09-02 `d9018ae6` | Blocked with M13: `generateCandidates()` is part of `registry()`'s own evaluation. |

Line counts remaining after this round: M2b 6,324 (kicker and defence priors), M5-M7 5,937, M8-M9 6,224, M10 52, M11 307, M12 514, M13-M14 253 KB of JSON, M15 554. Three of the four largest families are blocked by one file, `blend.ts`; the next round that holds it can switch M5-M10 and M13-M15 in one pass because every consumer is named above.

### The store

`model_artifacts` (migration 0086): `name`, `version` (integer), `fit_stamp` (when the fit ran), `fitted_on` (the train window, as the fit script states it), `payload` (jsonb), `published_at`. Unique on `(name, version)`. A version is immutable: publishing the same version with a different payload throws, publishing it again with the same payload is a no-op. The loader (`src/projections/model/artifacts.ts`) reads one artifact by the name and version the code declares, validates the payload with the artifact's own parser, memoizes it per instance, and throws `MissingModelArtifactError` when the store lacks that version. There is no fallback to a module.

Each artifact's reviewed record is committed under `data/model-artifacts/<name>/v<version>.json`, the way the coaches CSV is the reviewed input to its ingest: the fit script writes the record and the store together, `npm run artifacts:publish` loads every committed record into whichever database `DATABASE_URL` names, and the server reads only the table. This keeps "what did the engine believe when it published a board" answerable from the repository, which the deleted modules' docblocks were right to insist on.

## 3. Code constants

| Path | What | Why it stays code |
| --- | --- | --- |
| `src/projections/nflverse/team-eras.ts` | 32 team codes, three relocations, one expansion, the week-18 rule | The ground truth the data files are validated against; if it lived in a table a file and the table could agree while both were wrong. Changes by reviewed code when the league changes shape, years apart. |
| `src/projections/nflverse/team-codes.ts`, `src/domain/nfl-team-names.ts` | Spelling folds and display names per code | Same argument: vocabulary every schema column is checked against, reviewed as code. |
| `src/projections/preseason/board-formats.ts`, `src/domain/scoring.ts` | Scoring presets and the ADP source per format | Product rules the blend is fit under; changing one is a model decision, not a data refresh. |
| `src/money/prize-table.ts` | Prize structures and the pot invariant | A financial rule with an invariant, reviewed as code. |
| `src/mock-draft/config.ts` `botRoster` (written by `src/data/seed/bot-roster.ts`) | Bot identities for mock rooms | Hand-written personas ensured into `users` idempotently on first use; the read path is already the table. |
| `scripts/lib/play-callers-csv.ts` `HEAD_COACH_SEASONS` | Which seasons claim a complete head-coach column | A claim about sourcing that must change in the same commit as the rows it vouches for. |
| `src/projections/laws/config.ts`, `model/fitted.ts` `FIT_SEASONS`/`HELD_OUT_SEASONS` | Train windows, replication folds, cutoffs | The preregistered spec of a measurement, not its output; a reviewer must see it in the diff. |
| `src/projections/nflverse/stat-lines.ts` `STAT_LINE_GAPS`, `src/projections/preseason/draft-buckets.ts` | Known publisher gaps, draft-round buckets | Enumerations that define how a measurement is taken. |
| `src/help/*`, `src/integrity/notices.ts`, copy tables | Product copy | Copy is code under the persona review. |
| `src/design/tokens.css` | Generated CSS from the design tokens module | A build artifact for the stylesheet, not runtime data; `generate-css.test.ts` pins it to its source. |

## 4. Test and fixture only

| Path | What | Readers | Size |
| --- | --- | --- | --- |
| `src/stats/mock/dataset.json` | The e2e mock stats dataset | `src/stats/mock/mock-stats-provider.ts` (static import), selected only under `STATS_PROVIDER=mock` (`e2e:build`); `scripts/gen-mock-dataset.ts` writes it. `src/stats/registry.ts` imports the provider unconditionally, so the JSON is traced into the production server bundle without ever being read there. Allowlisted in the guard; flagged for a lazy import behind the provider switch. | 1,931,428 B |
| `src/stats/tank01/fixtures/*.json` and `fixtures.ts` | Recorded Tank01 responses | Tests and `scripts/record-tank01-fixtures.ts` | 44 KB, 10 files |
| `src/projections/nflverse/fixtures/*.csv` and `fixtures.ts` | nflverse slices | Tests only | 252 KB, 9 files |
| `src/gifs/giphy/fixtures/*.json` and `fixtures.ts` | Recorded Giphy responses | Tests only | 8 KB, 2 files |
| `src/league-service/__fixtures__/peek-body-parity.json` | Peek body parity fixture | `player.document.test.ts` | 110,557 B |
| `src/design/test-support.ts`, `src/projections/register/test-support.ts`, `src/integrity/test-support.ts` | Directory walkers for the source sweeps | Tests only | |
| `src/data/seed/*` | Dev seeding (`npm run seed`) | Scripts and tests; the one runtime import is `bot-roster.ts` (see code constants) | 28 files |
| Source sweeps (`src/design/*.source.test.ts`, `src/integrity/*.source.test.ts`, `admin-routes.test.ts`, `advisory-only.test.ts`, `flag-only.test.ts`, `reserved.test.ts`, `wall.source.test.ts`, and the other `readFileSync` tests) | Tests that read source files to assert a rule | Tests only | |

## Counts

Reference data 4 (2 already tables, 1 read relocated, 1 absent). Model artifacts 15 rows over 11 tables (3 moved this round, 12 blocked by two files held this hour). Code constants 10. Test and fixture only 8 groups.

## The guard

`src/integrity/file-sourced-data.source.test.ts` sweeps every non-test file under `src` for a `node:fs` import (static, dynamic or `require`), a static import of `.json`/`.csv`/`.txt`/`.md`, or a string literal naming a `data/` path, outside an allowlist of named files each with a reason. An allowlisted file that stops offending fails the test too, so the list cannot go stale. Scripts and tests are excluded because the file read belongs there.
