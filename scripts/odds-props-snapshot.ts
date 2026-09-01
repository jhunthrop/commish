// Fetches every upcoming NFL event within the next 14 days, then each event's player-prop odds
// across the four verified markets (player_pass_yds, player_reception_yds, player_receptions,
// player_rush_yds), and writes every bookmaker's every Over/Under pair to the player props
// archive. The archive is append-only: a repeated run inserts a fresh set of rows, it never
// updates or replaces the ones a prior run wrote (vegas-laws Task 6).
//
// Run: npm run projections:odds:snapshot
// (dotenv -e .env.local -- tsx scripts/odds-props-snapshot.ts)
//
// Dry run (fetches the event list only, makes no odds requests, writes nothing):
// npm run projections:odds:snapshot -- --dry-run
import { createDb } from "@/db/client";
import { envOrUndefined } from "@/lib/env";
import { countPropObservations, parseEventOddsResponse, PROP_MARKETS, recordPropObservations } from "@/projections/odds/props-store";

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const SPORT_KEY = "americanfootball_nfl";
/**
 * How far ahead of now an event may kick off and still be worth a snapshot this run.
 *
 * The brief specified 8 days, sized for the steady-state weekly cadence (run this a day or two
 * after the previous week's games, and the next week's 16 games always kick off within a week).
 * This round's real run does not land in that steady state: today (implementation time) is 9-14
 * days before week 1's own 16 games (verified live against the API -- the earliest kickoff is
 * 2026-09-10, the latest week-1 kickoff is 2026-09-15), because the season has not started yet.
 * An 8-day window would return zero events on the one real run this task requires, so this is
 * widened to 14 days: enough to cover one full NFL week (Thursday opener through the Monday
 * night closer) from any point after the previous week ends, INCLUDING this preseason gap, while
 * still landing short of the following week's own Thursday opener (7 days after this one's), so a
 * normal weekly run never scoops up two weeks at once.
 */
const WINDOW_DAYS = 14;
/** The credit-budget cap from the brief: fetching odds for more than this many events in one run
 *  is refused, with a printed note, rather than silently spending the whole monthly ledger. */
const MAX_EVENTS_PER_RUN = 20;

interface OddsEvent {
  readonly id: string;
  readonly commenceTime: Date;
  readonly homeTeam: string;
  readonly awayTeam: string;
}

interface CreditStatus {
  readonly remaining: string;
  readonly used: string;
}

function requireEnv(name: string): string {
  const value = envOrUndefined(name);
  if (value === undefined) {
    throw new Error(`${name} is not set. Put a The Odds API key in .env.local, then run this through \`npm run projections:odds:snapshot\`.`);
  }
  return value;
}

function creditStatus(response: Response): CreditStatus {
  return {
    remaining: response.headers.get("x-requests-remaining") ?? "unknown",
    used: response.headers.get("x-requests-used") ?? "unknown",
  };
}

async function requireOk(response: Response, path: string): Promise<void> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`The Odds API returned HTTP ${response.status} for ${path}.${body ? ` Body: ${body}` : ""}`);
  }
}

function parseEventsPayload(payload: unknown): readonly OddsEvent[] {
  if (!Array.isArray(payload)) throw new Error("odds-props-snapshot: /events response was not an array.");
  return payload.map((raw, index) => {
    if (typeof raw !== "object" || raw === null) throw new Error(`odds-props-snapshot: /events[${index}] was not an object.`);
    const event = raw as Record<string, unknown>;
    const { id, commence_time: commenceTimeRaw, home_team: homeTeam, away_team: awayTeam } = event;
    if (typeof id !== "string" || id === "") throw new Error(`odds-props-snapshot: /events[${index}].id is missing.`);
    if (typeof commenceTimeRaw !== "string") throw new Error(`odds-props-snapshot: /events[${index}].commence_time is missing.`);
    const commenceTime = new Date(commenceTimeRaw);
    if (Number.isNaN(commenceTime.getTime())) {
      throw new Error(`odds-props-snapshot: /events[${index}].commence_time is unparseable ("${commenceTimeRaw}").`);
    }
    if (typeof homeTeam !== "string" || typeof awayTeam !== "string") {
      throw new Error(`odds-props-snapshot: /events[${index}] is missing home_team or away_team.`);
    }
    return { id, commenceTime, homeTeam, awayTeam };
  });
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

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const apiKey = requireEnv("ODDS_API_KEY");

  const { events, credits: eventsCredits } = await fetchEvents(apiKey);
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
  const selected = upcoming.slice(0, MAX_EVENTS_PER_RUN);

  if (dryRun) {
    console.log("Dry run: event list fetched only, no odds requests made, nothing written.");
    console.log(`Credits after /events: remaining=${eventsCredits.remaining} used=${eventsCredits.used}`);
    return;
  }

  const db = createDb(requireEnv("DATABASE_URL"));
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

  await db.$client.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
