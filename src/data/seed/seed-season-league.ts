import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, rosterSlots, scoringSettings, teams } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS, type RosterSlotType } from "@/domain/roster";
import { PPR_SCORING } from "@/domain/scoring";
import type { Clock } from "@/domain/timing";
import { assignSlot, snakeTeamForPick, totalRosterSlots } from "@/draft-engine";
import { rankedPlayers } from "@/draft-service/pool";
import { LEAGUE_CONFIG } from "@/league";
import { writeSchedule } from "@/league-service/schedule";
import { finalizeWeek } from "@/stats-pipeline/finalize";
import { excludedSetFor } from "@/db/upsert";
import { DEV_SEED } from "./config";
import { ensureDevUsers, preserveRealCommissioner, preserveRealTeamOwner } from "./dev-users";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The fields every season-league playthrough is keyed by — `DEV_SEED.season` is the first of
 *  them; `VETERAN_SEASON_LEAGUES` (below) names the other two Task 10 adds so ONE seeded
 *  identity can cross `INTEGRITY_CONFIG.participation.veteranSeasonCutoff` by finishing three
 *  real, separately-played seasons rather than one league counted three times. */
export interface SeasonLeagueConfig {
  readonly leagueId: string;
  readonly draftId: string;
  readonly name: string;
  /**
   * Which of `ensureDevUsers`' fixed 12-identity pool sit in this league's teams, index 0 first
   * (team 1, always the veteran-in-progress identity — `claimUserId` when one is given).
   * Defaults to every index (`DEV_SEED.season`'s own twelve-team shape, the original behavior
   * every existing caller and test relies on).
   *
   * THE TWO `VETERAN_SEASON_LEAGUES` ENTRIES MUST STAY DISJOINT PAST INDEX 0. `ensureDevUsers`
   * returns the IDENTICAL 12 ids in the IDENTICAL order for every league that calls it — a
   * second and third season league that both mapped team 2 to index 1 would hand `dev_user_02` a
   * THIRD completed season too, right alongside the one identity this step means to promote. Two
   * small, four-team leagues with mutually exclusive non-veteran slices (indices 1-3 and 4-6)
   * cap every OTHER dev placeholder at two completed seasons — safely below the cutoff (3) — so
   * `dev_public_rookie_snake`'s own seeded seats (indices 1-3, `seed-public-leagues.ts`) still
   * read `all_newcomers` on the browse page Task 10's own e2e walk checks.
   */
  readonly ownerIndices?: readonly number[];
}

const ALL_TWELVE_OWNER_INDICES = Array.from({ length: 12 }, (_, i) => i);

/**
 * Phase 3 Plan D, Task 10, Step 1. `completedSeasonsFor` (`@/league-service/participation`)
 * counts one row per TEAM in a season-completed LEAGUE — never a multiplier on one league — so
 * the only honest way to hand team 1's owner a THIRD completed season is a third league that
 * really plays through `finalizeWeekInTx` the same way `DEV_SEED.season` itself does (ruling 24:
 * `season_completed_at` may never come from anything but that transaction). Local constants,
 * not `DEV_SEED` fields: every OTHER seeder in this directory (`seed-trades.ts`,
 * `seed-integrity.ts`) already keys its own extra leagues this way rather than growing the
 * shared config for a single caller.
 *
 * FOUR teams each, not twelve: `ownerIndices`' own docblock explains why a smaller, disjoint
 * roster of non-veteran teammates is what keeps every OTHER dev placeholder below the cutoff.
 */
export const VETERAN_SEASON_LEAGUES: readonly [SeasonLeagueConfig, SeasonLeagueConfig] = [
  { leagueId: "dev_league_season_2", draftId: "dev_draft_season_2", name: "Dev Season League II", ownerIndices: [0, 1, 2, 3] },
  { leagueId: "dev_league_season_3", draftId: "dev_draft_season_3", name: "Dev Season League III", ownerIndices: [0, 4, 5, 6] },
];

/**
 * A league that has already played: twelve teams, complete legal rosters, a full generated
 * schedule and every week scored — so standings, matchup pages and the win/clinch moment all
 * have real data the first time a developer signs in.
 *
 * Rosters are dealt by walking a snake order over `rankedPlayers` and asking the ENGINE's own
 * `assignSlot` where each player fits. Hand-writing `roster_slots` would let this seed
 * produce a roster the draft engine considers illegal, which is the one thing a demo league
 * must never do. It deliberately does NOT replay a real draft through the store: this league
 * exists to be *browsed*, and a 180-pick action log would make `npm run seed` slow for no
 * gain. `dev_league_snake` / `dev_league_auction` remain the leagues you actually draft in.
 *
 * Idempotent in the row-count sense, like `seedDevLeagues`: re-running upserts rather than
 * duplicating, and re-scoring a week recomputes the same numbers.
 *
 * `leagueConfig` defaults to `DEV_SEED.season` (the original, single-league behavior every
 * existing caller and test relies on) — Task 10's `index.ts` calls this THREE times, once per
 * entry in `[DEV_SEED.season, ...VETERAN_SEASON_LEAGUES]`, passing the SAME `claimUserId` every
 * time so team 1's owner is identical across all three and really crosses the veteran cutoff.
 */
export async function seedSeasonLeague(
  db: Db,
  clock: Clock,
  claimUserId?: string,
  leagueConfig: SeasonLeagueConfig = DEV_SEED.season,
): Promise<{ teams: number; weeks: number; scoredWeeks: number }> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seedSeasonLeague creates placeholder users and must never run in production.");
  }

  const { leagueId, draftId, name } = leagueConfig;
  const ownerIndices = leagueConfig.ownerIndices ?? ALL_TWELVE_OWNER_INDICES;
  const allOwnerIds = await ensureDevUsers(db, claimUserId);
  const ownerIds = ownerIndices.map((index) => allOwnerIds[index]!);
  const teamIds = ownerIds.map((_, i) => `${leagueId}_team_${String(i + 1).padStart(2, "0")}`);

  await db
    .insert(leagues)
    .values({
      id: leagueId,
      name,
      format: "snake",
      teamCount: ownerIds.length,
      commissionerUserId: ownerIds[0]!,
      rosterSlots: [...STANDARD_ROSTER_SLOTS],
    })
    .onConflictDoUpdate({ target: leagues.id, set: { commissionerUserId: preserveRealCommissioner() } });

  await db.insert(scoringSettings).values({ leagueId, ...PPR_SCORING }).onConflictDoNothing({ target: scoringSettings.leagueId });

  await db
    .insert(teams)
    .values(teamIds.map((id, i) => ({ id, leagueId, userId: ownerIds[i]!, name: DEV_SEED.teamNames[i] ?? `Team ${i + 1}` })))
    .onConflictDoUpdate({ target: teams.id, set: { userId: preserveRealTeamOwner() } });

  // The draft already happened. Its kickoff sits in the past so nothing about this league
  // looks like it is waiting to start.
  await db
    .insert(drafts)
    .values({
      id: draftId,
      leagueId,
      format: "snake",
      status: "complete",
      kickoffAt: new Date(Date.parse(clock.now()) - MS_PER_DAY),
      auctionBudget: null,
    })
    .onConflictDoUpdate({ target: drafts.id, set: { status: sql`excluded.status` } });

  // Deal legal rosters: snake order, best available the engine will accept.
  const pool = await rankedPlayers(db, leagueId);
  const taken = new Set<string>();
  const rosters = new Map(teamIds.map((id) => [id, [] as { slot: RosterSlotType; slotIndex: number; playerId: string }[]]));
  const totalPicks = teamIds.length * totalRosterSlots(STANDARD_ROSTER_SLOTS);

  for (let pickNumber = 1; pickNumber <= totalPicks; pickNumber++) {
    const teamId = snakeTeamForPick(teamIds, pickNumber);
    const roster = rosters.get(teamId)!;
    const sizeBefore = roster.length;
    for (const player of pool) {
      if (taken.has(player.id)) continue;
      const assignment = assignSlot({ position: player.position, roster, slotConfig: STANDARD_ROSTER_SLOTS });
      if (!assignment.ok) continue;
      taken.add(player.id);
      roster.push({ slot: assignment.slot, slotIndex: assignment.slotIndex, playerId: player.id });
      break;
    }
    if (roster.length === sizeBefore) {
      throw new Error(`seedSeasonLeague: no eligible player left in the pool for pick ${pickNumber} (team ${teamId}) — seed the player pool before the season league.`);
    }
  }

  const slotRows = [...rosters.entries()].flatMap(([teamId, slots]) => slots.map((slot) => ({ teamId, ...slot })));
  await db
    .insert(rosterSlots)
    .values(slotRows)
    .onConflictDoUpdate({
      target: [rosterSlots.teamId, rosterSlots.slot, rosterSlots.slotIndex],
      set: excludedSetFor(rosterSlots, ["teamId", "slot", "slotIndex"]),
    });

  const schedule = await db.transaction((tx) => writeSchedule(tx, { leagueId, teamIds, weeks: LEAGUE_CONFIG.regularSeasonWeeks }));

  let scoredWeeks = 0;
  for (let week = 1; week <= LEAGUE_CONFIG.regularSeasonWeeks; week++) {
    const result = await finalizeWeek(db, leagueId, week);
    if (result.ok) scoredWeeks += 1;
  }

  return { teams: teamIds.length, weeks: schedule.weeks, scoredWeeks };
}
