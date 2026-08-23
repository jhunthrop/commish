import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { draftActions, drafts, leagues, scoringSettings, sessionSignals, teams } from "@/db/schema";
import type { DraftAction } from "@/domain/draft";
import { STANDARD_ROSTER_SLOTS, type RosterSlot } from "@/domain/roster";
import { PPR_SCORING } from "@/domain/scoring";
import type { Clock } from "@/domain/timing";
import { assignSlot, DRAFT_CLOCK_SCHEDULE, DRAFT_SKIP_POLICY, replayDraft, snakeTeamForPick, type DraftConfig } from "@/draft-engine";
import { buildDraftPool, rankedPlayers } from "@/draft-service/pool";
import { defaultSweepDeps, sweepLeagueForMultiAccounts, type SweepResult } from "@/integrity-service/multi-account";
import { ensureDevUsers } from "./dev-users";

const LEAGUE_ID = "dev_league_integrity";
const DRAFT_ID = "dev_draft_integrity";
const TEAM_COUNT = 4;
const ROUNDS = 6;
/** Seconds between every consecutive pick in the log, whatever team is on the clock. A snake
 *  draft's pick order is structurally asymmetric (a team drafting 2nd waits less between its own
 *  turns than one drafting 1st), so no delay makes every team's OWN median gap identical — this
 *  value is chosen so `SUSPECT_A`/`SUSPECT_B` (draft positions 2 and 3, the two closest medians
 *  of the four) land inside `cadenceToleranceSeconds`, not so every team matches. */
const SECONDS_PER_PICK = 15;

/**
 * Two accounts, sharing one seeded league, sharing one client signature — so `npm run seed &&
 * npm run dev` puts a REAL flag in the operator queue, raised by the real detector
 * (`sweepLeagueForMultiAccounts`) from real rows, not a decorative one (ruling 29). Idempotent
 * the same row-count sense every other seeder here is: re-running upserts the league/teams and
 * skips the draft log if it is already there (mirroring `store.ts`'s own "already drafted, don't
 * re-apply" guard), then re-sweeps — a sweep is idempotent on the open-subject index regardless.
 */
export async function seedMultiAccountSuspect(db: Db, clock: Clock, claimUserId?: string): Promise<SweepResult> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seedMultiAccountSuspect creates placeholder users and must never run in production.");
  }

  const ownerIds = await ensureDevUsers(db, claimUserId);
  // Indices 8..11 — clear of index 0 (the `claimUserId` slot every other dev league hands the
  // founder), and reused deliberately: a dev user already fielding a team in the other seeded
  // leagues fielding one more here is exactly what a real member joining a second league looks
  // like, not a fixture collision.
  const teamOwners = [ownerIds[8]!, ownerIds[9]!, ownerIds[10]!, ownerIds[11]!];
  const teamIds = teamOwners.map((_, i) => `${LEAGUE_ID}_team_${i + 1}`);
  // Draft positions 2 and 3 (0-indexed 1 and 2): the two closest median pick-tempo positions in
  // a 4-team snake draft — see `SECONDS_PER_PICK`'s own docblock.
  const suspectA = teamOwners[1]!;
  const suspectB = teamOwners[2]!;

  await db
    .insert(leagues)
    .values({
      id: LEAGUE_ID,
      name: "Dev Integrity League",
      format: "snake",
      teamCount: TEAM_COUNT,
      commissionerUserId: teamOwners[0]!,
      rosterSlots: [...STANDARD_ROSTER_SLOTS],
    })
    .onConflictDoUpdate({ target: leagues.id, set: { commissionerUserId: teamOwners[0]! } });

  await db.insert(scoringSettings).values({ leagueId: LEAGUE_ID, ...PPR_SCORING }).onConflictDoNothing({ target: scoringSettings.leagueId });

  await db
    .insert(teams)
    .values(teamIds.map((id, i) => ({ id, leagueId: LEAGUE_ID, userId: teamOwners[i]!, name: `Integrity Suspects ${i + 1}` })))
    .onConflictDoNothing({ target: teams.id });

  const kickoffAt = new Date(Date.parse(clock.now()) - ROUNDS * TEAM_COUNT * SECONDS_PER_PICK * 1000);
  await db
    .insert(drafts)
    .values({ id: DRAFT_ID, leagueId: LEAGUE_ID, format: "snake", status: "in_progress", kickoffAt, auctionBudget: null })
    .onConflictDoNothing({ target: drafts.id });

  const existingActions = await db.select({ id: draftActions.draftId }).from(draftActions).where(eq(draftActions.draftId, DRAFT_ID)).limit(1);
  if (existingActions.length === 0) {
    await seedDraftLog(db, teamIds, clock);
  }

  // Direct inserts, like every other seeded row in this file: the same one client signature for
  // both suspects, never through `recordSessionSignals` (which needs `SESSION_SIGNAL_SALT` and a
  // real sign-in transaction neither this seed step has).
  await db
    .insert(sessionSignals)
    .values([
      { id: `${LEAGUE_ID}_signal_a`, userId: suspectA, occurredAt: new Date(clock.now()), userAgent: "IntegritySeed/1.0", acceptLanguage: "en-US", ipHash: null, ipSource: "xff_unverified" },
      { id: `${LEAGUE_ID}_signal_b`, userId: suspectB, occurredAt: new Date(clock.now()), userAgent: "IntegritySeed/1.0", acceptLanguage: "en-US", ipHash: null, ipSource: "xff_unverified" },
    ])
    .onConflictDoNothing({ target: sessionSignals.id });

  // The real detector, against the real rows this function just wrote — a real flag, not a
  // decorative one (ruling 29).
  return sweepLeagueForMultiAccounts(db, LEAGUE_ID, defaultSweepDeps());
}

/**
 * Builds a real, legally-replayable `MAKE_PICK` log for `ROUNDS` rounds — validated against the
 * ENGINE's own reducer (`replayDraft`) before a single row is written, so a mistake here fails
 * the seed loudly rather than leaving a draft room nothing can open later.
 */
async function seedDraftLog(db: Db, teamIds: readonly string[], clock: Clock): Promise<void> {
  const pool = await buildDraftPool(db, LEAGUE_ID);
  const rankedPool = await rankedPlayers(db, LEAGUE_ID);
  if (pool.length === 0) {
    throw new Error("seedMultiAccountSuspect: no players in the pool — seed players before the integrity league.");
  }

  const startAt = new Date(Date.parse(clock.now()) - ROUNDS * teamIds.length * SECONDS_PER_PICK * 1000);
  const start: DraftAction = { v: 1, type: "START_DRAFT", timestamp: startAt.toISOString(), draftOrder: teamIds, pool, minBid: 1, skipPolicy: DRAFT_SKIP_POLICY };

  const taken = new Set<string>();
  const rosters = new Map(teamIds.map((id) => [id, [] as RosterSlot[]]));
  const picks: DraftAction[] = [];
  const totalPicks = ROUNDS * teamIds.length;

  for (let pickNumber = 1; pickNumber <= totalPicks; pickNumber += 1) {
    const teamId = snakeTeamForPick(teamIds, pickNumber);
    const roster = rosters.get(teamId)!;
    let assigned: { playerId: string } | null = null;
    for (const player of rankedPool) {
      if (taken.has(player.id)) continue;
      const assignment = assignSlot({ position: player.position, roster, slotConfig: STANDARD_ROSTER_SLOTS });
      if (!assignment.ok) continue;
      taken.add(player.id);
      roster.push({ slot: assignment.slot, slotIndex: assignment.slotIndex, playerId: player.id });
      assigned = { playerId: player.id };
      break;
    }
    if (assigned === null) {
      throw new Error(`seedMultiAccountSuspect: no eligible player left in the pool for pick ${pickNumber} (team ${teamId}).`);
    }
    const timestamp = new Date(startAt.getTime() + pickNumber * SECONDS_PER_PICK * 1000);
    picks.push({ v: 1, type: "MAKE_PICK", timestamp: timestamp.toISOString(), teamId, playerId: assigned.playerId });
  }

  const config: DraftConfig = {
    draftId: DRAFT_ID,
    leagueId: LEAGUE_ID,
    format: "snake",
    kickoffAt: startAt.toISOString(),
    auctionBudget: null,
    slotConfig: STANDARD_ROSTER_SLOTS,
    clockSchedule: DRAFT_CLOCK_SCHEDULE,
  };
  // Fails loudly (DraftReplayError) rather than writing a log nothing could ever replay.
  replayDraft(config, [start, ...picks]);

  const actions = [start, ...picks];
  await db.insert(draftActions).values(actions.map((action, i) => ({ draftId: DRAFT_ID, sequence: i + 1, action, timestamp: new Date(action.timestamp) })));
}
