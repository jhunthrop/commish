import { eq } from "drizzle-orm";
import { kickoffInstant } from "./kickoff";
import type { getDb } from "@/db/client";
import { nflGames } from "@/db/schema";

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
