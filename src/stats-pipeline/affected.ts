import { and, eq, inArray, ne, notExists, sql } from "drizzle-orm";
import type { ReadonlyDb } from "@/db/client";
import { lineupSlots, rosterSlots, teams } from "@/db/schema";
import { BENCH_SLOT } from "@/domain/roster";

export interface AffectedTeam {
  readonly leagueId: string;
  readonly teamId: string;
}

export interface AffectedInput {
  readonly week: number;
  readonly playerIds: readonly string[];
}

/**
 * Which teams' scores a set of changed players can move, in one week.
 *
 * This is the "inverted playerId -> rosters index" the spec asks for, and it is a pair of index
 * lookups rather than a maintained data structure: `lineup_slots_player_week_idx` and
 * `roster_slots_player_idx` (migration 0013) are maintained incrementally by Postgres on every
 * lineup save and every draft pick, which is what a hand-rolled Redis map would be trying to
 * imitate and could get wrong. `src/db/index-plans.test.ts` fails the build if either of these
 * plans ever sequentially scans.
 *
 * Both halves are needed because `getLineup` has two halves: saved lineup rows win, and a team
 * with none fields its roster (`defaultLineup`). A team in the second group has no `lineup_slots`
 * row to find, so a lineup-only resolver would silently stop updating the score of every manager
 * who never opened the lineup editor. The roster half is therefore restricted to teams with NO
 * saved lineup for the week, or a benched player would come back in through it.
 */
export async function affectedTeams(db: ReadonlyDb, { week, playerIds }: AffectedInput): Promise<readonly AffectedTeam[]> {
  if (playerIds.length === 0) return [];

  const started = await db
    .select({ leagueId: teams.leagueId, teamId: teams.id })
    .from(lineupSlots)
    .innerJoin(teams, eq(teams.id, lineupSlots.teamId))
    .where(and(eq(lineupSlots.weekNumber, week), inArray(lineupSlots.playerId, [...playerIds]), ne(lineupSlots.slot, BENCH_SLOT)));

  const owned = await db
    .select({ leagueId: teams.leagueId, teamId: teams.id })
    .from(rosterSlots)
    .innerJoin(teams, eq(teams.id, rosterSlots.teamId))
    .where(
      and(
        inArray(rosterSlots.playerId, [...playerIds]),
        // Only teams with NOTHING saved for this week; anything saved already answered above,
        // including a deliberate benching.
        notExists(
          db
            .select({ one: sql`1` })
            .from(lineupSlots)
            .where(and(eq(lineupSlots.teamId, rosterSlots.teamId), eq(lineupSlots.weekNumber, week))),
        ),
      ),
    );

  const byKey = new Map([...started, ...owned].map((row) => [`${row.leagueId}:${row.teamId}`, row]));
  return [...byKey.values()].sort((a, b) => `${a.leagueId}:${a.teamId}`.localeCompare(`${b.leagueId}:${b.teamId}`));
}
