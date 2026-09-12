import { and, asc, eq, gte, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, teams } from "@/db/schema";
import type { DraftFormat } from "@/domain/league";
import type { RosterSlotConfig } from "@/domain/roster";

/**
 * DRAFT HQ'S LEAGUE CONTEXT PICKER (spec §2, §3) — the one query every league-aware surface in
 * this section shares for "which of the caller's real leagues is this about": the HQ banner
 * defaults to it, and The Board's picker defaults to it too. One query, one definition of "next
 * drafting", so the two surfaces can never quietly disagree about which league is "next."
 */
export interface DraftLeagueRow {
  readonly leagueId: string;
  readonly leagueName: string;
  readonly format: DraftFormat;
  readonly teamCount: number;
  readonly rosterSlots: readonly RosterSlotConfig[];
  readonly kickoffAt: string;
}

/** The caller's soonest SCHEDULED real draft — never a mock (`leagues.isMock`). `null` for a
 *  caller with none scheduled. */
export async function nextDraftingLeague(db: Db, userId: string): Promise<DraftLeagueRow | null> {
  const [row] = await db
    .select({
      leagueId: leagues.id,
      leagueName: leagues.name,
      format: leagues.format,
      teamCount: leagues.teamCount,
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
  return { ...row, kickoffAt: row.kickoffAt.toISOString() };
}

/**
 * THE DRAFT AREA'S ONE DOOR BACK TO A REAL ROOM (the Draft area round, 2026-09-12) — the league
 * of the caller's that is DRAFTING NOW if one is, otherwise the soonest one scheduled.
 *
 * Drafting beats scheduled whatever the clock says, and that ordering is the whole point rather
 * than a tidy default: with Rooms gone from the top nav this line is the only path into a live
 * room, and a reminder about Sunday would be standing in front of a draft happening this second.
 * `nextDraftingLeague` above answers a different question ("which league is this board ABOUT")
 * and deliberately stays scheduled-only, because a board computed under a league already half
 * drafted is not the board anyone asked for.
 *
 * `assignedSlot` is null in every row this query can return today: no draft draws its order
 * before it starts (`draft_slot_preferences` holds what a manager WANTS, not what he got, and
 * the drawn order is snapshotted into the draft's own START_DRAFT action). It is selected here
 * rather than omitted so the sentence that reads it has one shape, not two.
 */
export interface DraftDoorRow {
  readonly leagueId: string;
  readonly leagueName: string;
  readonly draftId: string;
  readonly drafting: boolean;
  readonly kickoffIso: string;
  readonly assignedSlot: number | null;
}

export async function draftDoorFor(db: Db, userId: string): Promise<DraftDoorRow | null> {
  const rows = await db
    .select({
      leagueId: leagues.id,
      leagueName: leagues.name,
      draftId: drafts.id,
      status: drafts.status,
      kickoffAt: drafts.kickoffAt,
    })
    .from(teams)
    .innerJoin(leagues, and(eq(leagues.id, teams.leagueId), eq(leagues.isMock, false)))
    .innerJoin(drafts, eq(drafts.leagueId, leagues.id))
    .where(and(eq(teams.userId, userId), inArray(drafts.status, ["scheduled", "in_progress"])))
    .orderBy(asc(drafts.kickoffAt));

  const drafting = rows.find((row) => row.status === "in_progress");
  const soonest = rows.find((row) => row.status === "scheduled");
  const chosen = drafting ?? soonest;
  if (chosen === undefined) return null;
  return {
    leagueId: chosen.leagueId,
    leagueName: chosen.leagueName,
    draftId: chosen.draftId,
    drafting: chosen.status === "in_progress",
    kickoffIso: chosen.kickoffAt.toISOString(),
    assignedSlot: null,
  };
}

/** Every real league (never a mock) the caller fields a team in — The Board's picker list,
 *  newest joined first. */
export async function myDraftLeagues(db: Db, userId: string): Promise<readonly DraftLeagueRow[]> {
  const rows = await db
    .select({
      leagueId: leagues.id,
      leagueName: leagues.name,
      format: leagues.format,
      teamCount: leagues.teamCount,
      rosterSlots: leagues.rosterSlots,
      kickoffAt: drafts.kickoffAt,
    })
    .from(teams)
    .innerJoin(leagues, and(eq(leagues.id, teams.leagueId), eq(leagues.isMock, false)))
    .leftJoin(drafts, eq(drafts.leagueId, leagues.id))
    .where(eq(teams.userId, userId))
    .orderBy(asc(leagues.createdAt));
  return rows.map((row) => ({ ...row, kickoffAt: row.kickoffAt === null ? "" : row.kickoffAt.toISOString() }));
}
