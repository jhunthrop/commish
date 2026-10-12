import type { Db } from "@research-ts/db/client";
import { drafts, leagues, scoringSettings, teams } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import { PPR_SCORING } from "@research-ts/domain/scoring";
import type { Clock } from "@research-ts/domain/timing";
import { DEV_SEED } from "./config";
import { ensureDevUsers, preserveRealCommissioner, preserveRealTeamOwner } from "./dev-users";
import { seedTierDemoIdentities } from "./seed-tier-demo";

const TIER_DEMO_LEAGUE_ID = "dev_public_tier_demo";

const MS_PER_HOUR = 60 * 60 * 1000;
/** Far enough out that a browsed league's draft clock starts in a slow tier, not at the floor. */
const KICKOFF_HOURS = 48;
/** Auction budget for the seeded auction rooms. Cosmetic here, like every stake tier. */
const AUCTION_BUDGET = 200;

/**
 * The open leagues `/browse` demonstrates. Placeholder owners only — real identity is WorkOS's
 * — and it refuses to run in production for the same reason `seedDevLeagues` does.
 *
 * Partially filled on purpose: a browse page whose every league is empty proves nothing about
 * the fill-status copy, and one FULL league proves the open-seat rule against a real row.
 * Idempotent in the row-count sense (every write is an upsert, so replaying is safe) but not
 * byte-identical: `kickoffAt` is recomputed from `clock.now()` on each run, so a real second
 * run legitimately reschedules the drafts. Like `seedDevLeagues`, it does NOT reset a draft's
 * status: doing that without also clearing that draft's `draft_actions` log would leave the two
 * disagreeing.
 */
export async function seedPublicLeagues(db: Db, clock: Clock): Promise<{ leagues: number; teams: number }> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seedPublicLeagues creates placeholder users and must never run in production.");
  }

  const kickoffAt = new Date(Date.parse(clock.now()) + KICKOFF_HOURS * MS_PER_HOUR);
  const ownerIds = await ensureDevUsers(db);
  // Task 7.5: the tier-demo league's own three seats never come from the pool above — see
  // `seedTierDemoIdentities`'s own docblock for why a shared, drift-prone identity can't hold
  // this composition durably.
  const tierDemoIdentities = await seedTierDemoIdentities(db, clock);
  let seededTeams = 0;

  for (const plan of DEV_SEED.publicLeagues) {
    await db
      .insert(leagues)
      .values({
        id: plan.leagueId,
        name: plan.name,
        format: plan.format,
        teamCount: plan.teamCount,
        stakeTier: plan.stakeTier,
        experienceTier: plan.experienceTier,
        isPublicMatchmade: true,
        // Deliberately a placeholder, never the claim user: a browsable league you already
        // run is not a league you can demonstrate JOINING.
        commissionerUserId: ownerIds[0]!,
        rosterSlots: [...STANDARD_ROSTER_SLOTS],
      })
      .onConflictDoUpdate({
        target: leagues.id,
        set: {
          name: plan.name,
          isPublicMatchmade: true,
          stakeTier: plan.stakeTier,
          experienceTier: plan.experienceTier,
          commissionerUserId: preserveRealCommissioner(),
        },
      });

    await db
      .insert(scoringSettings)
      .values({ leagueId: plan.leagueId, ...PPR_SCORING })
      .onConflictDoNothing({ target: scoringSettings.leagueId });

    // Task 7.5: `dev_public_tier_demo` alone never draws its seats from the shared pool above —
    // `seedTierDemoIdentities`'s own three dedicated identities are what keep this league's
    // composition ("Mostly newcomers") true forever rather than only until the shared pool's
    // own drift catches up to it (see that module's own docblock for the incident). A
    // brand-new leagueId only, never a retrofit onto an existing entry: shifting an
    // ALREADY-seeded league's seats collides `teams_league_user_idx` on any database this seed
    // already ran against under an older mapping (found running `npm run seed` against the
    // shared dev database while building Task 10).
    const seats = plan.leagueId === TIER_DEMO_LEAGUE_ID ? [...tierDemoIdentities.newcomers, tierDemoIdentities.veteran] : ownerIds.slice(0, plan.filled);
    if (seats.length > 0) {
      await db
        .insert(teams)
        .values(
          seats.map((userId, i) => ({
            id: `${plan.leagueId}_team_${String(i + 1).padStart(2, "0")}`,
            leagueId: plan.leagueId,
            userId,
            name: DEV_SEED.teamNames[i] ?? `Team ${i + 1}`,
          })),
        )
        .onConflictDoUpdate({ target: teams.id, set: { userId: preserveRealTeamOwner() } });
      seededTeams += seats.length;
    }

    await db
      .insert(drafts)
      .values({
        id: plan.draftId,
        leagueId: plan.leagueId,
        format: plan.format,
        status: "scheduled",
        kickoffAt,
        auctionBudget: plan.format === "auction" ? AUCTION_BUDGET : null,
      })
      .onConflictDoUpdate({ target: drafts.id, set: { kickoffAt } });
  }

  return { leagues: DEV_SEED.publicLeagues.length, teams: seededTeams };
}
