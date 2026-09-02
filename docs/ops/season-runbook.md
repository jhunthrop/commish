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

## The cron entries

Installed by `scripts/install-season-cron.sh` (run it with `--print-only` to preview without
touching crontab; re-running it is idempotent — it replaces only its own marker block, leaving
every other crontab entry untouched):

```
# BEGIN commish season-week cron (managed by scripts/install-season-cron.sh -- do not edit by hand)
0 8 * * 2 cd /Users/jh/code/fantasy && npm run season:week >> /Users/jh/.commish/season-logs/$(date +\%Y-\%m-\%d)-tue-data.log 2>&1
0 18 * * 3 cd /Users/jh/code/fantasy && npm run season:week >> /Users/jh/.commish/season-logs/$(date +\%Y-\%m-\%d)-wed-data.log 2>&1
0 14 * * 4 cd /Users/jh/code/fantasy && npm run season:week >> /Users/jh/.commish/season-logs/$(date +\%Y-\%m-\%d)-thu-freeze.log 2>&1
# END commish season-week cron
```

(The `\%` is not a typo — crontab treats a bare `%` as a newline inside a command, so `date`'s
format string has to escape it. `--print-only` on the install script prints this exact block.)

All three entries run the identical `npm run season:week`, cd'd into the **main checkout**
(`/Users/jh/code/fantasy`), not this worktree — crontab has no notion of a git worktree, and a job
pointed at a worktree would break the moment the worktree is removed after this branch merges.
**Until this branch merges to main, these entries will fail** (exit 127, `missing script:
season:week`) every time they fire; that is expected and self-correcting the moment `season:week`
lands on main. Every step the command runs is idempotent-or-skip, so firing it three times a week
costs nothing extra beyond the one real freeze it eventually takes.

Why these three passes, and these times (assumes the crontab runs in `America/New_York` — Vixie
cron, what ships on macOS and most Linux distributions, has no per-line timezone, so the whole
crontab runs in one; adjust the hours by hand if the host's system timezone differs):

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
`scripts/season-week.ts`'s and `scripts/install-season-cron.sh`'s own header comments.

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
