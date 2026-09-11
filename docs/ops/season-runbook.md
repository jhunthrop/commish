# Season runbook — the weekly cadence

One command carries the register through everything a week needs: ingest whatever nflverse has
published, snapshot props, grade every gradeable ungraded week, freeze the current week if it is
still before kickoff, and print the running scoreboard. The command, its five steps, and its flags
are documented in full in `npm run season:week -- --help` (`scripts/season-week.ts`); this page is
the durable copy (`.superpowers/` is gitignored, so the operator-facing content lives here too),
plus the cron entries and the two one-off commands the cadence itself does not cover.

## The weekly manual command

```
npm run season:week
```

Flags:

- `npm run season:week -- --dry-run` — walks all five steps and prints what WOULD happen; makes no
  network calls and writes nothing.
- `npm run season:week -- --refreeze` — forces the freeze step to supersede an existing freeze for
  the current week rather than skip it.
- `npm run season:week -- --season=2026` — overrides the season (default: the season implied by
  today's date; January and February still belong to the season that kicked off the previous
  autumn).

Exit code is nonzero if any step's status is `failed`. A `skipped` step is not a failure — it is
the expected outcome for a week that has not been played, graded, or reached kickoff yet.

## The runner (was: the cron entries)

The weekly cadence now runs on the durable job system (`src/jobs/`, spec:
`docs/superpowers/specs/2026-09-02-job-system-design.md`). The three cron fires became three
code-defined schedules — same hours, same semantics, `America/New_York`:

| Schedule | Cron | Purpose |
|---|---|---|
| `season-week-tue-data` | `0 8 * * 2` | data pass: Monday night stats settled, grade the played week |
| `season-week-wed-data` | `0 18 * * 3` | data pass: mid-week props refresh |
| `season-week-thu-freeze` | `0 14 * * 4` | freeze pass: hours of margin before Thursday kickoff |

Each fire enqueues one idempotent `season-week` job (unique on schedule name + fire instant, so
double ticks are harmless), and the schedule tick computes due-and-missed fires since its cursor
— a laptop that slept through Tuesday 08:00 runs Tuesday's cadence when it wakes, which the old
crontab never could.

Installed by `scripts/install-season-runner.sh` (run with `--print-only` to preview without
writing): it puts `npm run jobs:runner` under launchd (`com.commish.jobs-runner`, KeepAlive +
RunAtLoad, logs under `~/.commish/job-logs/`) and removes the OLD installer's crontab marker
block with the same validation gate that installer had — a crontab whose markers are anything but
zero or one balanced pair is refused untouched. The runner runs against the **main checkout**
(`/Users/jh/code/fantasy`), not a worktree; **do not install until the job-system branch merges
to main** (`npm run jobs:runner` does not exist there before that).

Operations:

```
launchctl print gui/$(id -u)/com.commish.jobs-runner | head -20   # status
tail -f ~/.commish/job-logs/runner.log                             # logs
launchctl bootout gui/$(id -u)/com.commish.jobs-runner             # stop
```

Observability lives at `/app/admin/jobs`: dead-lettered jobs first (a terminal failure is loud
by design), schedules with cursors and last fires, recent runs, and a Run again action. On a
Vercel deployment the same jobs run through the authenticated tick route (`/api/jobs/tick`,
CRON_SECRET bearer, one bounded tick per minute) with no code changes.

Why these three passes, and these hours: unchanged from the crontab era —

1. **Tuesday 08:00 ET — data pass.** By Tuesday morning, Sunday's late corrections and Monday
   Night Football's own final stats have both settled, so this is the first pass each week that
   can grade the week just played (`stats-ingest` catches nflverse's newly published file; `grade`
   catches every ungraded frozen week that now has outcomes).
2. **Wednesday 18:00 ET — data pass.** A mid-week props refresh: lines firm up over the week as
   books post more markets and move off preseason-style openers, so this catches what a
   Thursday-only run would have missed.
3. **Thursday 14:00 ET — freeze pass.** Sized to land the week's freeze. Every kickoff this
   season's ingested schedule carries lands late Thursday evening Eastern (the store's own
   `kickoffInstantsByWeek` rows are consistently stamped ~00:20Z), so 14:00 leaves hours of margin
   before the week's first game — comfortably clear of the strictly-before-kickoff refusal
   `takeFreeze` enforces, while late enough that Wednesday evening's own props refresh has already
   landed.

Full reasoning, including the stats-ingest entrypoint choice (why this is `ingestSeason`
directly, not `npm run stats:ingest` or a full `npm run projections:backfill` run), lives in
`src/jobs/season-week/deps.ts`'s and `src/jobs/schedules.ts`'s own header comments. The manual
`npm run season:week` CLI still exists for operator-initiated runs and behaves exactly as before.

## Two one-off commands the weekly cadence does not cover

**Kickoff-eve depth ingest** — run once, the evening before week 1's own kickoff (2026: the
evening of September 9th), to pull rosters and depth charts one last time before the board locks
in for the season:

```
npm run projections:preseason:ingest 2026 2026
```

**Historical props backfill** — run in October, once week 1-4's props lines have settled into the
archive, to backfill the rest of a season already in progress (or a prior season) rather than
waiting for the weekly snapshot to accumulate one week at a time. Spends real, metered
historical-odds credits: the default budget is 9000 credits per run; pass `--budget=<n>` to cap it
lower. A budget-truncated run resumes cleanly on the next call — already-archived events are
skipped, so re-running the identical command is always safe:

```
npm run projections:odds:backfill -- --seasons=2025 --budget=9000
```

## Testing: lanes vs. serial

The whole-repo suite defaults to PARALLEL now (`npx vitest run`, no flags): Vitest shards test
files across up to four workers, and each worker reads its own test-Postgres database (lane 1 is
`commish_test`, unchanged; lanes 2-4 are `commish_test_2`/`_3`/`_4` on the same `postgres-test`
container). A worker picks its lane from its own `VITEST_POOL_ID`, rewritten into
`TEST_DATABASE_URL` once per test file by `vitest.setup.mts`, before `test-db.ts`'s
`createTestDb()` or any route-handler test's own `process.env.DATABASE_URL` setup reads it — see
`src/db/test-lanes.ts` for the naming contract.

`npm run db:migrate:test` creates whichever lane databases are missing and migrates all four in one
call (`TEST_DB_LANE=<n>` or `-- --lane=<n>` does one). It is idempotent, so run it after any
migration and after any `docker compose down -v`.

### One lane set per worktree

Four lanes were enough while one checkout ran the suite. Two agent worktrees running `vitest` at
the same time used to resolve the same four database names and interleave their fixtures in one
database: a duplicate key on `audit_events` `evt_1`, two `TRUNCATE` statements queueing behind each
other, a lock-order suite measured at 460s against its usual 7s. So the four lanes are a **set**,
and each checkout gets its own:

| Checkout | Lane databases |
| --- | --- |
| main checkout and every plain clone, CI included | `commish_test`, `commish_test_2`, `commish_test_3`, `commish_test_4` |
| a linked worktree | `commish_test_<set>_1` … `commish_test_<set>_4` |

The set key is the first six hex characters of the SHA-256 of the worktree's absolute root path.
A checkout counts as the primary one when its `.git` lives inside its own root — true of the main
checkout and of any `git clone`, false of a `git worktree add`, which shares the main checkout's
git directory. Nothing about the primary lanes or CI changed. `TEST_DB_LANE` still pins one lane
within whichever set is resolved; `TEST_DB_LANE_SET=<key>` (1-24 lowercase letters and digits)
overrides the derivation outright.

**Nothing to configure.** `vitest.global-setup.mts` runs once per `vitest` process, before any
worker: it resolves this worktree's set, compares each lane's `drizzle.__drizzle_migrations` count
to `drizzle/meta/_journal.json`, and runs `db:migrate:test` for this set when any lane is missing or
behind. A fresh worktree's first `npx vitest run` provisions and migrates its own four databases and
proceeds; later runs pay four short queries. When Postgres is not up, the run stops there naming the
host and `npm run infra:up` rather than letting 600 files each fail against nothing.

**`npm run db:lanes:prune`** drops the lane sets of worktrees that are gone. A set is live while
`git worktree list` names a path that is still on disk; everything else is an orphan of a deleted
checkout. Add `-- --dry-run` to list without dropping. The primary set cannot be reached by it:
`commish_test` and `commish_test_2..4` carry no set segment, so they never parse as a worktree set.

Naming lives in one place, `src/db/test-lanes.ts` (pure) with `src/db/test-lane-set.ts` beside it
for the one part that asks git where it is.

Reach for **`npx vitest run --no-file-parallelism`** (exactly lane 1, `commish_test`, the way this
suite always ran) when debugging a single DB-backed suite step by step, or when narrowing down
whether a failure is a real regression versus a lane-routing bug — serial mode removes lanes from
the picture entirely. Measured on the whole repo (631 files), the two modes report the identical
failure set, and parallel costs 118s against serial's 410s.

## What to check when a step reports "failed"

| Step | A `failed` status means | Check |
| --- | --- | --- |
| `stats-ingest` | The ingest itself threw (not "nothing published yet", which is a `skipped`, not a `failed`) | `DATABASE_URL` is set and reachable; nflverse's release host is not down (an `upstream` `NflverseError`, not an ordinary `not_found`) |
| `props-snapshot` | The snapshot threw. Never blocks grade or freeze — this step runs isolated from the rest | `ODDS_API_KEY` is set; if the printed credits line read `remaining=0`, the month's budget is spent — wait for the reset rather than retrying; otherwise check the odds API is reachable |
| `grade` | The database itself could not be reached (a per-week `SKIPPED` line inside this step's own detail — "the store holds no outcomes yet" — is expected, not a failure) | `DATABASE_URL` |
| `freeze` | The refusal fired for cause — not the ordinary "already frozen at `<instant>`" skip that happens on every pass after the first to reach a given week | Either the week's kickoff has already passed (nothing to do until next week) or the served board is empty (run `npm run projections:preseason:persist` for the season first) |
| `scoreboard` | A read-only step; a failure here means the database connection dropped mid-run | Re-run once the connection is back |

Every step is wrapped so one failure reports and the run continues to the next step where safe —
see `scripts/season-week-steps.ts`'s `safely` wrapper. The command's own exit code is the one place
all five steps' outcomes collapse into a single pass/fail signal for a cron job to alert on.
