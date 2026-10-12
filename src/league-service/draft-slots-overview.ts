import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@research/db/client";
import { draftActions, draftSlotPreferences } from "@/db/schema";
import { draftActionSchema } from "@/draft-engine";

/**
 * What the signed-in home needs to know about one manager's own draft, across every league they
 * are in: whether they have answered the one pre-draft question the product asks them, and which
 * slot the draw actually gave them.
 *
 * `slotPreferenceViewFor` (`./draft-schedule.ts`) answers the same two facts for ONE league, in
 * two queries scoped to one draft, which is exactly right on a page about one league and exactly
 * wrong on a page about ten: a manager in ten leagues would pay twenty round trips for a line of
 * words each. This module answers the same two facts for a SET of drafts in two grouped
 * statements, whatever the size of the set, and leaves the per-league view untouched as the
 * richer read it already is (it also carries `slotCount` and `canEdit`, which no card needs).
 */
export interface DraftSlotFacts {
  /**
   * Whether this manager has stored a slot ranking for this draft. A stored EMPTY ranking is a
   * real answer ("I do not mind", `SlotPreferenceView.ranking`'s own docblock), so the fact is
   * the presence of the row, never the length of the array inside it.
   */
  readonly ranked: boolean;
  /**
   * The slot this manager actually drafts from, 1-based, once the draw has run — read from the
   * draw's own `START_DRAFT` snapshot (`draftOrder`, ruling 27), never a replay. `null` before a
   * draft starts, which is when there is genuinely nothing to say: a card that has this omits
   * "you pick Nth" rather than guessing at it.
   */
  readonly assignedSlot: number | null;
}

export interface DraftSeat {
  readonly draftId: string;
  readonly teamId: string;
}

const NOTHING: DraftSlotFacts = { ranked: false, assignedSlot: null };

/** The draw's own order for one draft, as `START_DRAFT` recorded it — `null` for a draft that
 *  has not started, or one whose first action is not the draw (never true in ordinary use). */
function draftOrderOf(action: unknown): readonly string[] | null {
  const parsed = draftActionSchema.safeParse(action);
  if (!parsed.success || parsed.data.type !== "START_DRAFT") return null;
  return parsed.data.draftOrder;
}

/**
 * Both facts for every seat in `seats`, keyed by draft id, in TWO statements regardless of how
 * many drafts are asked about: one `IN` over the stored rankings for the caller's own team ids,
 * and one `IN` over each draft's first action (`sequence = 1`, the draw's snapshot). A draft with
 * neither is absent from the map, and every caller reads a miss as "nothing known", never as a
 * zero or an unranked claim.
 */
export async function draftSlotsForSeats(db: Db, seats: readonly DraftSeat[]): Promise<ReadonlyMap<string, DraftSlotFacts>> {
  if (seats.length === 0) return new Map();
  const draftIds = [...new Set(seats.map((seat) => seat.draftId))];
  const teamIds = [...new Set(seats.map((seat) => seat.teamId))];

  const [rankingRows, startRows] = await Promise.all([
    db
      .select({ draftId: draftSlotPreferences.draftId, teamId: draftSlotPreferences.teamId })
      .from(draftSlotPreferences)
      // Both halves of the composite key, so a ranking belonging to a team in a draft this caller
      // is not seated in can never be read as theirs.
      .where(and(inArray(draftSlotPreferences.draftId, draftIds), inArray(draftSlotPreferences.teamId, teamIds))),
    db
      .select({ draftId: draftActions.draftId, action: draftActions.action })
      .from(draftActions)
      .where(and(inArray(draftActions.draftId, draftIds), eq(draftActions.sequence, 1))),
  ]);

  const rankedKeys = new Set(rankingRows.map((row) => `${row.draftId}:${row.teamId}`));
  const orderByDraft = new Map(startRows.map((row) => [row.draftId, draftOrderOf(row.action)]));

  const factsByDraft = new Map<string, DraftSlotFacts>();
  for (const seat of seats) {
    const order = orderByDraft.get(seat.draftId) ?? null;
    const index = order === null ? -1 : order.indexOf(seat.teamId);
    factsByDraft.set(seat.draftId, {
      ranked: rankedKeys.has(`${seat.draftId}:${seat.teamId}`),
      assignedSlot: index === -1 ? null : index + 1,
    });
  }
  return factsByDraft;
}

/** A miss reads as "nothing known" everywhere, spelled once so no caller invents its own. */
export function slotFactsFor(facts: ReadonlyMap<string, DraftSlotFacts>, draftId: string | null): DraftSlotFacts {
  return draftId === null ? NOTHING : (facts.get(draftId) ?? NOTHING);
}
