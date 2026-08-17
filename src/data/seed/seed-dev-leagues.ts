import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, scoringSettings, teams, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { PPR_SCORING } from "@/domain/scoring";
import { DEV_SEED } from "./config";

const MS_PER_HOUR = 60 * 60 * 1000;

interface LeaguePlan {
  readonly leagueId: string;
  readonly draftId: string;
  readonly inviteCode: string;
  readonly name: string;
  readonly format: "snake" | "auction";
  readonly auctionBudget: number | null;
}

/**
 * A dev league you can point a browser at. Placeholder owners only — real identity is
 * WorkOS's, so these rows are clearly namespaced and this function refuses to run in
 * production. Idempotent: re-running updates rather than duplicating.
 */
export async function seedDevLeagues(db: Db, clock: Clock): Promise<{ leagues: number; teams: number; drafts: number }> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seedDevLeagues creates placeholder users and must never run in production.");
  }

  const claimUserId = process.env[DEV_SEED.claimUserIdEnvVar];
  const kickoffAt = new Date(Date.parse(clock.now()) + DEV_SEED.kickoffHoursFromNow * MS_PER_HOUR);

  const devUserIds = Array.from({ length: DEV_SEED.teamCount }, (_, i) => `${DEV_SEED.userIdPrefix}${String(i + 1).padStart(2, "0")}`);
  await db
    .insert(users)
    .values(devUserIds.map((id) => ({ id, email: `${id}@${DEV_SEED.emailDomain}`, displayName: `Dev Manager ${id.slice(-2)}` })))
    .onConflictDoNothing({ target: users.id });

  const ownerIds = devUserIds.map((id, index) => (index === 0 && claimUserId !== undefined ? claimUserId : id));

  const plans: readonly LeaguePlan[] = [
    { ...DEV_SEED.snake, format: "snake", auctionBudget: null },
    { ...DEV_SEED.auction, format: "auction", auctionBudget: DEV_SEED.auction.budget },
  ];

  for (const plan of plans) {
    await db
      .insert(leagues)
      .values({
        id: plan.leagueId,
        name: plan.name,
        format: plan.format,
        teamCount: DEV_SEED.teamCount,
        inviteCode: plan.inviteCode,
        commissionerUserId: ownerIds[0]!,
        rosterSlots: [...STANDARD_ROSTER_SLOTS],
      })
      .onConflictDoUpdate({ target: leagues.id, set: { commissionerUserId: sql`excluded.commissioner_user_id` } });

    await db
      .insert(scoringSettings)
      .values({ leagueId: plan.leagueId, ...PPR_SCORING })
      .onConflictDoNothing({ target: scoringSettings.leagueId });

    await db
      .insert(teams)
      .values(
        ownerIds.map((userId, i) => ({
          id: `${plan.leagueId}_team_${String(i + 1).padStart(2, "0")}`,
          leagueId: plan.leagueId,
          userId,
          name: `Team ${i + 1}`,
        })),
      )
      .onConflictDoUpdate({ target: teams.id, set: { userId: sql`excluded.user_id` } });

    await db
      .insert(drafts)
      .values({
        id: plan.draftId,
        leagueId: plan.leagueId,
        format: plan.format,
        status: "scheduled",
        kickoffAt,
        auctionBudget: plan.auctionBudget,
      })
      .onConflictDoUpdate({ target: drafts.id, set: { kickoffAt } });
  }

  return { leagues: plans.length, teams: plans.length * DEV_SEED.teamCount, drafts: plans.length };
}
