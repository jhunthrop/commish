// THE HARVEST'S CADENCE, IN ONE NAMED PLACE (peek document design §3.4, 2026-09-07).
//
// WHY THIS FEED IS POLLED AT ALL, when every other rebuild in this design is event-driven. The
// injuries and news feeds are somebody else's data and the provider offers no push, so there is no
// event to subscribe to: the only way to learn that a designation moved is to ask. What the design
// insists on is that the asking rate be a stated number with the provider's own budget written
// beside it, rather than a cron line nobody has costed.
//
// WHAT THE RATE BUYS. An injury designation is the fact on a player card that goes stale fastest and
// hurts most when it does: a manager setting a lineup wants to know a man was ruled out an hour ago,
// not tomorrow morning. Hourly through the hours anybody is awake puts a designation change on the
// peek within the hour, and the document rebuild it triggers is targeted at exactly the players
// whose designation or headlines actually moved.
export const HARVEST_CONFIG = {
  /**
   * Hourly from 07:00 through 23:00, plus the 02:00 pre-dawn fire the nightly passes depend on.
   *
   * The 02:00 fire is not decoration: `adp-snapshot` at 03:00, `props-preseason-snapshot` at 03:30
   * and `capsule-sweep` at 04:00 all read the archive this job writes, and the schedule has always
   * put a capture ahead of them. Dropping it in favour of a plain waking-hours window would leave
   * those three reading captures made three hours before midnight.
   */
  cron: "0 2,7-23 * * *",
  timezone: "America/New_York",
  /** 18 fires a day (02:00 plus 07:00 through 23:00). */
  firesPerDay: 18,
  /**
   * Five feeds, each a single upstream request regardless of cadence (`CAPTURE_FEEDS`' own
   * `requests()`): injuries by date, news, depth charts, inactives and betting odds.
   */
  requestsPerFire: 5,
  /**
   * THE PROVIDER'S BUDGET, STATED. 90 requests a day at the worst case, which is every feed due on
   * every fire. That is the whole daily draw of this job, and it is deliberately separate from the
   * ingestion worker's shared ledger (`stats-pipeline/config.ts`'s `dailyRequestBudget`): this job
   * runs on its own schedule with its own small fixed feed list, and a private ceiling is honest
   * rather than a workaround. The purchased Tank01 tier's own daily allowance is what this has to
   * fit inside, alongside live scoring's draw on Sundays.
   */
  requestsPerDay: 90,
} as const;
