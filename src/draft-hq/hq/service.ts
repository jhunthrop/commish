import { and, asc, eq, gte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, teams } from "@/db/schema";
import type { Position } from "@/domain/player";
import { plural } from "@/domain/duration";
import { BENCH_SLOT, STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import { boardRows } from "@/draft-hq/board/service";
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

/** The caller's soonest SCHEDULED real draft — never a mock (`leagues.isMock`), which is its own
 *  practice lobby with its own countdown. `null` for a caller with none scheduled. */
async function nextDraftingLeague(db: Db, userId: string): Promise<DraftHqLeagueContext | null> {
  const [row] = await db
    .select({
      leagueId: leagues.id,
      leagueName: leagues.name,
      rosterSlots: leagues.rosterSlots,
      kickoffAt: drafts.kickoffAt,
    })
    .from(teams)
    .innerJoin(leagues, and(eq(leagues.id, teams.leagueId), eq(leagues.isMock, false)))
    .innerJoin(drafts, eq(drafts.leagueId, leagues.id))
    .where(and(eq(teams.userId, userId), eq(drafts.status, "scheduled"), gte(drafts.kickoffAt, new Date())))
    .orderBy(asc(drafts.kickoffAt))
    .limit(1);
  if (row === undefined) return null;
  return {
    leagueId: row.leagueId,
    leagueName: row.leagueName,
    kickoffAt: row.kickoffAt.toISOString(),
    rosterNote: rosterShapeNote(row.rosterSlots),
  };
}

export async function draftHqBody(db: Db, userId: string): Promise<DraftHqBody> {
  const [nextDraft, board, sheet] = await Promise.all([
    nextDraftingLeague(db, userId),
    boardRows(db, { shape: { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS } }).catch(() => []),
    defaultSheetFor(db, userId, null),
  ]);
  return {
    nextDraft,
    boardPreview: board.slice(0, HQ_BOARD_PREVIEW_ROWS).map((row) => ({
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
