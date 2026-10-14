"""THE IN-SEASON JOBS: the two research tasks whose cadence the nightly run cannot carry.

What they record depends on when they run (`research/JOBS.md`, `research-ts/src/inseason/main.ts`):

- `season-week`, the prospective register's weekly pass: ingest the week's nflverse stats, snapshot
  the props, grade every frozen week whose games are complete, freeze the coming week before its
  first kickoff, print the running score. Tuesday 08:00, Wednesday 18:00 and Thursday 14:00
  America/New_York: the freeze must land before Thursday's first kickoff, with the props it was
  measured against, which a 05:00 UTC nightly cannot promise.
- `capture-harvest`, the provider capture (injuries, news, depth charts, inactives, game lines) into
  the append-only archive, hourly 07:00 to 23:00 plus 02:00 America/New_York, because game-day
  inactives and injury moves reach the archive only if something captures them within the hour.

Each invocation is one pass; Cloud Scheduler owns the cadence (`infra/README.md`). They replace the
Vercel cron's `season-week` and `capture-harvest` jobs.
"""
