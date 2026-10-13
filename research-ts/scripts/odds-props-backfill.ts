// Archives ONE historical player-prop snapshot per regular-season week, for every season passed
// via --seasons (default 2023,2024,2025), spending at most --budget (default 9000) real credits
// this run. The snapshot instant for a week is `SNAPSHOT_OFFSET_HOURS` before that week's own
// first kickoff (`backfill-plan.ts`), read from the store's already-ingested schedule
// (`kickoffInstantsByWeek`) -- so a season this store has not ingested a schedule for yet is
// skipped with a printed note, never guessed at.
//
// Run: npm run projections:odds:backfill
// npm run projections:odds:backfill -- --budget=3000 --seasons=2023
//
// THE HISTORICAL /events CALL RETURNS THE WHOLE SEASON, NOT ONE WEEK (verified live against the
// API: a single call near week one's own kickoff already listed every game through week eighteen).
// This script still calls it once PER WEEK anyway, at that week's own snapshot instant, rather than
// once per season: the extra calls cost about 1 credit each against roughly 40 credits per event's
// own odds call, and a per-week call is robust to an in-season schedule change (a flexed Sunday
// night game, an international kickoff moved) that a single season-start snapshot could not see.
// `eventsInWeekWindow` then narrows that response down to the one week being processed.
//
// THE BUDGET GUARD USES REAL, HEADER-MEASURED SPEND, NEVER AN ESTIMATE (`backfill-plan.ts`'s
// `hasBudgetRemaining`): `usedThisRun` is `x-requests-used` diffed against its own value at this
// run's first response, checked before every event-odds call. When it trips, the run stops --
// mid-week if it must -- and prints the exact resume point rather than spending past the operator's
// stated cap. A LATER RUN NEEDS NO RESUME FLAG: `archivedEventIds` (`props-store.ts`) is read once
// at start-up and `eventsNeedingFetch` (`backfill-plan.ts`) skips every event already archived, so
// re-running the identical command simply picks up where the budget stopped it.
import { createDb } from "@research-ts/db/client";
import type { Db } from "@research-ts/db/client";
import {
  eventsInWeekWindow,
  eventsNeedingFetch,
  hasBudgetRemaining,
  weekSnapshotInstants,
  type WeekSnapshotInstant,
} from "@research-ts/projections/odds/backfill-plan";
import { parseHistoricalEventOddsPage, parseHistoricalEventsPage, type HistoricalEventsPage } from "@research-ts/projections/odds/historical";
import { ODDS_API_BASE, SPORT_KEY, creditStatus, requireEnv, requireOk, toHistoricalDateParam, type CreditStatus } from "@research-ts/projections/odds/http";
import { archivedEventIds, parseEventOddsResponse, PROP_MARKETS, recordPropObservations } from "@research-ts/projections/odds/props-store";
import { kickoffInstantsByWeek } from "@research-ts/projections/team-store";

const DEFAULT_BUDGET = 9000;
const DEFAULT_SEASONS: readonly number[] = [2023, 2024, 2025];

interface RunOptions {
  readonly budget: number;
  readonly seasons: readonly number[];
}

function parseArgs(argv: readonly string[]): RunOptions {
  let budget = DEFAULT_BUDGET;
  let seasons = DEFAULT_SEASONS;
  for (const arg of argv) {
    if (arg.startsWith("--budget=")) {
      budget = Number(arg.slice("--budget=".length));
    } else if (arg.startsWith("--seasons=")) {
      seasons = arg
        .slice("--seasons=".length)
        .split(",")
        .map((s) => Number(s.trim()));
    }
  }
  if (!Number.isFinite(budget) || budget <= 0) throw new Error(`--budget must be a positive number (got ${budget}).`);
  for (const season of seasons) {
    if (!Number.isInteger(season)) throw new Error(`--seasons must be a comma-separated list of integers (got ${String(season)}).`);
  }
  return { budget, seasons };
}

async function fetchHistoricalEvents(apiKey: string, dateIso: string): Promise<{ page: HistoricalEventsPage; credits: CreditStatus }> {
  const url = new URL(`${ODDS_API_BASE}/historical/sports/${SPORT_KEY}/events`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("date", dateIso);
  const response = await fetch(url.toString());
  await requireOk(response, "/historical/events");
  const credits = creditStatus(response);
  const payload: unknown = await response.json();
  return { page: parseHistoricalEventsPage(payload), credits };
}

async function fetchHistoricalEventOdds(
  apiKey: string,
  eventId: string,
  dateIso: string,
): Promise<{ timestamp: Date; data: unknown; credits: CreditStatus }> {
  const url = new URL(`${ODDS_API_BASE}/historical/sports/${SPORT_KEY}/events/${eventId}/odds`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("date", dateIso);
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", PROP_MARKETS.join(","));
  url.searchParams.set("oddsFormat", "american");
  const response = await fetch(url.toString());
  await requireOk(response, `/historical/events/${eventId}/odds`);
  const credits = creditStatus(response);
  const payload: unknown = await response.json();
  const page = parseHistoricalEventOddsPage(payload);
  return { timestamp: page.timestamp, data: page.data, credits };
}

interface CreditTracker {
  usedThisRun: number;
  lastRemaining: string;
}

function track(tracker: CreditTracker, credits: CreditStatus, usedAtStart: { value: number | null }): void {
  tracker.lastRemaining = credits.remaining;
  const used = Number(credits.used);
  if (!Number.isFinite(used)) return;
  if (usedAtStart.value === null) usedAtStart.value = used;
  tracker.usedThisRun = used - usedAtStart.value;
}

interface WeekReport {
  readonly week: number;
  readonly events: number;
  readonly fetched: number;
  readonly alreadyArchived: number;
  readonly observations: number;
  /** Player+points dropped rather than archived this week -- unpaired (one side only) and
   *  duplicate (a book contradicting itself, `props-store.ts`'s own skip case) alike. */
  readonly skipped: number;
  /** The `duplicate` subset of `skipped` -- broken out because it is the count that answers "how
   *  many books contradicted themselves this run", which the combined total does not. */
  readonly skippedDuplicate: number;
}

/** Processes one week: discover its events (one `/historical/events` call), skip what is already
 *  archived, fetch the rest. `budgetStopped` comes back `true` when the guard tripped partway
 *  through this week's own events, so the caller can record the exact resume point rather than
 *  reporting a partial week as complete. */
async function processWeek(
  db: Db,
  apiKey: string,
  season: number,
  instant: WeekSnapshotInstant,
  archived: Set<string>,
  budget: number,
  tracker: CreditTracker,
  usedAtStart: { value: number | null },
): Promise<{ report: WeekReport; budgetStopped: boolean }> {
  const { week, firstKickoff, snapshotAt } = instant;
  const { page: eventsPage, credits: eventsCredits } = await fetchHistoricalEvents(apiKey, toHistoricalDateParam(snapshotAt));
  track(tracker, eventsCredits, usedAtStart);

  const weekEvents = eventsInWeekWindow(eventsPage.events, firstKickoff);
  const toFetch = eventsNeedingFetch(weekEvents, archived);
  const alreadyArchivedCount = weekEvents.length - toFetch.length;

  let fetched = 0;
  let observations = 0;
  let skipped = 0;
  let skippedDuplicate = 0;
  let budgetStopped = false;

  for (const event of toFetch) {
    if (!hasBudgetRemaining(tracker.usedThisRun, budget)) {
      budgetStopped = true;
      break;
    }
    const odds = await fetchHistoricalEventOdds(apiKey, event.id, toHistoricalDateParam(snapshotAt));
    track(tracker, odds.credits, usedAtStart);
    const { observations: parsed, skippedUnpaired } = parseEventOddsResponse(odds.data, odds.timestamp);
    const written = await recordPropObservations(db, parsed);
    archived.add(event.id);
    fetched += 1;
    observations += written;
    skipped += skippedUnpaired.length;
    const duplicateCount = skippedUnpaired.filter((skip) => skip.reason === "duplicate").length;
    skippedDuplicate += duplicateCount;
    console.log(
      `  season ${season} week ${week} ${event.awayTeam} @ ${event.homeTeam} [${event.id}]: ${written} rows` +
        `${skippedUnpaired.length > 0 ? `, ${skippedUnpaired.length} skipped (${duplicateCount} duplicate)` : ""}` +
        ` (credits remaining=${tracker.lastRemaining}, used this run=${tracker.usedThisRun})`,
    );
  }

  return {
    report: { week, events: weekEvents.length, fetched, alreadyArchived: alreadyArchivedCount, observations, skipped, skippedDuplicate },
    budgetStopped,
  };
}

async function main(): Promise<void> {
  const { budget, seasons } = parseArgs(process.argv.slice(2));
  const apiKey = requireEnv("ODDS_API_KEY");
  const db = createDb(requireEnv("DATABASE_URL"));

  const archived = new Set(await archivedEventIds(db));
  const tracker: CreditTracker = { usedThisRun: 0, lastRemaining: "unknown" };
  const usedAtStart = { value: null as number | null };

  console.log(`odds-props-backfill: budget=${budget}, seasons=${seasons.join(",")}, ${archived.size} event(s) already archived.`);

  let budgetStopped = false;
  let resumePoint: { season: number; week: number } | null = null;
  let runSkipped = 0;
  let runSkippedDuplicate = 0;

  for (const season of seasons) {
    if (budgetStopped) break;

    const kickoffsByWeek = await kickoffInstantsByWeek(db, season);
    const instants = weekSnapshotInstants(kickoffsByWeek);
    if (instants.length === 0) {
      console.log(`season ${season}: no kickoff instants in the store -- run \`npm run projections:context\` for this season first. Skipped.`);
      continue;
    }

    const weekReports: WeekReport[] = [];
    const gaps: string[] = [];

    for (const instant of instants) {
      if (!hasBudgetRemaining(tracker.usedThisRun, budget)) {
        budgetStopped = true;
        resumePoint = { season, week: instant.week };
        break;
      }
      const { report, budgetStopped: stoppedMidWeek } = await processWeek(db, apiKey, season, instant, archived, budget, tracker, usedAtStart);
      weekReports.push(report);
      if (report.events === 0) gaps.push(`week ${report.week}: 0 events found at snapshot ${instant.snapshotAt.toISOString()}`);
      console.log(
        `season ${season} week ${report.week}: ${report.events} events (${report.fetched} fetched, ${report.alreadyArchived} already archived), ` +
          `${report.observations} observations written.`,
      );
      if (stoppedMidWeek) {
        budgetStopped = true;
        resumePoint = { season, week: instant.week };
        break;
      }
    }

    const seasonEvents = weekReports.reduce((sum, w) => sum + w.events, 0);
    const seasonObservations = weekReports.reduce((sum, w) => sum + w.observations, 0);
    const seasonSkipped = weekReports.reduce((sum, w) => sum + w.skipped, 0);
    const seasonSkippedDuplicate = weekReports.reduce((sum, w) => sum + w.skippedDuplicate, 0);
    runSkipped += seasonSkipped;
    runSkippedDuplicate += seasonSkippedDuplicate;
    console.log(
      `SEASON ${season} SUMMARY: weeks covered ${weekReports.map((w) => w.week).join(",") || "none"}, events ${seasonEvents}, ` +
        `observations ${seasonObservations}, skipped ${seasonSkipped} (${seasonSkippedDuplicate} duplicate)` +
        `${gaps.length > 0 ? `, gaps: ${gaps.join("; ")}` : ""}`,
    );
  }

  console.log(`Total skipped this run: ${runSkipped} (${runSkippedDuplicate} duplicate, ${runSkipped - runSkippedDuplicate} single-sided).`);
  console.log(`Credits used this run: ${tracker.usedThisRun} of ${budget} budgeted. Remaining on the key: ${tracker.lastRemaining}.`);
  if (budgetStopped && resumePoint !== null) {
    console.log(
      `BUDGET STOP: the run stopped at season ${resumePoint.season}, week ${resumePoint.week}, before spending past the budget. ` +
        `Re-run the identical command to resume -- already-archived events are skipped automatically. The budget was NOT raised by this run.`,
    );
  } else {
    console.log("Completed every requested season within budget.");
  }
}

// The client closes on every path. A thrown error used to leave the pool open, and the process hung
// instead of exiting 1, which is how the Python parity harness found it on 2026-10-13.
main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
