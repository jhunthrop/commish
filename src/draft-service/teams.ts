import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { TeamCard } from "@/domain/league";
import { teams, users } from "@/db/schema";

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
