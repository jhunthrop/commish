# Lane 97 report: the week ahead's published projection, read once a day from Tuesday 06:00 ET (B68)

Branch `worktree-agent-abd133a4f3b83a359`, from `7baaf7aa`. Research only (`research/`, plus the schedule file and docs that name the harvest's hours). No API, web or `web/src/lib/run` change.

Commits:
- `5282bf89` feat(research): the harvest reads the week ahead's published projection once a day from 06:00 ET, so Thursday's 14:00 freeze keeps one
- this report's commit

Trailer: `Co-Authored-By: Claude Opus 5.5`. That is the model that did the work, and it matches the session's attribution. The brief's template named another model.

## What changed

### Ruling 1: one read a day of the week ahead
- `research/pipeline/tank01/projections.py`:
  - `daily_capture_due(kickoffs, now)` is pure. It answers `DailyCapture(week, since)` or None.
  - `projection_week_due(conn, season, now)` picks the week this harvest pass reads:
    - the kickoff slot's week, when the slot's window is open and not yet captured, as before;
    - otherwise the week ahead, when its daily read is due and has not been taken today.
- `research/pipeline/tank01/capture.py` `run_capture_harvest` now calls `projection_week_due`. `slot_projection_feed` is renamed `week_projection_feed`, and it makes the same single request.
- When the daily read is due:
  - It starts at 06:00 Eastern on the day after the previous week's last kickoff (Tuesday after a Monday game).
  - It runs on the first pass at or after 06:00 Eastern each day.
  - It stops at the week's first kickoff, after which the slots take over.
  - It never runs in a pass that takes a slot's read, so the projection is at most one request a pass.
- How "already read today" is decided: the feed's `capture_checks.checked_at` is at or after today's 06:00 ET, **and** the newest stored projections snapshot is the week ahead's (`payload ->> 'week'`).
  - An unchanged read (same digest) writes no snapshot. It still counts, because the earlier snapshot of the same week stands at its own `captured_at`.
  - An operator's full capture of another week after 06:00 never counts as today's read (tested).
  - A failed read writes no check, so the next hour retries it.
- Each day's changed snapshot is kept with its `captured_at`. Parsing is unchanged: `parse_stored_projections` runs after the capture in the same execution.

### Ruling 2: the read stands before the Thursday freeze
- The capture-harvest schedule gains a 06:00 pass:
  - It was `0 2,7-23 * * *` America/New_York.
  - It is now `0 2,6-23 * * *` (`infra/research-schedule.sh`, `infra/README.md`).
- `research/capsules/week/caption.py` `HOURLY_PASS_HOURS_ET` follows the new schedule, and its test moves 7 am to 6 am.
- `research/JOBS.md` documents the daily read and the order of the Thursday passes. The other files that name the hours follow: `research/inseason/__init__.py`, `research/inseason/__main__.py` and `docs/research/data-sources.md`.
- The scheduler change is applied by hand: run `bash infra/research-schedule.sh apply`, because the deployer lacks the scheduler role. Until someone applies it, the code takes the day's read at the 07:00 pass, the first pass at or after 06:00. That is still seven hours before the freeze.

### Ruling 3: which week counts as the week ahead
- The week ahead is the first week with a game still to come, read from the stored kickoffs (`stored_kickoffs`, `week_bounds`), never from the calendar. If that week's first game has already kicked off, no daily read is due.
- A week with no Thursday game: the read runs from Tuesday until its first game, for example Sunday 13:00 (tested).
- A week with no earlier week stored (week 1), or after a long gap (the week before the Super Bowl): the read opens at most `DAILY_SPAN_DAYS = 6` days before its first kickoff's day, so the offseason reads nothing (tested).

### Ruling 4: the reader's snapshot cap
Lane 92's `api/internal/boards/projections.go` (on its branch) reads `snapshotsRead = 16` snapshots per week, and `AsOf` takes the newest at or before an instant.

A week holds at most:
- **Daily reads:** 3 for a Thursday week (Tue, Wed, Thu). At most 7 after a long gap or in week 1.
- **Slot reads:** one per slot, at most 5 (Thursday or Saturday, Sunday morning, early and late, Monday). A slot reads again only while its stored snapshot is missing.

That is 7 typical and 12 at worst, under 16. Unchanged reads write no snapshot, so the real count is lower. I did not change the API.

### Ruling 5: no backfill
Weeks 2 to 5 stay without a projection. Nothing is fetched for a past week.

### What the TypeScript reference mirrors
- The TypeScript harvest (`research-ts/src/projections/harvest.ts`) never captured the projection. The slot capture has been Python-only since `f25b7710`, so there is nothing in `research-ts/` to mirror.
- The parity case `tank01-capture-harvest` runs on a scratch database with no stored kickoffs. Neither the slot read nor the daily read is due there, so both sides take the same five feeds, and the case still matches.

## The schedule, as it was and as it is
| | Before | After |
|---|---|---|
| `research-capture-harvest` | `0 2,7-23 * * *` America/New_York | `0 2,6-23 * * *` America/New_York (hand `apply`) |
| Projection reads | only in each kickoff slot's 2 h, first pass inside | the same, plus the week ahead once a day from 06:00 ET (Tue to the first kickoff) |

## The order of a Thursday's passes (America/New_York)
1. **06:00 `inseason-capture`:** the day's read of week N+1, parsed in the same execution. Tuesday's and Wednesday's 06:00 reads already stand.
2. **14:00 `inseason` (season-week):** the freeze sets the order (Lane 93's final pass). It keeps `published_points` from the newest snapshot captured at or before 14:00 (`model/register/freeze.py` `week_published_points`). That holds on main and on Lane 93's branch alike, since both read "newest at or before the freeze".
3. **19:00 `inseason-capture`:** the first pass inside the Thursday slot's window (18:15 to 20:15 for a 20:15 kickoff) reads the slot's projection. It comes after the freeze and never changes it.

## Quota cost
- **The projection read:** one Tank01 request a day while it is due. That is 3 a week for a Thursday week and at most 7 after a long gap, about 60 a season.
- **The new 06:00 pass:** it also runs the harvest's other feeds once more a day. That is injuries by date, news and depth charts (3), the lines feed (one per game day still ahead in the week: 3 on Tue to Thu, 2 on Fri to Sun, 1 on Mon) and inactives on game days. Together that is about 6 to 7 requests a day, about 45 a week.
- **Per pass:** the ten-request ceiling holds. A pass with the projection is at most 4 single feeds + 1 projection + 5 game days in a holiday week.
- If the extra 06:00 pass costs too much, leave the cron as it was. The code then takes the read at 07:00 for one request a day, still before the freeze.

## This week (week 7)
- Week 6's last game is tonight, Mon Oct 19, 20:15 ET. The daily read of week 7 is due from **Tue Oct 20, 06:00 ET**.
- The new code needs to be on main and the research image deployed (`research.yml` deploys on a push touching `research/**`). Then:
  - the first pass at or after 06:00 Tuesday captures week 7: 06:00 if the schedule is applied, else 07:00;
  - every later hour retries until the read lands, so any deploy before Thursday ~13:00 ET still gives the freeze a snapshot.
- If merged tonight, the schedule starts before Tuesday 06:00 and no hand run is needed.
- A hand run only helps once the new image is deployed. The old image never reads week 7 before Thursday 18:15. Run it Tuesday at or after 06:00 ET:

  `gh workflow run ops.yml -f job=inseason-capture`

  It writes `capture-harvest` lines naming `tank01_projections: captured, 1 requests` and then `projections-parse: 1 snapshots, ...`.

## Gates (exit codes)
Run in `research/`. The Postgres was a private cluster on port 55497 (admin database `lane97_admin`), not 5433, because the parity runner drops every `parity_*` database on its server at start (`runner.py` `drop_scratch_databases`). That would hit other lanes' scratch databases on the shared 5433.

- `uv run ruff check .`: 0
- `uv run ruff format --check .`: 0
- `uv run mypy -p research`: 0 (707 files)
- `PARITY_DATABASE_URL=postgres://commish@localhost:55497/lane97_admin uv run pytest`: 0 (1716 passed; `test_benchmark_captures.py` 20, five of them new)
- `uv run python -m research.parity ingest tank01-capture-harvest`: 0 (first and rerun passes, `capture_snapshots` 5 and 5 rows, match)

The new tests:
- the daily window: Tuesday from 06:00 to Thursday's first kickoff, none on Monday or after the kickoff;
- a week without a Thursday game;
- week 1 and the offseason;
- through `run_capture_harvest` with a fake Tank01 fetcher: one request a day on Tue, Wed and Thu at 06:00, none at 02:00 or 07:00; an unchanged read keeps Tuesday's snapshot; Thursday's slot still reads the week;
- another week's read never counts as today's, and each changed day's snapshot is kept.

## Concerns
- **The schedule is applied by hand.** `infra/research-schedule.sh apply` has to be run for the 06:00 pass. Until then the read lands at 07:00. `caption.py` already counts a 06:00 pass, so between 02:00 and 06:00 ET a "new read is due by" caption names a time one hour early.
- **The provider's answer before a week is published is unknown** (fixtures only; I made no provider calls).
  - If Tuesday's 06:00 request gets an error, the feed fails. The execution exits 1, which emails the alert, and the read retries hourly, one request each, until the week is published.
  - If the provider answers with a payload the strict parser refuses, that snapshot stays unparsed. Every pass then fails its parse line, as any refused snapshot already does.
- **The parity case does not exercise either projection read,** because its scratch database has no kickoffs. The daily read is covered by the pytest cases above.
