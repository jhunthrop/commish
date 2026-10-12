import { eq } from "drizzle-orm";
import type { DbTx } from "@research/db/client";
import { draftPicks, drafts, rosterSlots } from "@/db/schema";
import { excludedSetFor } from "@research/db/upsert";
import type { DraftState } from "@/draft-engine";
import { LEAGUE_CONFIG } from "@/league";
import { writeSchedule } from "@/league-service/schedule";

export interface CommittedCounts {
  readonly picks: number;
  readonly teams: number;
}

/**
 * The one seam between "a draft happened" and "a season exists": the picks become rows, the
 * rosters become roster slots, the season's fixtures are written, and the draft is closed —
 * all in the caller's transaction, so a half-committed draft is impossible. Snake and auction
 * go through this identically; an auction pick simply carries the price it cleared at.
 */
export async function commitDraftState(tx: DbTx, state: DraftState): Promise<CommittedCounts> {
  const draftId = state.config.draftId;

  await tx.insert(draftPicks).values(
    state.picks.map((pick) => ({
      draftId,
      teamId: pick.teamId,
      playerId: pick.playerId,
      round: pick.round,
      pickNumber: pick.pickNumber,
      price: pick.price,
    })),
  );

  const slotRows = Object.entries(state.rosters).flatMap(([teamId, slots]) =>
    slots.map((slot) => ({ teamId, slot: slot.slot, slotIndex: slot.slotIndex, playerId: slot.playerId })),
  );
  if (slotRows.length > 0) {
    await tx
      .insert(rosterSlots)
      .values(slotRows)
      .onConflictDoUpdate({
        target: [rosterSlots.teamId, rosterSlots.slot, rosterSlots.slotIndex],
        set: excludedSetFor(rosterSlots, ["teamId", "slot", "slotIndex"]),
      });
  }

  await tx.update(drafts).set({ status: "complete" }).where(eq(drafts.id, draftId));

  // "A draft happened" and "a season exists" are the same moment. A league with drafted
  // rosters and no fixtures has nothing to play, so the schedule is written HERE, inside the
  // transaction that completes the draft — not by a follow-on call that could not run.
  // `writeSchedule` is idempotent, which is what keeps `commitDraftResults` safe to re-run.
  await writeSchedule(tx, {
    leagueId: state.config.leagueId,
    teamIds: state.draftOrder,
    weeks: LEAGUE_CONFIG.regularSeasonWeeks,
  });

  return { picks: state.picks.length, teams: Object.keys(state.rosters).length };
}
