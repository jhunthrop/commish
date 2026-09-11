import { and, asc, eq, ilike, notInArray, sql } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { excludedSetFor } from "@/db/upsert";
import { leagueWaivers, waiverClaims, injuredReserve, drafts, leagues, lineupSlots, players, rosterSlots, statWeeks, teams } from "@/db/schema";
import type { Position } from "@/domain/player";
import type { RosterSlotConfig } from "@/domain/roster";
import type { FreeAgentRow, PendingWaiverClaim } from "./claims-contract";
import { assignSlot } from "@/draft-engine";
import type { Clock } from "@/domain/timing";
import { defaultLineup, isLineupLocked } from "@/league";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { materializeLockedLineupsInTx, toFilledRosterSlots } from "./trade-transfer";

/**
 * Every reason a claim declines to act, named once — the `RELEASE_REFUSALS` discipline. These
 * are user-facing sentences; the route returns them verbatim.
 */
/** The market ceiling inside which a player cannot be dropped — ten rounds of a 12-team draft.
 *  Derived from ADP rather than an editorial list: self-updating, and self-explaining. Trades
 *  remain the route for moving a player this valuable. */
const UNDROPPABLE_ADP_CEILING = 120;

/** Waivers v1: re-exported spelling of the window length lives in ./waivers. */
import { WAIVER_PERIOD_HOURS } from "./waivers";
import { injuryDesignations } from "./injuries";

export const CLAIM_REFUSALS = {
  leagueMissing: "That league does not exist.",
  notMember: "You do not have a team in this league.",
  draftNotComplete: "Free agents open once the draft is complete. Every player is in the draft pool until then.",
  playerMissing: "That player does not exist.",
  notFree: "Another manager holds that player. If you want him, propose a trade.",
  dropNotYours: "You can only drop a player from your own roster.",
  undroppable: "He is too valuable to drop. Trade him instead.",
  alreadyFiled: "You already have a claim in for him. Waivers decide when the window closes.",
  rosterFull: "Your roster is full. Name a player to drop and the add and the drop happen together.",
  noRoom: "There is no legal slot for that player on your roster, even with the drop.",
} as const;

export interface FreeAgentsInput {
  readonly leagueId: string;
  /** Case-insensitive name fragment; empty means everyone. */
  readonly search?: string;
  readonly position?: Position | "ALL";
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * THE POOL, MINUS EVERY ROSTER IN THIS LEAGUE — the definition of a free agent, as one query.
 *
 * V1 IS FIRST-COME-FIRST-SERVED, deliberately (founder feature order, 2026-08-28): this product
 * is sit-and-go house leagues, and a waiver-priority system is a fairness design worth its own
 * pass — an order, a window, a tiebreak, and the disclosure copy for all three. Building it
 * badly inside a list endpoint would be worse than not having it; the claim transaction below is
 * where a waiver window would slot in, and nothing in this read would change.
 *
 * Ordered by ADP (the market's own board order), nulls last, name as the tiebreak — a free-agent
 * list is a shopping surface, and the market price is the one ranking this product can stand
 * behind today (law 7: our model's column arrives when the engine publishes for the live
 * season).
 */
export async function freeAgents(db: Db, input: FreeAgentsInput): Promise<{ readonly agents: readonly FreeAgentRow[]; readonly total: number }> {
  const limit = Math.min(input.limit ?? 50, 100);
  const offset = input.offset ?? 0;

  const rosteredInLeague = db
    .select({ playerId: rosterSlots.playerId })
    .from(rosterSlots)
    .innerJoin(teams, eq(rosterSlots.teamId, teams.id))
    .where(and(eq(teams.leagueId, input.leagueId), sql`${rosterSlots.playerId} is not null`));

  // An IR'd player has no roster_slots row but is still OWNED — without this second exclusion
  // the pool would offer him to the whole league the moment his manager parked him (roadmap
  // item 3, 2026-08-30).
  const onInjuredReserve = db
    .select({ playerId: injuredReserve.playerId })
    .from(injuredReserve)
    .innerJoin(teams, eq(injuredReserve.teamId, teams.id))
    .where(eq(teams.leagueId, input.leagueId));
  const conditions = [notInArray(players.id, rosteredInLeague), notInArray(players.id, onInjuredReserve)];
  if (input.search !== undefined && input.search.trim() !== "") conditions.push(ilike(players.name, `%${input.search.trim()}%`));
  if (input.position !== undefined && input.position !== "ALL") conditions.push(eq(players.position, input.position));

  const [rows, [count]] = await Promise.all([
    db
      .select({ id: players.id, name: players.name, position: players.position, nflTeam: players.nflTeam, headshotUrl: players.headshotUrl, adp: players.adp, posAdp: players.posAdp })
      .from(players)
      .where(and(...conditions))
      .orderBy(sql`${players.adp} asc nulls last`, asc(players.name))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(players).where(and(...conditions)),
  ]);
  // Waivers v1: the window rides each row so the board can say "on waivers, clears at X" and
  // wear Claim instead of Add. One indexed read for the league.
  const windows = await db
    .select({ playerId: leagueWaivers.playerId, until: leagueWaivers.until })
    .from(leagueWaivers)
    .where(eq(leagueWaivers.leagueId, input.leagueId));
  const untilByPlayer = new Map(windows.map((row) => [row.playerId, row.until.toISOString()]));
  // The tab loop (2026-08-30): the harvested designations ride every pool row — the one fact a
  // manager checks before a claim.
  const designations = await injuryDesignations(db);
  return {
    agents: rows.map((row) => ({ ...row, onWaiversUntil: untilByPlayer.get(row.id) ?? null, injuryDesignation: designations.get(row.id) ?? null })),
    total: count?.total ?? 0,
  };
}

/**
 * THE CALLER TEAM'S PENDING WAIVER CLAIMS, each with where it sits in line. `queuePosition`
 * ranks every pending claim on the same player by the EXACT order `processWaivers` awards in —
 * `teams.waiver_priority` ascending, then filed-at ascending — so "1" means "his to lose", and
 * anything higher names how many teams stand ahead. Telling a manager his true place is the
 * disclosure half of the waiver system: the award order is deterministic, so it can be shown
 * before it runs rather than discovered after.
 *
 * `clearsAt` reads the player's `league_waivers.until` row. A pending claim whose window row is
 * already gone (processing is lazy — the row dies on the touch that resolves the claims, so this
 * is a between-ticks read, not steady state) falls back to filed-at plus the standard
 * {@link WAIVER_PERIOD_HOURS} window rather than inventing a null. Two queries total, however
 * many claims the team has filed.
 */
export async function pendingWaiverClaims(db: Db, leagueId: string, teamId: string): Promise<readonly PendingWaiverClaim[]> {
  const mine = await db
    .select({
      claimId: waiverClaims.id,
      playerId: waiverClaims.addPlayerId,
      playerName: players.name,
      position: players.position,
      until: leagueWaivers.until,
      createdAt: waiverClaims.createdAt,
    })
    .from(waiverClaims)
    .innerJoin(players, eq(players.id, waiverClaims.addPlayerId))
    .leftJoin(leagueWaivers, and(eq(leagueWaivers.leagueId, waiverClaims.leagueId), eq(leagueWaivers.playerId, waiverClaims.addPlayerId)))
    .where(and(eq(waiverClaims.leagueId, leagueId), eq(waiverClaims.teamId, teamId), eq(waiverClaims.status, "pending")));
  if (mine.length === 0) return [];

  // Every pending claim in the league, in `processWaivers`' own award order; ranked per player
  // here. One query regardless of how many players the team has bid on.
  const queue = await db
    .select({ id: waiverClaims.id, playerId: waiverClaims.addPlayerId })
    .from(waiverClaims)
    .innerJoin(teams, eq(teams.id, waiverClaims.teamId))
    .where(and(eq(waiverClaims.leagueId, leagueId), eq(waiverClaims.status, "pending")))
    .orderBy(asc(teams.waiverPriority), asc(waiverClaims.createdAt));
  const rankByClaimId = new Map<string, number>();
  const bidsSeenForPlayer = new Map<string, number>();
  for (const bid of queue) {
    const rank = (bidsSeenForPlayer.get(bid.playerId) ?? 0) + 1;
    bidsSeenForPlayer.set(bid.playerId, rank);
    rankByClaimId.set(bid.id, rank);
  }

  return mine
    .map((row) => ({
      claimId: row.claimId,
      playerId: row.playerId,
      playerName: row.playerName,
      position: row.position,
      clearsAt: (row.until ?? new Date(row.createdAt.getTime() + WAIVER_PERIOD_HOURS * 3_600_000)).toISOString(),
      // Every row in `mine` is a pending claim in this league, so the full-league queue above
      // necessarily ranked it — asserted, not branch-guarded (the test-support convention: a
      // runtime check for a case the filters make impossible would be an uncoverable branch).
      queuePosition: rankByClaimId.get(row.claimId)!,
    }))
    .sort((a, b) => a.clearsAt.localeCompare(b.clearsAt) || a.playerName.localeCompare(b.playerName));
}

export interface ClaimInput {
  readonly leagueId: string;
  readonly userId: string;
  readonly addPlayerId: string;
  /** Required exactly when the roster is full; the add and the drop are one transaction. */
  readonly dropPlayerId?: string | null;
}

export interface ClaimDeps {
  readonly clock: Clock;
  readonly audit?: AuditLogger;
  /** Waivers v1 (roadmap item 4): the processor sets this when executing an AWARD — the
   *  on-waivers gate below must not re-file the very claim it is resolving. */
  readonly viaWaivers?: boolean;
}

export type ClaimResult =
  | { readonly ok: true; readonly added: string; readonly dropped: string | null }
  /** The add target was on waivers: the claim was FILED, not executed. `clearsAt` is when the
   *  window closes and the filed claims resolve by priority. */
  | { readonly ok: true; readonly waiverFiled: true; readonly clearsAt: string }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * ADD, WITH THE DROP IN THE SAME TRANSACTION — the claim flow the Free agents tab exists for.
 *
 * SERIALIZED PER (league, player) by a transaction-scoped advisory lock: two managers tapping
 * Add on the same free agent at the same moment queue behind one hash, and the loser gets
 * `notFree` in words rather than a player on two rosters. `roster_slots.player_id` carries no
 * unique index (the same missing brace `applyTradeInTx` documents), so the lock is load-bearing
 * and the post-write assertion is the belt to it.
 *
 * ORDER INSIDE THE TRANSACTION mirrors the trade transfer exactly, and for its reasons:
 * materialize locked lineups FIRST (a drop changes what `getLineup`'s fallback would say a
 * never-saved manager fielded in a settled week — freeze history before changing it), then read
 * the roster fresh, then place, then write the full slot set in one upsert, then null the
 * dropped player out of every UNLOCKED saved lineup (a saved week 15 lineup must not field a
 * player this team no longer owns; locked weeks keep him, honestly, because he really played).
 */
export async function claimPlayer(db: Db, input: ClaimInput, deps: ClaimDeps): Promise<ClaimResult> {
  const audit = deps.audit ?? getAuditLogger();
  const refuse = (status: number, reason: string): ClaimResult => ({ ok: false, status, reason });

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`claim:${input.leagueId}:${input.addPlayerId}`}))`);

    const [league] = await tx
      .select({ id: leagues.id, slotConfig: leagues.rosterSlots })
      .from(leagues)
      .where(eq(leagues.id, input.leagueId));
    if (league === undefined) return refuse(404, CLAIM_REFUSALS.leagueMissing);

    const [draft] = await tx.select({ status: drafts.status }).from(drafts).where(eq(drafts.leagueId, input.leagueId));
    if (draft?.status !== "complete") return refuse(409, CLAIM_REFUSALS.draftNotComplete);

    const [mine] = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.leagueId, input.leagueId), eq(teams.userId, input.userId)));
    if (mine === undefined) return refuse(403, CLAIM_REFUSALS.notMember);

    const [addPlayer] = await tx
      .select({ id: players.id, position: players.position, name: players.name })
      .from(players)
      .where(eq(players.id, input.addPlayerId));
    if (addPlayer === undefined) return refuse(404, CLAIM_REFUSALS.playerMissing);

    // Free means free IN THIS LEAGUE: one query over every roster the league holds.
    const [holder] = await tx
      .select({ teamId: rosterSlots.teamId })
      .from(rosterSlots)
      .innerJoin(teams, eq(rosterSlots.teamId, teams.id))
      .where(and(eq(teams.leagueId, input.leagueId), eq(rosterSlots.playerId, input.addPlayerId)));
    if (holder !== undefined) return refuse(409, CLAIM_REFUSALS.notFree);
    // Owned-but-parked counts as owned (roadmap item 3): an IR membership holds the player
    // exactly as hard as a roster row does.
    const [irHolder] = await tx
      .select({ teamId: injuredReserve.teamId })
      .from(injuredReserve)
      .innerJoin(teams, eq(injuredReserve.teamId, teams.id))
      .where(and(eq(teams.leagueId, input.leagueId), eq(injuredReserve.playerId, input.addPlayerId)));
    if (irHolder !== undefined) return refuse(409, CLAIM_REFUSALS.notFree);

    // WAIVERS v1 (roadmap item 4): a claim on a waivered player is FILED, never executed — the
    // window resolves by priority when it closes. The processor's own award re-enters here with
    // `viaWaivers` and passes straight through.
    if (deps.viaWaivers !== true) {
      const [windowRow] = await tx
        .select({ until: leagueWaivers.until })
        .from(leagueWaivers)
        .where(and(eq(leagueWaivers.leagueId, input.leagueId), eq(leagueWaivers.playerId, input.addPlayerId)));
      if (windowRow !== undefined && windowRow.until.getTime() > new Date(deps.clock.now()).getTime()) {
        const [alreadyFiled] = await tx
          .select({ id: waiverClaims.id })
          .from(waiverClaims)
          .innerJoin(teams, eq(teams.id, waiverClaims.teamId))
          .where(
            and(
              eq(waiverClaims.leagueId, input.leagueId),
              eq(waiverClaims.addPlayerId, input.addPlayerId),
              eq(waiverClaims.status, "pending"),
              eq(teams.userId, input.userId),
            ),
          );
        if (alreadyFiled !== undefined) return refuse(409, CLAIM_REFUSALS.alreadyFiled);
        const [mineTeam] = await tx
          .select({ id: teams.id })
          .from(teams)
          .where(and(eq(teams.leagueId, input.leagueId), eq(teams.userId, input.userId)));
        if (mineTeam === undefined) return refuse(403, CLAIM_REFUSALS.notMember);
        await tx.insert(waiverClaims).values({
          id: `wc_${crypto.randomUUID()}`,
          leagueId: input.leagueId,
          teamId: mineTeam.id,
          addPlayerId: input.addPlayerId,
          dropPlayerId: input.dropPlayerId ?? null,
        });
        return { ok: true, waiverFiled: true, clearsAt: windowRow.until.toISOString() } as const;
      }
    }

    const slotConfig: readonly RosterSlotConfig[] = league.slotConfig;

    const materialized = await materializeLockedLineupsInTx(tx, { leagueId: input.leagueId, teamIds: [mine.id, mine.id], slotConfig });

    const currentRows = await tx
      .select({ teamId: rosterSlots.teamId, slot: rosterSlots.slot, slotIndex: rosterSlots.slotIndex, playerId: rosterSlots.playerId })
      .from(rosterSlots)
      .where(eq(rosterSlots.teamId, mine.id));
    const current = toFilledRosterSlots(currentRows);

    const drop = input.dropPlayerId ?? null;
    if (drop !== null && !current.some((slot) => slot.playerId === drop)) return refuse(400, CLAIM_REFUSALS.dropNotYours);

    // UNDROPPABLES (roadmap item 3, the incumbent's "Observe Undroppable Players List"). Ours is
    // market-derived rather than editorial: a player the market drafts inside the ceiling is too
    // valuable to hit the wire — the collusion/rage-quit dump every platform guards against.
    // Trades remain the honest route for moving him.
    if (drop !== null) {
      const [dropRow] = await tx.select({ adp: players.adp }).from(players).where(eq(players.id, drop));
      if (dropRow?.adp !== null && dropRow !== undefined && dropRow.adp <= UNDROPPABLE_ADP_CEILING) {
        return refuse(409, CLAIM_REFUSALS.undroppable);
      }
    }

    const totalSlots = slotConfig.reduce((sum, slot) => sum + slot.count, 0);
    if (drop === null && current.length >= totalSlots) return refuse(409, CLAIM_REFUSALS.rosterFull);

    const cleared = drop === null ? current : current.filter((slot) => slot.playerId !== drop);
    const assignment = assignSlot({ position: addPlayer.position, roster: cleared, slotConfig });
    if (!assignment.ok) return refuse(409, CLAIM_REFUSALS.noRoom);

    const nextRoster = [...cleared, { slot: assignment.slot, slotIndex: assignment.slotIndex, playerId: addPlayer.id }];
    const writeRows = defaultLineup(slotConfig, nextRoster).map((slot) => ({
      teamId: mine.id,
      slot: slot.slot,
      slotIndex: slot.slotIndex,
      playerId: slot.playerId,
    }));
    await tx
      .insert(rosterSlots)
      .values(writeRows)
      .onConflictDoUpdate({ target: [rosterSlots.teamId, rosterSlots.slot, rosterSlots.slotIndex], set: excludedSetFor(rosterSlots, ["teamId", "slot", "slotIndex"]) });

    // The belt to the advisory lock's braces: the player must now be on exactly one roster here.
    const [countRow] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(rosterSlots)
      .innerJoin(teams, eq(rosterSlots.teamId, teams.id))
      .where(and(eq(teams.leagueId, input.leagueId), eq(rosterSlots.playerId, addPlayer.id)));
    if ((countRow?.n ?? 0) !== 1) throw new Error("claimPlayer: the added player is not on exactly one roster after the write.");

    if (drop !== null) {
      // Unlocked saved lineups must not field a player this team no longer owns. Locked weeks
      // were materialized above and keep him: he really played those weeks.
      const weekRows = await tx.select({ week: statWeeks.week, status: statWeeks.status }).from(statWeeks);
      const lockedWeeks = weekRows.filter((row) => isLineupLocked(row.status)).map((row) => row.week);
      await tx
        .update(lineupSlots)
        .set({ playerId: null })
        .where(
          and(
            eq(lineupSlots.teamId, mine.id),
            eq(lineupSlots.playerId, drop),
            lockedWeeks.length === 0 ? sql`true` : notInArray(lineupSlots.weekNumber, lockedWeeks),
          ),
        );
    }

    if (drop !== null) {
      // The dropped man enters his own waiver window: everyone gets a fair shot at him, by
      // priority, rather than the dropper's fastest friend.
      const until = new Date(new Date(deps.clock.now()).getTime() + WAIVER_PERIOD_HOURS * 3_600_000);
      await tx
        .insert(leagueWaivers)
        .values({ leagueId: input.leagueId, playerId: drop, until })
        .onConflictDoUpdate({ target: [leagueWaivers.leagueId, leagueWaivers.playerId], set: { until } });
    }

    await audit.record(tx, {
      eventType: "roster_move",
      actorId: input.userId,
      actorType: "user",
      leagueId: input.leagueId,
      // `reason`, not `outcome`: the key every `roster_move` renderer switches on
      // (`renderRosterMove`, `@/integrity/activity-view`) — a payload spelled differently is
      // silently invisible in the feed, by that module's own deny-by-default.
      payload: { reason: "claim", teamId: mine.id, addedPlayerId: addPlayer.id, droppedPlayerId: drop, materializedLineupRows: materialized, viaWaivers: deps.viaWaivers === true },
      occurredAt: deps.clock.now(),
    });

    return { ok: true, added: addPlayer.id, dropped: drop };
  });
}

/** Why a reversal declines, in the operator's own console. */
export const CLAIM_REVERSAL_REFUSALS = {
  notOnRoster:
    "The added player is not on that roster any more. He was dropped or traded since, so undoing this claim needs a different decision.",
  dropTaken:
    "The dropped player has been claimed by another team since. Restoring him would take him off their roster, so this needs a different decision.",
  noRoomBack: "There is no legal slot to restore the dropped player into.",
} as const;

export interface ReverseClaimInput {
  readonly leagueId: string;
  readonly teamId: string;
  readonly addedPlayerId: string;
  readonly droppedPlayerId: string | null;
  /** The claim's own audit event, carried as provenance on the compensating event. */
  readonly reversesEventId: string;
  readonly operatorUserId: string;
  readonly clock: Clock;
  readonly audit?: AuditLogger;
}

export type ReverseClaimResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * THE COMPENSATING CLAIM — `reverseTradeInTx`'s sibling, closing the one gap claims had against
 * the standard trade set: an operator can now undo one, audited, instead of doing it by hand.
 *
 * SELF-GUARDING WITHOUT A CLAIMS TABLE. A trade has a row to stamp `reversed_at` on; a claim
 * exists only as its audit event, and the guard is derived from state instead: the added player
 * must still be on that team (a second reversal, or a claim whose player was since dropped or
 * traded, refuses here — the PLAYER_MOVED_AGAIN discipline), and the dropped player must still
 * be free in the league. Both are the honest questions, and both answers change the moment the
 * reversal runs, which is what makes running it twice impossible rather than merely forbidden.
 *
 * Same transaction order as the claim itself, for the same reasons: advisory lock on the player
 * pair, materialize locked lineups first, place through `assignSlot`, one upsert, null the
 * removed player out of unlocked saved lineups, audit LAST (lock-order ruling 3).
 */
export async function reverseClaimInTx(tx: DbTx, input: ReverseClaimInput): Promise<ReverseClaimResult> {
  const audit = input.audit ?? getAuditLogger();
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`claim:${input.leagueId}:${input.addedPlayerId}`}))`);

  const [league] = await tx.select({ id: leagues.id, slotConfig: leagues.rosterSlots }).from(leagues).where(eq(leagues.id, input.leagueId));
  if (league === undefined) return { ok: false, reason: CLAIM_REFUSALS.leagueMissing };
  const slotConfig: readonly RosterSlotConfig[] = league.slotConfig;

  const currentRows = await tx
    .select({ teamId: rosterSlots.teamId, slot: rosterSlots.slot, slotIndex: rosterSlots.slotIndex, playerId: rosterSlots.playerId })
    .from(rosterSlots)
    .where(eq(rosterSlots.teamId, input.teamId));
  const current = toFilledRosterSlots(currentRows);
  if (!current.some((slot) => slot.playerId === input.addedPlayerId)) return { ok: false, reason: CLAIM_REVERSAL_REFUSALS.notOnRoster };

  let restored: { readonly slot: string; readonly slotIndex: number } | null = null;
  const cleared = current.filter((slot) => slot.playerId !== input.addedPlayerId);
  let nextRoster = cleared;
  if (input.droppedPlayerId !== null) {
    const [holder] = await tx
      .select({ teamId: rosterSlots.teamId })
      .from(rosterSlots)
      .innerJoin(teams, eq(rosterSlots.teamId, teams.id))
      .where(and(eq(teams.leagueId, input.leagueId), eq(rosterSlots.playerId, input.droppedPlayerId)));
    if (holder !== undefined) return { ok: false, reason: CLAIM_REVERSAL_REFUSALS.dropTaken };
    const [dropped] = await tx.select({ id: players.id, position: players.position }).from(players).where(eq(players.id, input.droppedPlayerId));
    if (dropped === undefined) return { ok: false, reason: CLAIM_REFUSALS.playerMissing };
    const assignment = assignSlot({ position: dropped.position, roster: cleared, slotConfig });
    if (!assignment.ok) return { ok: false, reason: CLAIM_REVERSAL_REFUSALS.noRoomBack };
    restored = { slot: assignment.slot, slotIndex: assignment.slotIndex };
    nextRoster = [...cleared, { slot: assignment.slot, slotIndex: assignment.slotIndex, playerId: dropped.id }];
  }

  await materializeLockedLineupsInTx(tx, { leagueId: input.leagueId, teamIds: [input.teamId, input.teamId], slotConfig });

  const writeRows = defaultLineup(slotConfig, nextRoster).map((slot) => ({
    teamId: input.teamId,
    slot: slot.slot,
    slotIndex: slot.slotIndex,
    playerId: slot.playerId,
  }));
  await tx
    .insert(rosterSlots)
    .values(writeRows)
    .onConflictDoUpdate({ target: [rosterSlots.teamId, rosterSlots.slot, rosterSlots.slotIndex], set: excludedSetFor(rosterSlots, ["teamId", "slot", "slotIndex"]) });

  // The removed player must not stay fielded in any UNLOCKED saved lineup.
  const weekRows = await tx.select({ week: statWeeks.week, status: statWeeks.status }).from(statWeeks);
  const lockedWeeks = weekRows.filter((row) => isLineupLocked(row.status)).map((row) => row.week);
  await tx
    .update(lineupSlots)
    .set({ playerId: null })
    .where(
      and(
        eq(lineupSlots.teamId, input.teamId),
        eq(lineupSlots.playerId, input.addedPlayerId),
        lockedWeeks.length === 0 ? sql`true` : notInArray(lineupSlots.weekNumber, lockedWeeks),
      ),
    );

  await audit.record(tx, {
    eventType: "roster_move",
    actorId: input.operatorUserId,
    // "user": the audit domain knows people and the system, and an operator is a person whose
    // authority the payload's own reason carries — the same shape reverseTradeInTx writes.
    actorType: "user",
    leagueId: input.leagueId,
    payload: {
      reason: "claim_reversed",
      teamId: input.teamId,
      removedPlayerId: input.addedPlayerId,
      restoredPlayerId: input.droppedPlayerId,
      restoredTo: restored,
      reversesEventId: input.reversesEventId,
    },
    occurredAt: input.clock.now(),
  });

  return { ok: true };
}

