import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { draftSlotPreferences, drafts, leagues, teams } from "@/db/schema";
import { excludedSetFor } from "@/db/upsert";
import type { SlotPreferenceMap } from "./order";

/**
 * `PUT /api/leagues/[leagueId]/slot-preference`'s body shape. The upper bound (64) is a
 * defensive cap independent of any real league size — the meaningful ceiling is THIS league's
 * own `teamCount`, enforced by `setSlotPreference` itself, which is the only check that can
 * know it.
 */
export const setSlotPreferenceSchema = z.object({
  ranking: z.array(z.number().int()).max(64),
});

/**
 * The literal for "you don't field a team here," answered as a plain 404 rather than the
 * league's ordinary 403 (`NO_TEAM_MESSAGE`, `@/lib/leagues/membership`) — deliberately, because
 * `setSlotPreference` is called directly by its own tests, not only through the route, and a
 * ranking is scoped to a TEAM, so a caller with no team in this league has nothing to rank and
 * gets the same non-oracle 404 a stranger to the league entirely would (ruling 14): whether the
 * caller merely lacks a team or the league doesn't exist at all is not this function's to say.
 */
const NOT_FOUND = "That league doesn't exist.";

/**
 * The refusal sentences `setSlotPreference` gives for an otherwise-authorized request, named
 * once so the service and its tests never hand-type a second copy — the same discipline
 * `KICKOFF_REFUSALS` (`@/league-service/draft-schedule`) already keeps.
 */
export const SLOT_PREFERENCE_REFUSALS = {
  alreadyStarted: "This draft has already started, so the order is set.",
  repeated: "Rank each slot at most once.",
} as const;

/** "Pick from slots 1 to 12." — a function, not a literal, because the ceiling is this
 *  league's own `teamCount`, never a fixed number. */
function outOfRangeMessage(slotCount: number): string {
  return `Pick from slots 1 to ${slotCount}.`;
}

export interface SetSlotPreferenceInput {
  readonly leagueId: string;
  readonly userId: string;
  /** 1-based draft-slot numbers, most-wanted first. May be empty ("I do not mind") or partial
   *  — most managers care about two slots, not twelve. */
  readonly ranking: readonly number[];
}

export type SetSlotPreferenceResult =
  | { readonly ok: true; readonly ranking: readonly number[] }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * Writes one team's slot ranking. A TABLE write, not a draft action (ruling 27 — see
 * `draft_slot_preferences`'s own docblock in `@/db/schema`): this is an input to the one-time
 * draw `assignDraftSlots` (`@/draft-service/order`) runs at `START_DRAFT`, never itself part of
 * the replayed log.
 *
 * The caller's own team is resolved from `(leagueId, userId)` with a plain, unlocked read —
 * team membership does not change mid-request in any way this write needs to guard against.
 * The draft's `status`, which DOES need to be checked atomically against a concurrent
 * `START_DRAFT`, is read under `drafts FOR UPDATE`: the same leaf lock `applyAction` and
 * `startDraft` (`./store`) already take on this exact table, so this adds no new edge to the
 * lock order graph. NO-WRITE-BEFORE-REFUSAL: every refusal below returns before the `INSERT`
 * is ever reached.
 *
 * Refuses on five paths — already started, a slot number outside the league's own range, a
 * repeated slot, and no team in this league — and writes nothing on any of them.
 */
export async function setSlotPreference(db: Db, input: SetSlotPreferenceInput): Promise<SetSlotPreferenceResult> {
  const [teamRow] = await db
    .select({ teamId: teams.id, draftId: drafts.id, slotCount: leagues.teamCount })
    .from(teams)
    .innerJoin(leagues, eq(leagues.id, teams.leagueId))
    .innerJoin(drafts, eq(drafts.leagueId, teams.leagueId))
    .where(and(eq(teams.leagueId, input.leagueId), eq(teams.userId, input.userId)));
  if (teamRow === undefined) return { ok: false, status: 404, reason: NOT_FOUND };

  return db.transaction(async (tx) => {
    const [draftRow] = await tx.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, teamRow.draftId)).for("update");
    // Unreachable in practice — `teamRow.draftId` was just read from the very same `drafts` row
    // this re-selects — but guarded rather than asserted, the same discipline `startDraft`'s own
    // "vanished between insert and lock" throw follows for a state the schema's own FKs make
    // impossible to reach through ordinary use.
    if (draftRow === undefined) return { ok: false, status: 404, reason: NOT_FOUND };
    if (draftRow.status !== "scheduled") {
      return { ok: false, status: 409, reason: SLOT_PREFERENCE_REFUSALS.alreadyStarted };
    }

    const seen = new Set<number>();
    for (const slot of input.ranking) {
      if (slot < 1 || slot > teamRow.slotCount) {
        return { ok: false, status: 422, reason: outOfRangeMessage(teamRow.slotCount) };
      }
      if (seen.has(slot)) return { ok: false, status: 422, reason: SLOT_PREFERENCE_REFUSALS.repeated };
      seen.add(slot);
    }

    await tx
      .insert(draftSlotPreferences)
      .values({ draftId: teamRow.draftId, teamId: teamRow.teamId, ranking: [...input.ranking], updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [draftSlotPreferences.draftId, draftSlotPreferences.teamId],
        set: excludedSetFor(draftSlotPreferences, ["draftId", "teamId"]),
      });

    return { ok: true, ranking: input.ranking };
  });
}

/**
 * Every team's saved ranking for one draft, keyed by team id — what `startDraft` (`./store`)
 * reads once, at command time, to feed `draftOrderFor`'s draw. An ordinary query, never a
 * replay: preferences are an input, and the draw's own output is what gets snapshotted into
 * `START_DRAFT.draftOrder` (ruling 27), so nothing here needs to be reconstructible from the
 * action log.
 */
export async function slotPreferencesFor(db: Db, draftId: string): Promise<SlotPreferenceMap> {
  const rows = await db
    .select({ teamId: draftSlotPreferences.teamId, ranking: draftSlotPreferences.ranking })
    .from(draftSlotPreferences)
    .where(eq(draftSlotPreferences.draftId, draftId));
  return Object.fromEntries(rows.map((row) => [row.teamId, row.ranking]));
}
