import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { TeamCard } from "@/domain/league";
import { leagues, teams, users } from "@/db/schema";

/**
 * Every team in a league, with the owner's public profile, ordered by id so two clients
 * always render the same list in the same order. Display order in the room comes from
 * `draftStateView.draftOrder`, not from this.
 */
export async function listTeamCards(db: Db, leagueId: string): Promise<readonly TeamCard[]> {
  return db
    .select({ id: teams.id, name: teams.name, ownerDisplayName: users.displayName, ownerAvatarUrl: users.avatarUrl })
    .from(teams)
    .innerJoin(users, eq(users.id, teams.userId))
    .where(eq(teams.leagueId, leagueId))
    .orderBy(asc(teams.id));
}

/**
 * The league's display name, for the room header. Returned as `leagueId` if the row somehow
 * isn't there — a draft's `leagueId` is a NOT NULL foreign key, so that can't happen in
 * practice, and a header is not the place to fail a whole snapshot over it.
 */
export async function leagueNameFor(db: Db, leagueId: string): Promise<string> {
  const [league] = await db.select({ name: leagues.name }).from(leagues).where(eq(leagues.id, leagueId));
  return league?.name ?? leagueId;
}
