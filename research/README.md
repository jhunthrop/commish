# research-ts: the TypeScript research core, kept as the parity oracle

**This package is the oracle the Python research lane must match, and it is deleted once parity is reached.** The founder ruled on 2026-10-12 that the research core migrates to Python; `research/` is reserved for that project. Until the Python port reproduces this core row for row on every stored table (the boards, the reasons, the register, the capsules' facts) and player-week for player-week on every projection, this package is what the numbers are checked against. It is not the deployed product: nothing here has a Dockerfile, a workflow or a cloud resource, by that ruling.

It was carved out of the Next.js app's `src/` on 2026-10-12 (Lane 2 of `docs/superpowers/specs/2026-10-12-prep-site-architecture-design.md`) with `git mv`, so `git log --follow` on any file here reaches its history under `src/`.

## Layout

```
src/projections   the fit, validation, backtests, benchmarks, the board, the decide layer, the register
src/capsules      the grounded writer, its facts, its validator, voice-rules.ts (set phrases and asides)
src/board         the served board read (boardRows), format resolution, the generic board
src/reference     injuries, news, the NFL schedule (reads of the capture archive and nfl_games)
src/db            the research tables' schema, the client, the test harness
src/domain        player, roster, scoring, season and draft vocabulary shared with the league app
src/draft-engine  the four engine pieces the decide layer reads (order, roster need, slotting, autopick policy)
src/scoring       fantasy points under any rules
src/stats         the stats provider client
src/nightly       the nightly run (entry point main.ts)
src/inseason      the in-season tasks (entry point main.ts)
src/advisor       the advisor service (entry point server.ts)
scripts           the operator scripts: fits, ingests, backfills, reports, the register, the import guard
data              committed model artifact records, play callers, win totals
drizzle           the research tables' own migrations (a baseline for a fresh database)
JOBS.md           every job the old app's scheduler runs, and where each one goes
```

The package imports nothing outside itself. `npm run guard` proves it: every module specifier under `src/` and `scripts/` must be a relative path inside the package, the `@research/*` alias (mapped to `src/`), a Node builtin or a declared dependency, and `next`, `react` and the league app's `@/` alias are refused by name. The league app imports this package through the same `@research/*` alias (root `tsconfig.json`), and both type-check: `npm run typecheck` here, `npx tsc --noEmit` at the root.

## Commands

All from this directory, or with `-w @commish/research` from the root. `.env.local` at the repository root supplies `DATABASE_URL` and the provider keys. Never point a measurement run at production.

```
npm run typecheck                 tsc --noEmit, strict
npm run guard                     the import boundary
npm run nightly -- [--out=<dir>] [--skip=ingest,fit,capsules] [--persist-board]
npm run inseason -- --task=season-week [--season=2026] [--dry-run]
npm run inseason -- --task=capture-harvest
npm run advisor                   POST /advise on $PORT (8080)
npm run advisor:measure           a whole 12-team draft against the advisor, p50 and p90
npm run db:generate               migrations from src/db/schema.ts into drizzle/
```

## The nightly run

`src/nightly/main.ts` runs, in order:

1. **ingest**: the provider capture (injuries, news, depth charts, inactives, betting odds) when `TANK01_API_KEY` is set, tonight's ADP in PPR, half and standard, the pre-kickoff props snapshot when `ODDS_API_KEY` is set, the win totals. The last two are no-ops after the season's first kickoff.
2. **fit**: the product season's boards through `persistSeason`, the same builder the operator script uses. By default it builds and compares with what is stored and writes nothing, because retaking the live board replaces what is served and what the register freezes. `--persist-board` takes it.
3. **capsules**: every stored capsule carrying a set phrase or a writer's aside is queued for a rewrite, then the sweep regenerates every player whose facts moved. Skipped by name when `AI_GATEWAY_API_KEY` is not set, because a sweep without the key would demote written reads to the template.

Then it reads every board variant, ADP, capsules, the register's running score and the held-out backtest, writes the run, checks the gates and writes the manifest last. A run that passes moves `runs/latest.json`; a run that fails is kept for diagnosis and moves nothing, so the previous clean run stays the one a site builds from.

### The run format

Under the output directory (default `./nightly-out`, gitignored; `--out` or `NIGHTLY_OUTPUT_DIR` override), one run id per run, the UTC hour it started (`2026-10-12T05`, `.2` for a second run in the same hour):

```
runs/latest.json                                   { runId, finishedAt } of the newest passing run
runs/<runId>/boards/<format>-<teams>.json          standard roster shape, e.g. ppr-12.json
runs/<runId>/boards/<format>-superflex-<teams>.json
runs/<runId>/players/<id>.json                     one page per player, every format inlined
runs/<runId>/adp.json                              the newest capture per format, source named
runs/<runId>/record.json                           the register's running score with its method
runs/<runId>/index.json                            [{ id, name, team, position }] for search
runs/<runId>/manifest.json                         steps, gates, held-out scores, counts, every file's bytes and sha256
```

Formats are `ppr`, `half`, `std`; team counts 8, 10, 12, 14, 16; shapes standard and superflex (30 boards). Every board carries its `pointsBasis` and `valueBasis` sentences, every player format line its `basis`, every ADP reading its `source`. The types are in `src/nightly/artifacts.ts`.

The run is written through a `RunStore` (`src/nightly/run-store.ts`): `LocalRunStore` is the implementation here. A bucket implementation is one class behind the same three methods.

### The gates (spec §4), with named reasons

| Gate | Fails with |
|---|---|
| `held_out_backtest`: each held-out season's served board against what players scored, no worse than the last clean run by more than 0.005 rank correlation | `held_out_regressed:<season>:<before>-><now>`, `held_out_unscored:<season>` |
| `board_depth`: every starting slot's eligible pool covers the whole league's demand for it, and the board fills every roster spot | `board_depth_short:<board>:<slot>:<have>/<need>` |
| `capsules`: every player page has a capsule, every pull figure appears word for word in its prose, no set phrase or aside | `capsule_missing:<id>`, `pull_figure_not_in_prose:<id>:<figure>`, `capsule_voice_rule:<id>:<text>` |
| `basis`: every number names its basis | `basis_missing:<where>` |

A failed step also fails the run.

## The advisor service

`src/advisor/server.ts`, Node's own `http`, no framework. Called by the API and the room service, never by a browser. Every response is `{ "ok": boolean, "data": ..., "error": string | null }`.

`GET /healthz` returns `{ ok: true, data: { status: "ok" } }`.

`POST /advise` takes a room state:

```json
{
  "teamCount": 12,
  "rosterSlots": [
    { "slot": "QB", "count": 1, "eligiblePositions": ["QB"] },
    { "slot": "RB", "count": 2, "eligiblePositions": ["RB"] },
    { "slot": "WR", "count": 2, "eligiblePositions": ["WR"] },
    { "slot": "TE", "count": 1, "eligiblePositions": ["TE"] },
    { "slot": "FLEX", "count": 1, "eligiblePositions": ["RB", "WR", "TE"] },
    { "slot": "K", "count": 1, "eligiblePositions": ["K"] },
    { "slot": "DEF", "count": 1, "eligiblePositions": ["DEF"] },
    { "slot": "BENCH", "count": 6, "eligiblePositions": ["QB", "RB", "WR", "TE", "K", "DEF"] }
  ],
  "pool": [
    { "id": "4426515", "position": "WR", "adp": 3.3, "projectedPoints": 344.08 },
    { "id": "DST-LAR", "position": "DEF", "adp": 120.0, "projectedPoints": null }
  ],
  "picks": [
    { "pickNumber": 1, "playerId": "4362628", "seat": 1 }
  ],
  "seatOnClock": 2,
  "shortlistSize": 5
}
```

- `pool` is every player in the room, drafted or not. `projectedPoints` is `null` for a position the board ships in market order (kickers and defenses): such a man has survival odds but no value, and is never recommended.
- `picks` are numbered 1 to n in order; `seat` is the 1-based draft slot that made the pick. A seat's roster is its picks.
- `seatOnClock` must be the seat a snake draft puts on the clock at pick n + 1, or the call is refused with 422.
- `rosterSlots` uses the slot types `QB RB WR TE FLEX SUPERFLEX K DEF BENCH`.

It returns (the numbers here show the shape and are not a measured room):

```json
{
  "ok": true,
  "error": null,
  "data": {
    "pickNumber": 2,
    "nextPickNumber": 23,
    "shortlist": [
      {
        "playerId": "4426515",
        "position": "WR",
        "expectedValueAdded": 171.2,
        "valueOverReplacement": 164.05,
        "rosterAdjustedValue": 164.05,
        "survivalProbability": 0.0,
        "reasons": [{ "code": "tier_cliff", "position": "WR", "dropToNextTier": 23.4, "playersLeftInTier": 2 }],
        "why": "The receivers fall 23.4 points after the 2 left in his group, and he fills your WR slot. 20 picks go before your next turn, and he is still there under 1% of the time by where drafters take him."
      }
    ],
    "survival": { "4426515": 0.0, "DST-LAR": 1.0 },
    "tiers": { "WR": [{ "tier": 0, "playerIds": ["4426515", "..."], "dropToNextTier": 23.4 }] },
    "basis": "Value over replacement for a 12-team league on these roster rules, survival from where drafters take each player and how far they stray from it."
  }
}
```

- `shortlist` is best first; the first is the recommended pick. `reasons` is `recommendPick`'s own `PickReason` union (`src/projections/decide/draft.ts`).
- `survival` is the closed form (`src/projections/decide/survival.ts`) for every undrafted man to `nextPickNumber`; zero for everyone at the seat's last pick.
- `tiers` groups each position's undrafted, projected pool by the board's tier rule (`src/projections/decide/tiers.ts`).
- Errors: 400 for a body that is not JSON or not the shape above (each issue named), 405, 404, 413 over 1 MB, 422 for a room state that cannot be (the wrong seat on the clock, a finished draft), 500 with the detail only in the log.

Measured on 2026-10-12 with `npm run advisor:measure` (a whole 12-team draft by ADP from the stored 2026 PPR board export, 180 calls): server time p90 35.5 ms on a quiet machine and 52 ms with other lanes running (load average near 7). `recommendPick` is about 20 ms of it on an empty roster.

## Tables

`src/db/schema.ts` declares the 27 research tables; the league app's tables live in the old app's `src/db/schema.ts` and reference `players` here, never the other way round. The client carries no schema (nothing uses Drizzle's relational API), so one `Db` type serves both halves. `drizzle/0000_research_baseline.sql` creates these tables for a fresh database; the shared development and production databases are still migrated by the league app's history at the repository root.
