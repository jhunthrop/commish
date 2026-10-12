import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@research/db/client";
import { players, statWeeks } from "@research/db/schema";
import { injuredReserve, leagues, lineupSlots, rosterSlots, teams } from "@/db/schema";
import type { Clock } from "@research/domain/timing";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { isLineupLocked } from "@/league";
import { assignSlot } from "@/draft-engine";
import { notInArray } from "drizzle-orm";
import { IR_ELIGIBLE_DESIGNATIONS, injuryDesignations } from "@research/reference/injuries";
import { toFilledRosterSlots } from "./trade-transfer";

/** One IR spot per team — the incumbent default this engine matches (roadmap item 3). */
export const INJURED_RESERVE_SLOTS = 1;

export const IR_REFUSALS = {
  notYourTeam: "You do not have a team in this league.",
  notOnRoster: "That player is not on your roster.",
  notEligible: "He is not out. Injured reserve is for players ruled out, on IR, or suspended.",
  irFull: "Your injured reserve spot is taken. Activate that player first.",
  notOnIr: "That player is not on your injured reserve.",
  noRoom: "Your roster is full. Drop someone before activating him.",
} as const;

export type IrResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: number; readonly reason: string };

interface IrInput {
  readonly leagueId: string;
  readonly userId: string;
  readonly playerId: string;
}

interface IrDeps {
  readonly audit?: AuditLogger;
  readonly clock?: Clock;
}

function refuse(status: number, reason: string): IrResult {
  return { ok: false, status, reason };
}

/**
 * PLACE ON INJURED RESERVE (roadmap item 3, 2026-08-30). Deletes his `roster_slots` row —
 * which is what frees real roster capacity for a claim — and records membership in
 * `injured_reserve`, with his designation at placement. Only a player the injuries feed
 * currently rules out (`IR_ELIGIBLE_DESIGNATIONS`) qualifies; "Q" never does, because parking a
 * probable player is the stash exploit the rule exists to stop.
 *
 * Unlocked saved lineups drop him the same way a claim's drop does: locked weeks keep him
 * because he really played (or sat) those weeks; open weeks must not field a man who is not on
 * the active roster.
 */
export async function placeOnInjuredReserve(db: Db, input: IrInput, deps: IrDeps = {}): Promise<IrResult> {
  const audit = deps.audit ?? getAuditLogger();
  const clock = deps.clock ?? { now: () => new Date().toISOString() };
  const [mine] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.leagueId, input.leagueId), eq(teams.userId, input.userId)));
  if (mine === undefined) return refuse(403, IR_REFUSALS.notYourTeam);

  const designation = (await injuryDesignations(db)).get(input.playerId);
  if (designation === undefined || !IR_ELIGIBLE_DESIGNATIONS.has(designation)) {
    return refuse(409, IR_REFUSALS.notEligible);
  }

  return db.transaction(async (tx) => {
    const [slotRow] = await tx
      .select({ slot: rosterSlots.slot, slotIndex: rosterSlots.slotIndex })
      .from(rosterSlots)
      .where(and(eq(rosterSlots.teamId, mine.id), eq(rosterSlots.playerId, input.playerId)));
    if (slotRow === undefined) return refuse(400, IR_REFUSALS.notOnRoster);

    const [irCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(injuredReserve)
      .where(eq(injuredReserve.teamId, mine.id));
    if ((irCount?.n ?? 0) >= INJURED_RESERVE_SLOTS) return refuse(409, IR_REFUSALS.irFull);

    await tx.delete(rosterSlots).where(and(eq(rosterSlots.teamId, mine.id), eq(rosterSlots.playerId, input.playerId)));
    await tx.insert(injuredReserve).values({ teamId: mine.id, playerId: input.playerId, designationAtPlacement: designation });

    const weekRows = await tx.select({ week: statWeeks.week, status: statWeeks.status }).from(statWeeks);
    const lockedWeeks = weekRows.filter((row) => isLineupLocked(row.status)).map((row) => row.week);
    await tx
      .update(lineupSlots)
      .set({ playerId: null })
      .where(
        and(
          eq(lineupSlots.teamId, mine.id),
          eq(lineupSlots.playerId, input.playerId),
          lockedWeeks.length === 0 ? sql`true` : notInArray(lineupSlots.weekNumber, lockedWeeks),
        ),
      );

    await audit.record(tx, {
      eventType: "roster_move",
      actorId: input.userId,
      actorType: "user",
      leagueId: input.leagueId,
      payload: { reason: "ir_placed", teamId: mine.id, playerId: input.playerId, designation },
      occurredAt: clock.now(),
    });
    return { ok: true } as const;
  });
}

/**
 * ACTIVATE FROM INJURED RESERVE: back onto the roster through the same `assignSlot` authority a
 * claim uses, refusing when the roster is full — dropping someone first is the manager's call,
 * never this function's.
 */
export async function activateFromInjuredReserve(db: Db, input: IrInput, deps: IrDeps = {}): Promise<IrResult> {
  const audit = deps.audit ?? getAuditLogger();
  const clock = deps.clock ?? { now: () => new Date().toISOString() };
  const [mine] = await db
    .select({ id: teams.id, leagueId: teams.leagueId })
    .from(teams)
    .where(and(eq(teams.leagueId, input.leagueId), eq(teams.userId, input.userId)));
  if (mine === undefined) return refuse(403, IR_REFUSALS.notYourTeam);

  const [league] = await db.select({ rosterSlots: leagues.rosterSlots }).from(leagues).where(eq(leagues.id, input.leagueId));
  if (league === undefined) return refuse(404, "That league does not exist.");

  return db.transaction(async (tx) => {
    const [membership] = await tx
      .select({ playerId: injuredReserve.playerId })
      .from(injuredReserve)
      .where(and(eq(injuredReserve.teamId, mine.id), eq(injuredReserve.playerId, input.playerId)));
    if (membership === undefined) return refuse(400, IR_REFUSALS.notOnIr);

    const currentRows = await tx
      .select({ teamId: rosterSlots.teamId, slot: rosterSlots.slot, slotIndex: rosterSlots.slotIndex, playerId: rosterSlots.playerId })
      .from(rosterSlots)
      .where(eq(rosterSlots.teamId, mine.id));
    const current = toFilledRosterSlots(currentRows);
    const totalSlots = league.rosterSlots.reduce((sum, slot) => sum + slot.count, 0);
    if (current.length >= totalSlots) return refuse(409, IR_REFUSALS.noRoom);

    const [playerRow] = await tx.select({ position: players.position }).from(players).where(eq(players.id, input.playerId));
    if (playerRow === undefined) return refuse(404, "No such player.");
    const assignment = assignSlot({ position: playerRow.position, roster: current, slotConfig: league.rosterSlots });
    if (!assignment.ok) return refuse(409, IR_REFUSALS.noRoom);

    await tx.delete(injuredReserve).where(and(eq(injuredReserve.teamId, mine.id), eq(injuredReserve.playerId, input.playerId)));
    await tx
      .insert(rosterSlots)
      .values({ teamId: mine.id, slot: assignment.slot, slotIndex: assignment.slotIndex, playerId: input.playerId })
      .onConflictDoUpdate({ target: [rosterSlots.teamId, rosterSlots.slot, rosterSlots.slotIndex], set: { playerId: input.playerId } });

    await audit.record(tx, {
      eventType: "roster_move",
      actorId: input.userId,
      actorType: "user",
      leagueId: input.leagueId,
      payload: { reason: "ir_activated", teamId: mine.id, playerId: input.playerId },
      occurredAt: clock.now(),
    });
    return { ok: true } as const;
  });
}
