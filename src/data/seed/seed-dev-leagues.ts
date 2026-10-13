import type { Db } from "@research-ts/db/client";
import { drafts, leagues, scoringSettings, teams } from "@/db/schema";
import type { Clock } from "@research-ts/domain/timing";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import { PPR_SCORING } from "@research-ts/domain/scoring";
import { DEV_SEED } from "./config";
import { ensureDevUsers, preserveRealCommissioner, preserveRealTeamOwner } from "./dev-users";

const MS_PER_HOUR = 60 * 60 * 1000;

interface LeaguePlan {
  readonly leagueId: string;
  readonly draftId: string;
  readonly name: string;
  readonly format: "snake" | "auction";
  readonly auctionBudget: number | null;
}

/**
 * A dev league you can point a browser at. Placeholder owners only — real identity is
 * WorkOS's, so these rows are clearly namespaced and this function refuses to run in
 * production.
 *
 * `claimUserId` is an explicit parameter, not read from `process.env` in here — the entry
 * point (`src/data/seed/index.ts`) reads `DEV_SEED.claimUserIdEnvVar` and passes the result
 * in. That keeps this function a pure function of its arguments (easy to call from a test
 * without an ambient env var silently changing behavior — a developer who happens to have
 * `DEV_SEED_CLAIM_USER_ID` exported locally would otherwise get a surprise FK failure the
 * moment a test tried to use an id that isn't in the test database's `users` table).
 *
 * Idempotent in the row-count sense verified by the "running it twice" test below: re-running
 * updates existing rows rather than duplicating them. It is NOT idempotent in the "produces
 * byte-identical output" sense — `kickoffAt` is recomputed from `clock.now()` each call, so a
 * real second run (a later wall-clock time) legitimately reschedules the draft. It is also NOT
 * one transaction: a failure partway through (e.g. after the snake league's rows but before
 * the auction league's) leaves a partially-seeded database, and the fix is to re-run this
 * function, not to hand-roll a rollback — every write here is an upsert, so replaying is safe.
 * Finally, re-seeding a dev league whose draft already ran does NOT reset `drafts.status` back
 * to `scheduled` — only `kickoffAt` is touched — because resetting status without also
 * clearing that draft's `draft_actions` log would desync the two: the log would still say
 * "complete" while the row claimed "scheduled".
 */
export async function seedDevLeagues(
  db: Db,
  clock: Clock,
  claimUserId?: string,
): Promise<{ leagues: number; teams: number; drafts: number }> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seedDevLeagues creates placeholder users and must never run in production.");
  }

  const kickoffAt = new Date(Date.parse(clock.now()) + DEV_SEED.kickoffHoursFromNow * MS_PER_HOUR);
  const ownerIds = await ensureDevUsers(db, claimUserId);

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
        commissionerUserId: ownerIds[0]!,
        rosterSlots: [...STANDARD_ROSTER_SLOTS],
      })
      .onConflictDoUpdate({ target: leagues.id, set: { commissionerUserId: preserveRealCommissioner() } });

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
          name: DEV_SEED.teamNames[i] ?? `Team ${i + 1}`,
        })),
      )
      .onConflictDoUpdate({ target: teams.id, set: { userId: preserveRealTeamOwner() } });

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
