import { and, eq, gte, lte } from "drizzle-orm";
import { kickoffInstant } from "./kickoff";
import type { getDb } from "@/db/client";
import { nflGames } from "@/db/schema";
import { LEAGUE_CONFIG } from "@/league";

type Db = ReturnType<typeof getDb>;

/** One NFL team's fixture for a week, already worded for a lineup row. */
export interface FixtureLabel {
  /** "vs MIN" or "@ NE" — the sport's own home/away grammar. */
  readonly opp: string;
  /** "Sun 1:00p" while scheduled, "Live" in progress, "Final" when done; "" when the source
   *  published no kickoff. */
  readonly when: string;
  readonly status: "scheduled" | "in_progress" | "final";
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** YYYYMMDD → "Thu". Calendar arithmetic only — no timezone math on a date with no clock. */
function dayOf(gameDate: string): string {
  if (!/^\d{8}$/.test(gameDate)) return "";
  const date = new Date(Date.UTC(Number(gameDate.slice(0, 4)), Number(gameDate.slice(4, 6)) - 1, Number(gameDate.slice(6, 8))));
  return DAYS[date.getUTCDay()];
}

/**
 * THE WEEK'S SCHEDULE, keyed by NFL team (founder, 2026-08-30: the ESPN lineup row needs
 * "@ KC · Sun 4:05p" beside every player). Read from `nfl_games` — the real Tank01 schedule,
 * ingested by `npm run stats:schedule` — and worded here so every consumer says a fixture the
 * same way. A team absent from the map is on BYE that week: a real fact derived from a real
 * schedule, not an invention, and the one case a lineup manager most needs shouted.
 */
export async function fixtureLabelsByTeam(db: Db, week: number): Promise<ReadonlyMap<string, FixtureLabel>> {
  const rows = await db
    .select({
      home: nflGames.homeNflTeam,
      away: nflGames.awayNflTeam,
      gameDate: nflGames.gameDate,
      kickoffEt: nflGames.kickoffEt,
      status: nflGames.status,
    })
    .from(nflGames)
    .where(eq(nflGames.week, week));
  const labels = new Map<string, FixtureLabel>();
  for (const game of rows) {
    const when =
      game.status === "final"
        ? "Final"
        : game.status === "in_progress"
          ? "Live"
          : [dayOf(game.gameDate), game.kickoffEt].filter((part) => part !== "").join(" ");
    labels.set(game.home, { opp: `vs ${game.away}`, when, status: game.status });
    labels.set(game.away, { opp: `@ ${game.home}`, when, status: game.status });
  }
  return labels;
}

/**
 * EACH TEAM'S BYE WEEK, derived from the real ingested schedule rather than declared by a feed:
 * the one regular-season week (1..{@link LEAGUE_CONFIG.regularSeasonWeeks}) in which a team that
 * otherwise plays every week has no fixture. Derivation keeps it honest the same way
 * `fixtureLabelsByTeam`'s bye story is honest — an absence in `nfl_games` is a fact about the
 * schedule, not an invention.
 *
 * A team missing MORE than one week inside the range is omitted, deliberately: that is a
 * partially ingested schedule, and naming its first hole "the bye" would state a fact the data
 * does not contain. A team playing all fourteen weeks (possible while byes land in weeks the
 * regular season doesn't reach) is likewise absent — it has no bye to report. One query, filtered
 * to the window in the database, grouped here.
 */
export async function byeWeeksByTeam(db: Db): Promise<ReadonlyMap<string, number>> {
  const rows = await db
    .select({ week: nflGames.week, home: nflGames.homeNflTeam, away: nflGames.awayNflTeam })
    .from(nflGames)
    .where(and(gte(nflGames.week, 1), lte(nflGames.week, LEAGUE_CONFIG.regularSeasonWeeks)));
  const playedWeeks = new Map<string, Set<number>>();
  for (const game of rows) {
    for (const team of [game.home, game.away]) {
      const played = playedWeeks.get(team) ?? new Set<number>();
      played.add(game.week);
      playedWeeks.set(team, played);
    }
  }
  const byes = new Map<string, number>();
  for (const [team, played] of playedWeeks) {
    const missing: number[] = [];
    for (let week = 1; week <= LEAGUE_CONFIG.regularSeasonWeeks; week += 1) {
      if (!played.has(week)) missing.push(week);
    }
    if (missing.length === 1) byes.set(team, missing[0]!);
  }
  return byes;
}

/**
 * Which NFL teams' games have STARTED this week (per-game lineup locks, founder roadmap item 2,
 * 2026-08-30 — ESPN's "Lock individually at Scheduled Gametime"). Two independent signals, both
 * honored: the fixture's own status (the worker flips it, but only as often as it ticks) and the
 * scheduled kickoff instant (exact, no polling lag). A fixture with no published kickoff locks
 * on status alone. A team with no fixture is on bye and never locks — there is no game to lock.
 */
export async function startedTeamsForWeek(db: Db, week: number, now: Date): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({
      home: nflGames.homeNflTeam,
      away: nflGames.awayNflTeam,
      gameDate: nflGames.gameDate,
      kickoffEt: nflGames.kickoffEt,
      status: nflGames.status,
    })
    .from(nflGames)
    .where(eq(nflGames.week, week));
  const started = new Set<string>();
  for (const game of rows) {
    const kickoff = kickoffInstant(game.gameDate, game.kickoffEt);
    if (game.status !== "scheduled" || (kickoff !== null && kickoff.getTime() <= now.getTime())) {
      started.add(game.home);
      started.add(game.away);
    }
  }
  return started;
}

/**
 * EVERY TEAM'S BYE WEEK, from the schedule itself (the Quilt draft room's BYES tab and lens,
 * 2026-09-02): a team's bye is the one regular-season week it plays no game in. Derived, never
 * declared — the same "a team absent from the week is on bye" fact `fixtureLabelsByTeam`'s
 * docblock already states, aggregated across the season.
 *
 * HONESTY GUARD: a team earns an entry only when the ingested schedule leaves it EXACTLY ONE
 * week short of the season's own week span. A partially ingested schedule (or an empty table)
 * would otherwise "discover" byes that are really just missing rows, and the draft room's law
 * for missing data is silence, not invention — a team absent from this map renders no bye
 * anywhere.
 */
export async function byeWeeksByTeam(db: Db): Promise<ReadonlyMap<string, number>> {
  const rows = await db.select({ week: nflGames.week, home: nflGames.homeNflTeam, away: nflGames.awayNflTeam }).from(nflGames);
  const weeksPlayed = new Map<string, Set<number>>();
  let finalWeek = 0;
  for (const game of rows) {
    finalWeek = Math.max(finalWeek, game.week);
    for (const team of [game.home, game.away]) {
      const played = weeksPlayed.get(team) ?? new Set<number>();
      played.add(game.week);
      weeksPlayed.set(team, played);
    }
  }
  const byes = new Map<string, number>();
  for (const [team, played] of weeksPlayed) {
    if (played.size !== finalWeek - 1) continue;
    for (let week = 1; week <= finalWeek; week += 1) {
      if (!played.has(week)) {
        byes.set(team, week);
        break;
      }
    }
  }
  return byes;
}
