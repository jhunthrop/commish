import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, rosterSlots, scoringSettings, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS, type RosterSlotType } from "@/domain/roster";
import { PPR_SCORING } from "@/domain/scoring";
import type { Clock } from "@/domain/timing";
import { assignSlot, snakeTeamForPick, totalRosterSlots } from "@/draft-engine";
import { rankedPlayers } from "@/draft-service/pool";
import { LEAGUE_CONFIG } from "@/league";
import { scoreWeek } from "@/league-service";
import { writeSchedule } from "@/league-service/schedule";
import { excludedSetFor } from "@/db/upsert";
import { DEV_SEED } from "./config";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
 */
export async function seedSeasonLeague(
  db: Db,
  clock: Clock,
  claimUserId?: string,
): Promise<{ teams: number; weeks: number; scoredWeeks: number }> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seedSeasonLeague creates placeholder users and must never run in production.");
  }

  const { leagueId, draftId, name } = DEV_SEED.season;
  const devUserIds = Array.from({ length: DEV_SEED.teamCount }, (_, i) => `${DEV_SEED.userIdPrefix}${String(i + 1).padStart(2, "0")}`);
  await db
    .insert(users)
    .values(devUserIds.map((id) => ({ id, email: `${id}@${DEV_SEED.emailDomain}`, displayName: `Dev Manager ${id.slice(-2)}` })))
    .onConflictDoNothing({ target: users.id });

  const ownerIds = devUserIds.map((id, index) => (index === 0 && claimUserId !== undefined ? claimUserId : id));
  const teamIds = ownerIds.map((_, i) => `${leagueId}_team_${String(i + 1).padStart(2, "0")}`);

  await db
    .insert(leagues)
    .values({
      id: leagueId,
      name,
      format: "snake",
      teamCount: DEV_SEED.teamCount,
      commissionerUserId: ownerIds[0]!,
      rosterSlots: [...STANDARD_ROSTER_SLOTS],
    })
    .onConflictDoUpdate({ target: leagues.id, set: { commissionerUserId: sql`excluded.commissioner_user_id` } });

  await db.insert(scoringSettings).values({ leagueId, ...PPR_SCORING }).onConflictDoNothing({ target: scoringSettings.leagueId });

  await db
    .insert(teams)
    .values(teamIds.map((id, i) => ({ id, leagueId, userId: ownerIds[i]!, name: DEV_SEED.teamNames[i] ?? `Team ${i + 1}` })))
    .onConflictDoUpdate({ target: teams.id, set: { userId: sql`excluded.user_id` } });

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
    const result = await scoreWeek(db, leagueId, week);
    if (result.ok) scoredWeeks += 1;
  }

  return { teams: teamIds.length, weeks: schedule.weeks, scoredWeeks };
}
