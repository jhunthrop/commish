import type { Db } from "@research-ts/db/client";
import { users } from "@/db/schema";
import type { Clock } from "@research-ts/domain/timing";
import { DEV_SEED } from "./config";
import { seedSeasonLeague, type SeasonLeagueConfig } from "./seed-season-league";

/**
 * Phase 3.5, Task 7.5: the ledgered aging class' third occurrence, root-caused rather than
 * patched again.
 *
 * `dev_public_tier_demo`'s three seats (`seed-public-leagues.ts`) used to be three members of
 * the SAME shared 12-identity pool (`ensureDevUsers`, `./dev-users.ts`) every other dev seeder —
 * `dev_league_snake`, `dev_league_auction`, `seed-enforcement.ts`'s three arcs, `seed-
 * integrity.ts` — also seats. `stampSeasonCompleteInTx` (`@/league-service/participation`) stamps
 * ANY league's season complete the moment its last unscored matchup is settled; it has no notion
 * of "this league only ever existed to demo a lineup lock." A `scheduled` draft any of those
 * OTHER seeders leaves behind (`dev_league_snake`'s own kickoff is always "now") eventually gets
 * started and autopicked by the ticker/worker every e2e run's dev server keeps live, and its
 * matchups eventually all score. On the shared dev database this has now happened three times:
 * first `dev_user_04` alone crossed `veteranSeasonCutoff` (patched by updating this composition's
 * own expected label), then `dev_user_02` and `dev_user_03` crossed it too — because EVERY
 * shared-pool identity sits in `dev_league_snake`, every one of them was always going to cross
 * eventually. Patching the expected label a third time would only buy another few runs before a
 * fourth identity aged out from under it.
 *
 * The durable fix is the same idiom `ensureDraftScheduleLeague` (`e2e/global-setup.ts`) already
 * uses for the identical class of hazard: stop depending on a shared identity's history staying
 * put, and give this one demo exactly the identities it needs, under this module's own exclusive
 * control.
 *
 * TWO SEATS THAT CAN NEVER BECOME VETERANS. `TIER_DEMO_NEWCOMER_IDS` are placeholder users this
 * module creates and seats NOWHERE else — no other function in this directory ever lists one of
 * these ids in an `ownerIndices` array or a `teams` insert. With no league to ever complete a
 * season for them, `completedSeasonsFor` reads `0` for both, forever, regardless of how much
 * drift the shared 12-identity pool accumulates.
 *
 * ONE SEAT THAT IS ALREADY A VETERAN, BY CONSTRUCTION RATHER THAN DRIFT. `TIER_DEMO_VETERAN_ID`
 * sits team 1 of three separate small leagues (`TIER_DEMO_VETERAN_SEASON_LEAGUES`, below), each
 * seeded through the identical `seedSeasonLeague` path `DEV_SEED.season`/`VETERAN_SEASON_LEAGUES`
 * already use for manager A's own veteran status (`seed-season-league.ts`). Every week of every
 * one of the three is scored at BIRTH — the `finalizeWeek` loop inside `seedSeasonLeague` itself
 * — so there is no unscored matchup left for any later ticker or worker to find, and no reason
 * `stampSeasonCompleteInTx` would ever need to fire again after the seed step that creates them.
 * Three REAL completed seasons the moment `npm run seed` finishes, on a database that has never
 * run this seed before — not only on today's already-drifted one.
 *
 * The three fillers (`ownerIndices: [0, 1, 2, 3]`) reuse whichever shared-pool identities happen
 * to sit indices 1-3 at seed time — deliberately not disjoint the way `VETERAN_SEASON_LEAGUES`'s
 * own fillers are, because nothing here depends on THEIR completed-season count staying under any
 * threshold. They exist only so these three leagues have the minimum team count `writeSchedule`
 * needs; only index 0 (`TIER_DEMO_VETERAN_ID`, via `claimUserId`) is this module's own concern.
 */
export const TIER_DEMO_NEWCOMER_IDS: readonly [string, string] = ["dev_tier_demo_newcomer_01", "dev_tier_demo_newcomer_02"];
export const TIER_DEMO_VETERAN_ID = "dev_tier_demo_veteran";

const TIER_DEMO_VETERAN_SEASON_LEAGUES: readonly [SeasonLeagueConfig, SeasonLeagueConfig, SeasonLeagueConfig] = [
  { leagueId: "dev_league_tier_demo_veteran_1", draftId: "dev_draft_tier_demo_veteran_1", name: "Tier Demo Veteran League I", ownerIndices: [0, 1, 2, 3] },
  { leagueId: "dev_league_tier_demo_veteran_2", draftId: "dev_draft_tier_demo_veteran_2", name: "Tier Demo Veteran League II", ownerIndices: [0, 1, 2, 3] },
  { leagueId: "dev_league_tier_demo_veteran_3", draftId: "dev_draft_tier_demo_veteran_3", name: "Tier Demo Veteran League III", ownerIndices: [0, 1, 2, 3] },
];

export interface TierDemoIdentities {
  readonly newcomers: readonly [string, string];
  readonly veteran: string;
}

/**
 * Creates the three dedicated identities `dev_public_tier_demo` seats (`seed-public-leagues.ts`)
 * and, for the veteran alone, plays through the three real season leagues that put it over
 * `INTEGRITY_CONFIG.participation.veteranSeasonCutoff` by construction. Idempotent: the `users`
 * insert is `onConflictDoNothing`, and `seedSeasonLeague` is already idempotent in the row-count
 * sense (re-running upserts the identical rosters and scores rather than duplicating them).
 */
export async function seedTierDemoIdentities(db: Db, clock: Clock): Promise<TierDemoIdentities> {
  const ids = [...TIER_DEMO_NEWCOMER_IDS, TIER_DEMO_VETERAN_ID];
  await db
    .insert(users)
    .values(ids.map((id) => ({ id, email: `${id}@${DEV_SEED.emailDomain}`, displayName: `Dev Manager (${id})` })))
    .onConflictDoNothing({ target: users.id });

  for (const config of TIER_DEMO_VETERAN_SEASON_LEAGUES) {
    await seedSeasonLeague(db, clock, TIER_DEMO_VETERAN_ID, config);
  }

  return { newcomers: TIER_DEMO_NEWCOMER_IDS, veteran: TIER_DEMO_VETERAN_ID };
}
