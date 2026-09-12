import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, teams } from "@/db/schema";
import type { DraftFormat } from "@/domain/league";
import type { RosterSlotConfig } from "@/domain/roster";

/**
 * THE DRAFT AREA'S ONE READ OF "WHICH LEAGUE IS THIS ABOUT" — shared by the Board, Your sheet and
 * the quiet line above both of them, so no two of them can ever quietly disagree.
 *
 * ONE QUERY UNDERNEATH ALL THREE (fix round 1, H1). Two nearly-identical selects had drifted: the
 * board's own picker default carried `kickoff_at >= now`, and the door above it did not, so a
 * scheduled draft whose kickoff had passed without ever starting was still offered as a room to
 * open — "drafts Thursday" about a Thursday already gone — and it named a DIFFERENT league than
 * the basis under it. `draftingRows` below is the single definition both read.
 */
export interface DraftLeagueRow {
  readonly leagueId: string;
  readonly leagueName: string;
  readonly format: DraftFormat;
  readonly teamCount: number;
  readonly rosterSlots: readonly RosterSlotConfig[];
  readonly kickoffAt: string;
}

/** One of the caller's real leagues with a draft still ahead of it: scheduled with its kickoff in
 *  the future, or under way right now. Never a mock (`leagues.isMock`). Soonest first. */
interface DraftingRow extends DraftLeagueRow {
  readonly draftId: string;
  readonly drafting: boolean;
}

async function draftingRows(db: Db, userId: string, now: Date): Promise<readonly DraftingRow[]> {
  const rows = await db
    .select({
      leagueId: leagues.id,
      leagueName: leagues.name,
      format: leagues.format,
      teamCount: leagues.teamCount,
      rosterSlots: leagues.rosterSlots,
      kickoffAt: drafts.kickoffAt,
      draftId: drafts.id,
      status: drafts.status,
    })
    .from(teams)
    .innerJoin(leagues, and(eq(leagues.id, teams.leagueId), eq(leagues.isMock, false)))
    .innerJoin(drafts, eq(drafts.leagueId, leagues.id))
    .where(and(eq(teams.userId, userId), inArray(drafts.status, ["scheduled", "in_progress"])))
    .orderBy(asc(drafts.kickoffAt));

  return rows.flatMap((row) => {
    const drafting = row.status === "in_progress";
    // THE FUTURE GUARD, on the scheduled rows only (H1). A draft already under way is a door
    // whatever its kickoff says — that is the whole point of widening the line to "is drafting
    // now" — but a SCHEDULED draft whose moment has passed without starting is not a thing to
    // open, and saying it drafts on a day already gone is worse than saying nothing.
    if (!drafting && row.kickoffAt < now) return [];
    return [{ ...row, kickoffAt: row.kickoffAt.toISOString(), drafting }];
  });
}

/** The caller's soonest real draft still ahead of them — what the Board and Your sheet both
 *  default their league context to. `null` for a caller with none. */
export async function nextDraftingLeague(db: Db, userId: string, now: Date = new Date()): Promise<DraftLeagueRow | null> {
  const rows = await draftingRows(db, userId, now);
  // Scheduled first for the BOARD's default: a board computed under a league already half drafted
  // is not the board anyone asked for, so a draft under way never becomes the page's context.
  const scheduled = rows.find((row) => !row.drafting);
  return scheduled ?? null;
}

/**
 * THE DRAFT AREA'S DOOR BACK INTO A REAL ROOM — the league of the caller's that is DRAFTING NOW if
 * one is, otherwise the page's own league context if that league has a draft ahead of it,
 * otherwise the soonest one.
 *
 * DRAFTING BEATS SCHEDULED whatever the clock says, and that ordering is the point rather than a
 * tidy default: with Rooms gone from the top nav this line is the only path into a live room, and
 * a reminder about Sunday standing in front of a draft happening this second is the wrong fact.
 *
 * `preferredLeagueId` IS THE PAGE'S OWN CONTEXT (H1). Without it the line could name one league
 * while the basis three inches below named another, which is exactly what the review caught on a
 * real screenshot. With it, the two agree whenever they can, and the one case they do not is the
 * one that earns it: a different league drafting right now.
 *
 * `assignedSlot` is null in every row this can return today: no draft draws its order before it
 * starts (`draft_slot_preferences` holds what a manager WANTS, not what he got, and the drawn
 * order is snapshotted into the draft's own START_DRAFT action). It is stated here rather than
 * omitted so the sentence that reads it has one shape, not two.
 */
export interface DraftDoorRow {
  readonly leagueId: string;
  readonly leagueName: string;
  readonly draftId: string;
  readonly drafting: boolean;
  readonly kickoffIso: string;
  readonly assignedSlot: number | null;
}

export async function draftDoorFor(db: Db, userId: string, preferredLeagueId?: string, now: Date = new Date()): Promise<DraftDoorRow | null> {
  const rows = await draftingRows(db, userId, now);
  const chosen = rows.find((row) => row.drafting) ?? rows.find((row) => row.leagueId === preferredLeagueId) ?? rows[0];
  if (chosen === undefined) return null;
  return {
    leagueId: chosen.leagueId,
    leagueName: chosen.leagueName,
    draftId: chosen.draftId,
    drafting: chosen.drafting,
    kickoffIso: chosen.kickoffAt,
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
