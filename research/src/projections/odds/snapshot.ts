// THE PROPS SNAPSHOT CORE — fetches every upcoming NFL event within the window, then each
// event's player-prop odds across the four verified markets, and appends every bookmaker's every
// Over/Under pair to the props archive (append-only: a repeated run inserts a fresh set of rows,
// never updates the ones a prior run wrote — vegas-laws Task 6).
//
// Moved here from `scripts/odds-props-snapshot.ts` (which keeps the CLI entry point) when the
// durable job system became a second caller that lives in `src/` and may not import `scripts/`:
// the snapshot is application logic with three consumers now — the standalone script, the weekly
// cadence's props step, and the season-week job — and one implementation serves all three.
import type { Db } from "@research/db/client";
import {
  ODDS_API_BASE,
  SPORT_KEY,
  creditStatus,
  parseOddsEvent,
  requireOk,
  type CreditStatus,
  type OddsEvent,
} from "@research/projections/odds/http";
import { PROP_MARKETS, countPropObservations, parseEventOddsResponse, recordPropObservations } from "@research/projections/odds/props-store";

/**
 * How far ahead of now an event may kick off and still be worth a snapshot this run.
 *
 * The brief specified 8 days, sized for the steady-state weekly cadence. The vegas-laws round's
 * real run landed 9-14 days before week 1 (the preseason gap), so this is widened to 14: enough
 * to cover one full NFL week from any point after the previous week ends, INCLUDING that gap,
 * while still landing short of the following week's own Thursday opener.
 */
const WINDOW_DAYS = 14;
/** The credit-budget cap from the brief: fetching odds for more than this many events in one run
 *  is refused, with a printed note, rather than silently spending the whole monthly ledger. */
const MAX_EVENTS_PER_RUN = 20;

function parseEventsPayload(payload: unknown): readonly OddsEvent[] {
  if (!Array.isArray(payload)) throw new Error("odds snapshot: /events response was not an array.");
  return payload.map((raw, index) => parseOddsEvent(raw, `odds snapshot: /events[${index}]`));
}

async function fetchEvents(apiKey: string): Promise<{ events: readonly OddsEvent[]; credits: CreditStatus }> {
  const url = new URL(`${ODDS_API_BASE}/sports/${SPORT_KEY}/events`);
  url.searchParams.set("apiKey", apiKey);
  const response = await fetch(url.toString());
  await requireOk(response, "/events");
  const credits = creditStatus(response);
  const payload: unknown = await response.json();
  return { events: parseEventsPayload(payload), credits };
}

async function fetchEventOdds(apiKey: string, eventId: string): Promise<{ payload: unknown; credits: CreditStatus }> {
  const url = new URL(`${ODDS_API_BASE}/sports/${SPORT_KEY}/events/${eventId}/odds`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", PROP_MARKETS.join(","));
  url.searchParams.set("oddsFormat", "american");
  const response = await fetch(url.toString());
  await requireOk(response, `/events/${eventId}/odds`);
  const credits = creditStatus(response);
  const payload: unknown = await response.json();
  return { payload, credits };
}

/** What one snapshot run actually did — the shape the cadence's props step reports from, so its
 *  printed credits line reads the same numbers a standalone run would print. */
export interface SnapshotSummary {
  readonly totalEvents: number;
  readonly upcomingEvents: number;
  readonly selectedEvents: number;
  readonly totalWritten: number;
  readonly totalSkipped: number;
  readonly credits: CreditStatus;
}

/** The event fetch, window filter and budget cap — identical for the dry run and the real one, so
 *  a dry run reports the exact selection a real run would have fetched odds for. */
export async function selectUpcomingEvents(
  apiKey: string,
): Promise<{ events: readonly OddsEvent[]; upcoming: readonly OddsEvent[]; selected: readonly OddsEvent[]; credits: CreditStatus }> {
  const { events, credits } = await fetchEvents(apiKey);
  const now = new Date();
  const windowEnd = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const upcoming = events
    .filter((event) => event.commenceTime >= now && event.commenceTime <= windowEnd)
    .sort((a, b) => a.commenceTime.getTime() - b.commenceTime.getTime());

  console.log(`Fetched ${events.length} total NFL events; ${upcoming.length} fall within the next ${WINDOW_DAYS} days.`);
  if (upcoming.length > MAX_EVENTS_PER_RUN) {
    console.log(
      `${upcoming.length} upcoming events exceed the ${MAX_EVENTS_PER_RUN}-event budget cap for this run; ` +
        `only the first ${MAX_EVENTS_PER_RUN} (earliest kickoff first) will be fetched.`,
    );
  }
  return { events, upcoming, selected: upcoming.slice(0, MAX_EVENTS_PER_RUN), credits };
}

/**
 * THE REAL SNAPSHOT — fetches, writes, prints, and returns what it did. Never closes `db`: it is
 * handed one, not asked to make one, so a caller running this beside other steps against the same
 * connection controls that lifecycle itself.
 */
export async function runOddsSnapshot(db: Db, apiKey: string): Promise<SnapshotSummary> {
  const { events, upcoming, selected, credits: eventsCredits } = await selectUpcomingEvents(apiKey);
  const fetchedAt = new Date();
  let totalWritten = 0;
  let totalSkipped = 0;
  let lastCredits = eventsCredits;

  for (const event of selected) {
    const { payload, credits } = await fetchEventOdds(apiKey, event.id);
    lastCredits = credits;
    const { observations, skippedUnpaired } = parseEventOddsResponse(payload, fetchedAt);
    const written = await recordPropObservations(db, observations);
    totalWritten += written;
    totalSkipped += skippedUnpaired.length;

    const counts = await countPropObservations(db, fetchedAt);
    const marketCounts = PROP_MARKETS.map(
      (market) => `${market}=${counts.byEventMarket.get(`${event.id}|${market}`) ?? 0}`,
    ).join(", ");
    console.log(`${event.awayTeam} @ ${event.homeTeam} (${event.commenceTime.toISOString()}) [${event.id}]: ${written} rows (${marketCounts})`);
    if (skippedUnpaired.length > 0) {
      console.log(`  skipped ${skippedUnpaired.length} single-sided line(s) (no opposite price to store):`);
      for (const skipped of skippedUnpaired) {
        console.log(`    ${skipped.bookmaker}/${skipped.market}: ${skipped.playerName} at ${skipped.point} (only ${skipped.presentSide} priced)`);
      }
    }
  }

  console.log(`Total observations written: ${totalWritten}`);
  console.log(`Total single-sided lines skipped: ${totalSkipped}`);
  console.log(`Credits: remaining=${lastCredits.remaining} used=${lastCredits.used}`);

  return {
    totalEvents: events.length,
    upcomingEvents: upcoming.length,
    selectedEvents: selected.length,
    totalWritten,
    totalSkipped,
    credits: lastCredits,
  };
}
