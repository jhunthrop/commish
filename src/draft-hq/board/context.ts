import type { Db } from "@/db/client";
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import { BOARD_FORMAT_QUERY_KEY, DEFAULT_BOARD_FORMAT, isBoardFormat, type BoardFormat } from "@/projections/preseason/board-formats";
import type { LeagueBoardFormat } from "@/league-service/board-format";
import { myDraftLeagues, nextDraftingLeague, type DraftLeagueRow } from "@/draft-hq/league-context";
import { resolveBoardFormat } from "./service";

/**
 * WHOSE RULES THE DRAFT AREA'S NUMBERS ARE UNDER — resolved ONCE, read by the Board and by Your
 * sheet (fix round 1, H3).
 *
 * THE TWO STOPS COMPUTE THE SAME NAMED QUANTITY AND USED TO COMPUTE IT DIFFERENTLY. The board took
 * the caller's next-drafting league; the sheet hard-wired league-free. Under one `<h1>Draft</h1>`,
 * with no control on the sheet, one tap on the switch changed every number on screen — Nacua read
 * 69.1 on one stop and 162.8 on the other, each with an honest basis, which is worse than either
 * being wrong. This module is the one rule: same query string, same league, same shape, same
 * board. The switch carries the query (`DraftHeader`), so a stop change moves nothing but the view.
 *
 * `league=generic` is the explicit default-settings board and the only place the scoring selector
 * appears: inside a league the league's own rules decide and there is nothing to select.
 */
export interface DraftAreaContext {
  /** Every real league the caller drafts in — the picker's list. */
  readonly leagues: readonly DraftLeagueRow[];
  /** The league every number is under, or null on the generic board. */
  readonly selected: DraftLeagueRow | null;
  readonly isGeneric: boolean;
  /** What the picker shows as chosen. */
  readonly pickerValue: string;
  readonly shape: { readonly teamCount: number; readonly rosterSlots: readonly RosterSlotConfig[] };
  /** The requested format, and whether the URL named it (the selector's own memory contract). */
  readonly format: BoardFormat;
  readonly explicitFormat: boolean;
  readonly resolved: LeagueBoardFormat;
  /** `?league=`/`?format=` as they should ride the switch to the next stop, so the context
   *  survives a stop change. Empty when the caller named neither. */
  readonly query: Readonly<Record<string, string>>;
}

export type PageParams = Record<string, string | readonly string[] | undefined>;

function one(params: PageParams, key: string): string | undefined {
  const raw = params[key];
  return typeof raw === "string" ? raw : undefined;
}

export async function draftAreaContext(db: Db, userId: string, params: PageParams): Promise<DraftAreaContext> {
  const leagueParam = one(params, "league");
  const leagues = await myDraftLeagues(db, userId);

  let selected: DraftLeagueRow | null = null;
  let isGeneric = leagueParam === "generic";
  if (!isGeneric) {
    if (leagueParam !== undefined) {
      selected = leagues.find((league) => league.leagueId === leagueParam) ?? null;
      // An unknown or stale id degrades to the honest generic default rather than a 404.
      if (selected === null) isGeneric = true;
    } else {
      selected = await nextDraftingLeague(db, userId);
      if (selected === null) isGeneric = true;
    }
  }

  const formatParam = one(params, BOARD_FORMAT_QUERY_KEY);
  const explicitFormat = formatParam !== undefined && isBoardFormat(formatParam);
  const format = explicitFormat ? (formatParam as BoardFormat) : DEFAULT_BOARD_FORMAT;

  const boardOptions = { leagueId: selected?.leagueId, format: isGeneric ? format : undefined };
  const resolved = await resolveBoardFormat(db, boardOptions);

  const query: Record<string, string> = {};
  if (leagueParam !== undefined) query.league = leagueParam;
  if (isGeneric && explicitFormat) query[BOARD_FORMAT_QUERY_KEY] = format;

  return {
    leagues,
    selected,
    isGeneric,
    pickerValue: isGeneric ? "generic" : leagueParam !== undefined ? (selected?.leagueId ?? "next") : "next",
    shape: selected === null ? { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS } : { teamCount: selected.teamCount, rosterSlots: selected.rosterSlots },
    format,
    explicitFormat,
    resolved,
    query,
  };
}

/** What `boardRows` needs from a context, in one place so no caller assembles it twice. */
export function boardOptionsFor(context: DraftAreaContext): { readonly shape: DraftAreaContext["shape"]; readonly leagueId?: string; readonly format?: BoardFormat } {
  return { shape: context.shape, leagueId: context.selected?.leagueId, format: context.isGeneric ? context.format : undefined };
}

/**
 * THE BASIS, IN ONE SENTENCE A PERSON WOULD SAY (fix round 1, M2).
 *
 * It used to read "Under E2E Draft Schedule League's rules: 2 teams, its own roster shape. 2026
 * board, 12-team PPR, in board order" — twenty words, a colon, three facts, and TWO TEAM COUNTS
 * for one set of numbers, because the stored board's own `12-team` clause rode along beside the
 * league's real shape. A reader with a two-team league saw a number that was honest and a sentence
 * that looked broken.
 *
 * The league's own shape is the shape every number below was recomputed against, so it is the only
 * count the sentence states. `12-team` survives on the GENERIC board, where it is true and is the
 * whole point of the word "generic".
 */
export function basisSentence(context: DraftAreaContext, season: number): string {
  const scoring = `${context.resolved.label}, ${season} projections.`;
  if (context.selected === null) return `Generic board: 12 teams, a standard roster shape. ${scoring}`;
  const teams = `${context.selected.teamCount} team${context.selected.teamCount === 1 ? "" : "s"}`;
  const note = context.resolved.note === null ? "" : ` ${context.resolved.note}`;
  return `${context.selected.leagueName}: ${teams}, its own roster shape. ${scoring}${note}`;
}
