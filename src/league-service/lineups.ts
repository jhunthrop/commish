import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { lineupSlots, rosterSlots } from "@/db/schema";
import type { RosterSlot, RosterSlotConfig, RosterSlotType } from "@/domain/roster";
import { defaultLineup } from "@/league";

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
