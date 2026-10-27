"""THE IN-SEASON JOBS: the two research tasks whose cadence the nightly run cannot carry.

What they record depends on when they run (`research/JOBS.md`, `research-ts/src/inseason/main.ts`):

- `season-week`, the prospective register's weekly pass: ingest the week's nflverse stats, snapshot
  the props, grade every frozen week whose games are complete, freeze the coming week before its
  first kickoff, print the running score. Tuesday 08:00 and 20:30, Wednesday 18:00 and Thursday
  14:00 America/New_York (`week_complete.GRADING_PASSES`): the freeze must land before Thursday's first kickoff, with the props it was
  measured against, which a 05:00 UTC nightly cannot promise.
- `capture-harvest`, the provider capture (injuries, news, depth charts, inactives, game lines) into
  the append-only archive, hourly 06:00 to 23:00 plus 00:00 and 02:00 America/New_York, because game-day
  inactives and injury moves reach the archive only if something captures them within the hour. From
  the day after a week's last game, the first pass at or after 06:00 each day also reads the week
  ahead's published projection (Lane 97), so Thursday's 14:00 freeze has that morning's.

`void-game` is the operator's void of one game that will never be whole (Lane 249, `game_voids.py`);
no schedule runs it.

Each invocation is one pass; Cloud Scheduler owns the cadence (`infra/README.md`). They replace the
Vercel cron's `season-week` and `capture-harvest` jobs.
"""
