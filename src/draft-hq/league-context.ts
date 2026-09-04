import { and, asc, eq, gte } from "drizzle-orm";
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
