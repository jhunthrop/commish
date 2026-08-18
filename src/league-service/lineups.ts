import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { leagues, lineupSlots, matchups, players, rosterSlots } from "@/db/schema";
import { validateLineup } from "@/domain/roster-eligibility";
import { BENCH_SLOT } from "@/domain/roster";
import type { RosterSlot, RosterSlotConfig, RosterSlotType } from "@/domain/roster";
import { benchOf, defaultLineup, startersOf } from "@/league";
import { excludedSetFor } from "@/db/upsert";
import type { LineupBody, LineupSlotView } from "@/league-room/contract";

export interface GetLineupInput {
  readonly teamId: string;
  readonly weekNumber: number;
  readonly slotConfig: readonly RosterSlotConfig[];
}

interface StoredSlotRow {
  readonly slot: string;
  readonly slotIndex: number;
  readonly playerId: string | null;
}

/** `slot` is a plain text column in both tables; the league's config is what gives it meaning. */
function toRosterSlots(rows: readonly StoredSlotRow[]): readonly RosterSlot[] {
  return rows.map((row) => ({ slot: row.slot as RosterSlotType, slotIndex: row.slotIndex, playerId: row.playerId }));
}

/**
 * The lineup this team fields in this week. Saved rows win; where there are none, the team's
 * drafted roster IS the lineup (`defaultLineup`), so a manager who never opens the editor
 * still fields a legal team rather than forfeiting the week to an empty form.
 *
 * Either way the rows go through `defaultLineup`, so the result always has exactly one entry
 * per configured slot — a saved lineup written against an older roster shape can't hand the
 * caller a slot the league no longer has.
 */
export async function getLineup(db: Db, { teamId, weekNumber, slotConfig }: GetLineupInput): Promise<readonly RosterSlot[]> {
  const saved = await db
    .select()
    .from(lineupSlots)
    .where(and(eq(lineupSlots.teamId, teamId), eq(lineupSlots.weekNumber, weekNumber)));
  if (saved.length > 0) return defaultLineup(slotConfig, toRosterSlots(saved));

  const roster = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, teamId));
  return defaultLineup(slotConfig, toRosterSlots(roster));
}

export interface LineupSlotInput {
  readonly slot: RosterSlotType;
  readonly slotIndex: number;
  readonly playerId: string | null;
}

export interface SetLineupInput {
  readonly leagueId: string;
  readonly teamId: string;
  readonly weekNumber: number;
  readonly slots: readonly LineupSlotInput[];
}

export type SetLineupResult =
  | { readonly ok: true; readonly lineup: LineupBody }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * A week is locked once it has been scored — the same condition `MatchupSummary.final` uses.
 * There is deliberately no clock-based lock: this phase has no live game data for a clock to
 * track, and pretending otherwise would break the "never imply live data" rule from the
 * server side rather than the copy side.
 */
export async function isWeekLocked(db: Db, leagueId: string, weekNumber: number): Promise<boolean> {
  const week = await db.select().from(matchups).where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, weekNumber)));
  return week.length > 0 && week.every((row) => row.homeScore !== null && row.awayScore !== null);
}

/**
 * Saves one team's lineup for one week.
 *
 * Legality comes from `validateLineup` (`src/domain/roster-eligibility.ts`) — reused, never
 * restated — applied to the STARTING slots only, since it treats an empty slot as invalid and
 * a bench spot is legitimately empty. Its `reason` is returned verbatim: it is already plain
 * language, and paraphrasing it here would be a second copy of the rule.
 *
 * The two checks around it are about this TEAM rather than about slot legality, so they are
 * the boundary's own: every named player must actually be on the roster, and no player may
 * occupy two spots.
 */
export async function setLineup(db: Db, input: SetLineupInput): Promise<SetLineupResult> {
  const [league] = await db.select({ rosterSlots: leagues.rosterSlots }).from(leagues).where(eq(leagues.id, input.leagueId));
  if (league === undefined) return { ok: false, status: 404, reason: "That league doesn't exist." };

  const week = await db
    .select({ weekNumber: matchups.weekNumber })
    .from(matchups)
    .where(and(eq(matchups.leagueId, input.leagueId), eq(matchups.weekNumber, input.weekNumber)));
  if (week.length === 0) return { ok: false, status: 404, reason: "That week isn't part of this league's season." };
  if (await isWeekLocked(db, input.leagueId, input.weekNumber)) {
    return { ok: false, status: 409, reason: `Week ${input.weekNumber} is final, so its lineup can't change.` };
  }

  const roster = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, input.teamId));
  const owned = new Set(roster.map((row) => row.playerId).filter((id): id is string => id !== null));
  const named = input.slots.map((slot) => slot.playerId).filter((id): id is string => id !== null);
  if (named.some((id) => !owned.has(id))) return { ok: false, status: 422, reason: "One of those players isn't on your team." };
  if (new Set(named).size !== named.length) return { ok: false, status: 422, reason: "You can only start a player in one spot." };

  // The BENCH is derived, never trusted from the client: it is exactly "everyone on this
  // roster who isn't starting". That is what lets the editor send only its starting slots and
  // do no lineup arithmetic of its own — which matters, because `src/league-room/**` may not
  // value-import `@/league` at all.
  const starterSlots = input.slots.filter((slot) => slot.slot !== BENCH_SLOT);
  const startingIds = new Set(starterSlots.map((slot) => slot.playerId).filter((id): id is string => id !== null));
  const benched = [...owned].filter((id) => !startingIds.has(id)).sort();
  const benchConfig = league.rosterSlots.find((config) => config.slot === BENCH_SLOT);
  const benchSlots = benched
    .slice(0, benchConfig?.count ?? 0)
    .map((playerId, slotIndex) => ({ slot: BENCH_SLOT, slotIndex, playerId }));

  const lineup = defaultLineup(league.rosterSlots, [...starterSlots, ...benchSlots]);
  const playerRows = await db.select({ id: players.id, position: players.position }).from(players);
  const playerPositions = Object.fromEntries(playerRows.map((row) => [row.id, row.position]));
  const starterConfig = league.rosterSlots.filter((config) => config.slot !== BENCH_SLOT);

  const validation = validateLineup({ slotConfig: starterConfig, roster: startersOf(lineup), playerPositions });
  if (!validation.valid) return { ok: false, status: 422, reason: validation.reason };

  await db
    .insert(lineupSlots)
    .values(lineup.map((slot) => ({ teamId: input.teamId, weekNumber: input.weekNumber, slot: slot.slot, slotIndex: slot.slotIndex, playerId: slot.playerId })))
    .onConflictDoUpdate({
      target: [lineupSlots.teamId, lineupSlots.weekNumber, lineupSlots.slot, lineupSlots.slotIndex],
      set: excludedSetFor(lineupSlots, ["teamId", "weekNumber", "slot", "slotIndex"]),
    });

  const view = await lineupView(db, { leagueId: input.leagueId, teamId: input.teamId, weekNumber: input.weekNumber });
  // `view` cannot be null here: the league row was read at the top of this function.
  return { ok: true, lineup: view! };
}

/** The lineup as a page renders it: starters, bench, names, positions, and the lock. */
export async function lineupView(
  db: Db,
  input: { readonly leagueId: string; readonly teamId: string; readonly weekNumber: number },
): Promise<LineupBody | null> {
  const [league] = await db.select({ rosterSlots: leagues.rosterSlots }).from(leagues).where(eq(leagues.id, input.leagueId));
  if (league === undefined) return null;

  const lineup = await getLineup(db, { teamId: input.teamId, weekNumber: input.weekNumber, slotConfig: league.rosterSlots });
  const playerRows = await db.select().from(players);
  const playerById = new Map(playerRows.map((row) => [row.id, row]));
  const toView = (slot: RosterSlot): LineupSlotView => {
    const player = slot.playerId === null ? undefined : playerById.get(slot.playerId);
    return {
      slot: slot.slot,
      slotIndex: slot.slotIndex,
      playerId: slot.playerId,
      playerName: player?.name ?? null,
      position: player?.position ?? null,
    };
  };

  return {
    weekNumber: input.weekNumber,
    locked: await isWeekLocked(db, input.leagueId, input.weekNumber),
    starters: startersOf(lineup).map(toView),
    bench: benchOf(lineup).map(toView),
  };
}
