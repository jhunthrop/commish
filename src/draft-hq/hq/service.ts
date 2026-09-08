import type { Db } from "@/db/client";
import type { Position } from "@/domain/player";
import { plural } from "@/domain/duration";
import { BENCH_SLOT, type RosterSlotConfig } from "@/domain/roster";
import { GENERIC_BOARD_SHAPE } from "@/draft-hq/board/generic-board";
import { boardRows, isProjectedRow, type BoardRow } from "@/draft-hq/board/service";
import { nextDraftingLeague as nextDraftingLeagueRow } from "@/draft-hq/league-context";
import { defaultSheetFor } from "@/draft-hq/sheet/service";

/**
 * DRAFT HQ'S OWN READ (spec §13 item 1's hub) — the league-context banner, the countdown to the
 * caller's next real draft, a board preview and the sheet card, all real: no card here carries a
 * number this module cannot point at a row for (the honest-data rule).
 */
export interface DraftHqLeagueContext {
  readonly leagueId: string;
  readonly leagueName: string;
  readonly kickoffAt: string;
  /** A settings-derived sentence, or `null` when the league's shape carries nothing worth a
   *  banner over the default (spec: "derive from actual league settings, never hardcode"). */
  readonly rosterNote: string | null;
}

export interface DraftHqBoardPreviewRow {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly positionRankInValue: number | null;
  readonly team: string;
  readonly projectedPoints: number;
}

export interface DraftHqBody {
  /** The caller's next SCHEDULED real draft (never a mock), soonest kickoff first — `null` for a
   *  caller with no upcoming draft to prepare for. */
  readonly nextDraft: DraftHqLeagueContext | null;
  /** Top of the default board — real evidence points, never invented. Empty when the board has
   *  not been built for this season yet. */
  readonly boardPreview: readonly DraftHqBoardPreviewRow[];
  /** `null` when the caller has never started a sheet (the card then offers to start one rather
   *  than showing a fabricated zero dressed as a real count — a real zero and "never started"
   *  are different facts, exactly the "did not play" vs. "scored nothing" distinction this
   *  product keeps everywhere else). */
  readonly sheetEntryCount: number | null;
}

const HQ_BOARD_PREVIEW_ROWS = 3;

const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;

/** A coarse, server-rendered "9 days"/"14 hours"/"under an hour" — the HQ hero's own headline
 *  clock (the hub mock's "9 days" is static prose, not a per-second tick), so this needs no
 *  client component the way `Countdown`'s ticking digits do. Clamped at zero: a draft whose
 *  kickoff has already passed (a live or completing draft `nextDraftingLeague` will stop
 *  returning once its status moves off `scheduled`) never reads negative. */
export function countdownLabel(kickoffAt: Date, now: Date): string {
  const remainingMs = Math.max(0, kickoffAt.getTime() - now.getTime());
  if (remainingMs < MS_PER_HOUR) return "under an hour";
  if (remainingMs < MS_PER_DAY) return plural(Math.round(remainingMs / MS_PER_HOUR), "hour");
  return plural(Math.round(remainingMs / MS_PER_DAY), "day");
}

/** How many QB-eligible STARTING slots (dedicated QB plus SUPERFLEX, never bench, never FLEX,
 *  which does not accept a quarterback) a roster shape carries. */
function qbStartingSlots(rosterSlots: readonly RosterSlotConfig[]): number {
  return rosterSlots
    .filter((slot) => slot.slot !== BENCH_SLOT && slot.eligiblePositions.includes("QB"))
    .reduce((sum, slot) => sum + slot.count, 0);
}

/**
 * The one sentence the HQ banner shows about a league's own rules — derived from its actual
 * stored `roster_slots`, never a hardcoded "2QB" string. `null` for an ordinary one-quarterback
 * league, where there is nothing about the shape worth a banner over the default board.
 */
export function rosterShapeNote(rosterSlots: readonly RosterSlotConfig[]): string | null {
  const qbSlots = qbStartingSlots(rosterSlots);
  if (qbSlots < 2) return null;
  return `Your league starts ${qbSlots} quarterbacks. That moves quarterbacks up your board — every surface here is computed under your league's exact rules, not a generic list.`;
}

/** The HQ banner's own shaping of the shared league-context read (`@/draft-hq/league-context`):
 *  a plain-language roster note derived from the league's own stored shape. `null` for a caller
 *  with none scheduled. */
async function nextDraftingLeagueContext(db: Db, userId: string): Promise<DraftHqLeagueContext | null> {
  const row = await nextDraftingLeagueRow(db, userId);
  if (row === null) return null;
  return {
    leagueId: row.leagueId,
    leagueName: row.leagueName,
    kickoffAt: row.kickoffAt,
    rosterNote: rosterShapeNote(row.rosterSlots),
  };
}

export async function draftHqBody(db: Db, userId: string): Promise<DraftHqBody> {
  const [nextDraft, board, sheet] = await Promise.all([
    nextDraftingLeagueContext(db, userId),
    boardRows(db, { shape: GENERIC_BOARD_SHAPE }).catch(
      (): readonly BoardRow[] => [],
    ),
    defaultSheetFor(db, userId, null),
  ]);
  return {
    nextDraft,
    // PROJECTED ROWS ONLY (the 2026-09-05 kicker and team defence round): this preview is the top
    // of the board BY PROJECTION, and the board now also carries market-order rows for positions
    // the engine published nothing for. They sit after every projected row anyway, so the slice
    // would not have reached them, and the filter is what makes that a rule rather than a
    // coincidence of ordering.
    boardPreview: board.filter(isProjectedRow).slice(0, HQ_BOARD_PREVIEW_ROWS).map((row) => ({
      playerId: row.playerId,
      name: row.name,
      position: row.position,
      positionRankInValue: row.positionRankInValue,
      team: row.team,
      projectedPoints: row.projectedPoints,
    })),
    sheetEntryCount: sheet === null ? null : sheet.entries.length,
  };
}
