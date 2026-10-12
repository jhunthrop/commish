import { and, eq, inArray } from "drizzle-orm";
import type { DbTx } from "@research-ts/db/client";
import { excludedSetFor } from "@research-ts/db/upsert";
import { players, statWeeks } from "@research-ts/db/schema";
import { lineupSlots, rosterSlots } from "@/db/schema";
import type { Position } from "@research-ts/domain/player";
import type { RosterSlot, RosterSlotConfig, RosterSlotType } from "@research-ts/domain/roster";
import { assignSlot } from "@/draft-engine";
import { defaultLineup, isLineupLocked, LEAGUE_CONFIG } from "@/league";
import { assetPlayerIds, type TradeAsset } from "@/trades/assets";
import { getLineup } from "./lineups";

/** A roster entry a transfer actually ever moves: always filled — an empty slot has no player
 *  to clear or place. */
export interface FilledRosterSlot {
  readonly slot: RosterSlotType;
  readonly slotIndex: number;
  readonly playerId: string;
}

/** One player moving in one direction, with the position `assignSlot` needs to place it. */
export interface TransferAsset {
  readonly playerId: string;
  readonly position: Position;
}

/** One team's current roster, as `plannedTransfer` reads it — real rows from `roster_slots`, or
 *  a hand-built fixture in a pure test. Either way, filled entries only. */
export interface TransferSideInput {
  readonly teamId: string;
  readonly roster: readonly FilledRosterSlot[];
}

export interface PlannedTransferInput {
  readonly slotConfig: readonly RosterSlotConfig[];
  readonly proposer: TransferSideInput;
  readonly counterparty: TransferSideInput;
  /** Leaves the proposer's roster, arrives on the counterparty's. */
  readonly give: readonly TransferAsset[];
  /** Leaves the counterparty's roster, arrives on the proposer's. */
  readonly get: readonly TransferAsset[];
}

/** One team's roster once the trade lands: every slot the league configures, filled or empty —
 *  `defaultLineup`'s own shape, ready to write to `roster_slots` verbatim. */
export interface TransferSidePlan {
  readonly teamId: string;
  readonly roster: readonly RosterSlot[];
}

export interface TransferPlan {
  readonly ok: true;
  readonly proposer: TransferSidePlan;
  readonly counterparty: TransferSidePlan;
}

export interface TransferRefusal {
  readonly ok: false;
  readonly reason: string;
}

const POSITION_LABELS: Readonly<Record<Position, string>> = {
  QB: "quarterback",
  RB: "running back",
  WR: "wide receiver",
  TE: "tight end",
  K: "kicker",
  DEF: "defense",
};

/**
 * Closed-form, not computed: every real trade is bounded by `TRADE_CONFIG.maxAssetsPerSide`
 * (5, `@/trades/config`), so a refusal never needs a count past what is written here. This list
 * intentionally reaches a little past that bound rather than exactly meeting it.
 */
const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven"] as const;

/**
 * The refusal a failed placement earns: which position, how many of it, named in English rather
 * than in terms of `assignSlot`'s own slot machinery. `count` is every asset in the incoming
 * list sharing the position that failed to place — not just the one `assignSlot` choked on —
 * because "two quarterbacks" is the honest description of why a one-QB league refuses this
 * package, and "a quarterback" (singular) would understate a two-QB offer down to one.
 */
function describeUnplaceable(position: Position, count: number): string {
  const label = POSITION_LABELS[position];
  const subject = count === 1 ? `a ${label}` : `${COUNT_WORDS[count]} ${label}s`;
  return `There is no room on your roster for ${subject}. Send a player at that position, or free up a bench spot first.`;
}

type PlacementResult = { readonly ok: true; readonly roster: readonly FilledRosterSlot[] } | TransferRefusal;

/**
 * Places every incoming asset onto an already-cleared roster, growing it one player at a time —
 * the exact loop `checkRoom` (Task 3's stopgap, `src/league-service/trades.ts`) used, now the
 * one copy. Reuses `assignSlot` (`@/draft-engine`), never a second eligibility policy.
 */
function placeAll(startingRoster: readonly FilledRosterSlot[], incoming: readonly TransferAsset[], slotConfig: readonly RosterSlotConfig[]): PlacementResult {
  let roster = startingRoster;
  for (const asset of incoming) {
    const assignment = assignSlot({ position: asset.position, roster, slotConfig });
    if (!assignment.ok) {
      const sharingPosition = incoming.filter((candidate) => candidate.position === asset.position).length;
      return { ok: false, reason: describeUnplaceable(asset.position, sharingPosition) };
    }
    roster = [...roster, { slot: assignment.slot, slotIndex: assignment.slotIndex, playerId: asset.playerId }];
  }
  return { ok: true, roster };
}

/**
 * Where every moving player lands, or why the trade cannot happen. PURE: it takes both rosters
 * and both asset lists and returns a plan or a refusal, with no database in it, so the propose
 * route can preview the same answer the accept transaction will enforce (Task 3's `checkRoom`
 * is gone — this is the one implementation now).
 *
 * BOTH SIDES ARE CLEARED BEFORE EITHER IS FILLED: `clearedProposer`/`clearedCounterparty` are
 * both computed up front, before either placement runs. A swap of two quarterbacks in a one-QB
 * league is legal and would be refused by any implementation that placed before it cleared — the
 * incoming QB has no home until the outgoing one leaves. Clearing first is also what makes the
 * plan order-independent: the answer does not depend on which side the caller calls "proposer".
 *
 * Placement reuses `assignSlot` (`@research-ts/draft-engine/slotting`), which already composes
 * `eligibleSlotsForPosition` and `validateRosterAdd` and already prefers a starting slot over
 * FLEX over the bench. A second placement policy here would be a second set of eligibility
 * rules, and the spec says twice to reuse them rather than restate them.
 *
 * The PROPOSER's placement is attempted first, then the COUNTERPARTY's — an implementation
 * detail only when both would fail: whichever refusal is found first is the one returned.
 */
export function plannedTransfer(input: PlannedTransferInput): TransferPlan | TransferRefusal {
  const givingIds = new Set(input.give.map((asset) => asset.playerId));
  const gettingIds = new Set(input.get.map((asset) => asset.playerId));
  const clearedProposer = input.proposer.roster.filter((slot) => !givingIds.has(slot.playerId));
  const clearedCounterparty = input.counterparty.roster.filter((slot) => !gettingIds.has(slot.playerId));

  const proposerPlacement = placeAll(clearedProposer, input.get, input.slotConfig);
  if (!proposerPlacement.ok) return proposerPlacement;
  const counterpartyPlacement = placeAll(clearedCounterparty, input.give, input.slotConfig);
  if (!counterpartyPlacement.ok) return counterpartyPlacement;

  return {
    ok: true,
    proposer: { teamId: input.proposer.teamId, roster: defaultLineup(input.slotConfig, proposerPlacement.roster) },
    counterparty: { teamId: input.counterparty.teamId, roster: defaultLineup(input.slotConfig, counterpartyPlacement.roster) },
  };
}

export interface MaterializeInput {
  readonly leagueId: string;
  /** Both teams a trade moves players between. */
  readonly teamIds: readonly [string, string];
  readonly slotConfig: readonly RosterSlotConfig[];
}

interface LineupSlotWrite {
  readonly teamId: string;
  readonly weekNumber: number;
  readonly slot: RosterSlotType;
  readonly slotIndex: number;
  readonly playerId: string | null;
}

/**
 * Freeze what each team ACTUALLY fielded in every week that has already locked, for any week
 * where they never saved a lineup and `getLineup` would fall back to the roster.
 *
 * WHY THIS EXISTS. `getLineup` (`@/league-service/lineups`) returns saved `lineup_slots` rows
 * when they exist and derives from `roster_slots` when they do not — a deliberate rule so a
 * manager who never opens the editor still fields a legal team. `finalizeWeek` scores through
 * `getLineup`, and `correctSettledWeek` (Plan B) re-scores a settled week through it weeks
 * later. Moving a player between rosters therefore changes what a manager is RECORDED as having
 * started in every already-played week they never saved, and the change surfaces only when
 * somebody re-settles an old week and gets a different answer.
 *
 * So: every trade materializes first and moves second. The rows written are exactly the rows
 * `getLineup` would have returned a moment earlier, which is what makes this a freeze rather
 * than a decision — nothing here chooses a lineup, it only writes down the one that was already
 * in effect.
 *
 * Which weeks count as locked is read once, in one query — `isLineupLocked(status)` over the
 * `stat_weeks` rows for the whole season, with an absent row reading `"scheduled"` (open), the
 * same rule `setLineup` uses. There is no second definition of "locked" in this codebase.
 *
 * `FOR SHARE`, matching `setLineup`'s own re-check lock exactly (`@/league-service/lineups`,
 * `setLineup`'s in-transaction week read): `persistTick` (`@/stats-pipeline/persist`) upserts
 * `stat_weeks` in its own transaction with no coordination, under the default READ COMMITTED
 * isolation `setLineup`'s docblock already documents the hole for. Without this lock, a boundary
 * week could flip `scheduled` -> `in_progress` in a `persistTick` transaction that commits AFTER
 * this read but BEFORE this transaction's roster write — this read would see the stale
 * `scheduled` value, leave the week to the fallback, and the roster move that follows would then
 * retroactively change what that week's `getLineup` fallback derives, for a week that had, by the
 * time this transaction committed, already started. `FOR SHARE` blocks this read against
 * `persistTick`'s uncommitted row and forces it to see whichever value actually wins the race,
 * never a snapshot that predates it. Taken FIRST, ahead of every other read in this function and
 * in `applyTradeInTx` (which calls this first, ahead of its own roster reads) — a business lock,
 * before the transaction has taken anything else, matching `setLineup`'s own position and ruling
 * 3's "business rows first" order.
 *
 * Bounded by construction: at most `LEAGUE_CONFIG.regularSeasonWeeks` weeks times two teams
 * times the league's slot count, one INSERT, and only for weeks with no saved rows at all.
 */
export async function materializeLockedLineupsInTx(tx: DbTx, input: MaterializeInput): Promise<number> {
  const weekNumbers = Array.from({ length: LEAGUE_CONFIG.regularSeasonWeeks }, (_, index) => index + 1);
  const statRows = await tx
    .select({ week: statWeeks.week, status: statWeeks.status })
    .from(statWeeks)
    .where(inArray(statWeeks.week, weekNumbers))
    .for("share");
  const statusByWeek = new Map(statRows.map((row) => [row.week, row.status]));
  const lockedWeeks = weekNumbers.filter((week) => isLineupLocked(statusByWeek.get(week) ?? "scheduled"));

  const writes: LineupSlotWrite[] = [];
  for (const weekNumber of lockedWeeks) {
    for (const teamId of input.teamIds) {
      const saved = await tx
        .select({ teamId: lineupSlots.teamId })
        .from(lineupSlots)
        .where(and(eq(lineupSlots.teamId, teamId), eq(lineupSlots.weekNumber, weekNumber)))
        .limit(1);
      if (saved.length > 0) continue; // a real save is already immune — never re-derived.

      const derived = await getLineup(tx, { teamId, weekNumber, slotConfig: input.slotConfig });
      writes.push(...derived.map((slot) => ({ teamId, weekNumber, slot: slot.slot, slotIndex: slot.slotIndex, playerId: slot.playerId })));
    }
  }

  if (writes.length > 0) {
    await tx.insert(lineupSlots).values(writes).onConflictDoNothing();
  }
  return writes.length;
}

/**
 * The FIRST function in this product to move a player between two teams, and the second ever to
 * write `roster_slots` at all (`commitDraftState`, `@/draft-service/commit`, is the first, and it
 * writes one draft's rosters at once rather than moving anything).
 *
 * Thrown, never returned: `applyTradeInTx` runs inside the caller's own transaction (Task 5's
 * `acceptTrade`, or a test's own `db.transaction`), and the only way to force that transaction to
 * roll back from inside a callback is to reject the promise — the same discipline
 * `ContentRemovalRefused` (`@/integrity-service/flags`) uses for `resolveFlag`'s own removal step.
 */
export class TransferRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
  }
}

export interface ApplyTradeInput {
  readonly leagueId: string;
  readonly slotConfig: readonly RosterSlotConfig[];
  readonly proposerTeamId: string;
  readonly counterpartyTeamId: string;
  /** Leaves the proposer, arrives on the counterparty. */
  readonly proposerAssets: readonly TradeAsset[];
  /** Leaves the counterparty, arrives on the proposer. */
  readonly counterpartyAssets: readonly TradeAsset[];
}

export interface TransferResult {
  readonly proposer: TransferSidePlan;
  readonly counterparty: TransferSidePlan;
  /** How many `lineup_slots` rows `materializeLockedLineupsInTx` wrote before this trade moved
   *  anything — 0 when every locked week either had no lineup to freeze yet or was already saved. */
  readonly materializedLineupRows: number;
}

export function toFilledRosterSlots(rows: readonly { readonly slot: string; readonly slotIndex: number; readonly playerId: string | null }[]): readonly FilledRosterSlot[] {
  return rows.flatMap((row) => (row.playerId === null ? [] : [{ slot: row.slot as RosterSlotType, slotIndex: row.slotIndex, playerId: row.playerId }]));
}

/**
 * EXPORTED for one narrow test and nothing else — the same discipline `refusalFor`
 * (`@/league-service/trades`) uses for its own unreachable-through-correct-code backstop.
 * `roster_slots.player_id` carries no unique index and no foreign key (the brief's own reason
 * this function exists at all), so nothing at the database level would catch two rows naming the
 * same player. `plannedTransfer`'s own clear-before-place logic makes this unreachable through
 * `applyTradeInTx` when the input is honest; this is the belt to that missing brace, proved
 * directly rather than through a contrived database state.
 */
export function assertNoPlayerOnTwoRosters(rows: readonly { readonly playerId: string | null }[]): void {
  const owned = rows.map((row) => row.playerId).filter((id): id is string => id !== null);
  if (new Set(owned).size !== owned.length) {
    throw new Error("applyTradeInTx: a player landed on two rosters after the write — the assertion this transaction exists to make.");
  }
}

/**
 * Move every asset, both directions, in the caller's transaction.
 *
 * Takes a `DbTx`, never a `Db`: a trade that half-committed would leave a player on two rosters
 * or on none, and `roster_slots.player_id` carries no unique index and no foreign key, so
 * nothing in the database would notice. `assertNoPlayerOnTwoRosters` below is the belt to that
 * missing brace.
 *
 * ORDER INSIDE THE TRANSACTION: materialize locked lineups, then read the current rosters fresh
 * (never trusted from propose time — rosters move in between), then plan the transfer, then
 * write both sides in one upsert, then assert. Materialization runs FIRST because it must record
 * the roster as it was before this trade changes it.
 *
 * "Clear both sides before either is filled" is not two separate database steps here: the plan's
 * own roster for each team (`defaultLineup`'s shape — every configured slot, filled or empty) is
 * written verbatim with the SAME `onConflictDoUpdate` idiom `commitDraftState` uses, so a slot
 * that lost its occupant and gained no replacement is overwritten to `playerId: null` in the same
 * statement that fills every other slot — one atomic write per team, not a delete followed by an
 * insert.
 */
export async function applyTradeInTx(tx: DbTx, input: ApplyTradeInput): Promise<TransferResult> {
  const materializedLineupRows = await materializeLockedLineupsInTx(tx, {
    leagueId: input.leagueId,
    teamIds: [input.proposerTeamId, input.counterpartyTeamId],
    slotConfig: input.slotConfig,
  });

  const currentRows = await tx
    .select({ teamId: rosterSlots.teamId, slot: rosterSlots.slot, slotIndex: rosterSlots.slotIndex, playerId: rosterSlots.playerId })
    .from(rosterSlots)
    .where(inArray(rosterSlots.teamId, [input.proposerTeamId, input.counterpartyTeamId]));
  const proposerCurrent = toFilledRosterSlots(currentRows.filter((row) => row.teamId === input.proposerTeamId));
  const counterpartyCurrent = toFilledRosterSlots(currentRows.filter((row) => row.teamId === input.counterpartyTeamId));

  const giveIds = assetPlayerIds(input.proposerAssets);
  const getIds = assetPlayerIds(input.counterpartyAssets);

  // Ownership re-checked HERE, against the roster this transaction just read, not against
  // whatever was true when the trade was proposed — a player either side no longer owns (traded
  // away, or dropped, in between) refuses the whole transfer rather than materializing a
  // duplicate or an orphan.
  const proposerOwned = new Set(proposerCurrent.map((slot) => slot.playerId));
  const counterpartyOwned = new Set(counterpartyCurrent.map((slot) => slot.playerId));
  if (!giveIds.every((id) => proposerOwned.has(id)) || !getIds.every((id) => counterpartyOwned.has(id))) {
    throw new TransferRefusedError("One of those players is not on that roster any more.");
  }

  const movingIds = [...giveIds, ...getIds];
  const positionRows = movingIds.length === 0 ? [] : await tx.select({ id: players.id, position: players.position }).from(players).where(inArray(players.id, movingIds));
  const positionById = new Map(positionRows.map((row) => [row.id, row.position]));
  // FK-guaranteed: every id above was just confirmed present on a `roster_slots` row, and every
  // such row was written from a real `players.id` (a draft, or this same function) — the same
  // "impossible through Postgres" discipline `mine!`/`league!` use elsewhere in this file's
  // sibling `trades.ts`.
  const toAsset = (id: string): TransferAsset => ({ playerId: id, position: positionById.get(id)! });

  const plan = plannedTransfer({
    slotConfig: input.slotConfig,
    proposer: { teamId: input.proposerTeamId, roster: proposerCurrent },
    counterparty: { teamId: input.counterpartyTeamId, roster: counterpartyCurrent },
    give: giveIds.map(toAsset),
    get: getIds.map(toAsset),
  });
  if (!plan.ok) throw new TransferRefusedError(plan.reason);

  const writeRows = [
    ...plan.proposer.roster.map((slot) => ({ teamId: plan.proposer.teamId, slot: slot.slot, slotIndex: slot.slotIndex, playerId: slot.playerId })),
    ...plan.counterparty.roster.map((slot) => ({ teamId: plan.counterparty.teamId, slot: slot.slot, slotIndex: slot.slotIndex, playerId: slot.playerId })),
  ];
  await tx
    .insert(rosterSlots)
    .values(writeRows)
    .onConflictDoUpdate({
      target: [rosterSlots.teamId, rosterSlots.slot, rosterSlots.slotIndex],
      set: excludedSetFor(rosterSlots, ["teamId", "slot", "slotIndex"]),
    });

  const after = await tx
    .select({ playerId: rosterSlots.playerId })
    .from(rosterSlots)
    .where(inArray(rosterSlots.teamId, [input.proposerTeamId, input.counterpartyTeamId]));
  assertNoPlayerOnTwoRosters(after);

  return { proposer: plan.proposer, counterparty: plan.counterparty, materializedLineupRows };
}
