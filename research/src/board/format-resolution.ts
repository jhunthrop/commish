import type { ScoringRules } from "@research/scoring/compute";
import {
  BOARD_FORMAT_SPECS,
  boardBasisLine,
  boardScoringLine,
  boardFormatForRules,
  boardSourceFor,
  type BoardFormat,
  type ResolvedBoardFormat,
} from "@research/projections/preseason/board-formats";
import { PRODUCT_SEASON } from "@research/projections/preseason/current";

/**
 * WHICH BOARD A LEAGUE READS (the scoring-formats round, 2026-09-08) — the one seam every
 * league-scoped board read goes through: the draft room's reasons, the player page's on-board
 * check, the simulator's and the assistant's evidence pool, the Draft HQ board with a league
 * selected. A league's own `scoring_settings` row decides (`boardFormatForRules`), with the same
 * `PPR_SCORING` fallback every other reader already makes for a league whose row was never written,
 * so no surface inside a league ever offers a selector and no two surfaces can disagree about which
 * board a half-PPR league is looking at.
 */
export interface LeagueBoardFormat extends ResolvedBoardFormat {
  /** The rules the format was resolved from: the league's own row, or the PPR fallback. */
  readonly rules: ScoringRules;
  /** `preseason_projections.source` of the board this league reads. */
  readonly source: string;
  /** The board's own basis sentence, "2026 board, 12-team half PPR, in board order". */
  readonly basisLine: string;
  /** The same sentence without the order clause — what a surface in the MANAGER's own order
   *  (the sheet) names its numbers with. */
  readonly scoringLine: string;
  /** "Half PPR", for a column or a caption. */
  readonly label: string;
}

/** The resolution for a format chosen directly (a league-free surface's selector): exact, no note. */
export function boardFormatResolution(format: BoardFormat, season: number = PRODUCT_SEASON): LeagueBoardFormat {
  return resolutionFor({ format, exact: true, note: null }, BOARD_FORMAT_SPECS[format].rules, season);
}

/** The resolution for a set of rules a caller already holds (a league whose settings row is in hand). */
export function boardFormatForLeagueRules(rules: ScoringRules, season: number = PRODUCT_SEASON): LeagueBoardFormat {
  return resolutionFor(boardFormatForRules(rules), rules, season);
}

function resolutionFor(resolved: ResolvedBoardFormat, rules: ScoringRules, season: number): LeagueBoardFormat {
  return {
    ...resolved,
    rules,
    source: boardSourceFor(resolved.format),
    basisLine: boardBasisLine(resolved.format, season),
    scoringLine: boardScoringLine(resolved.format, season),
    label: BOARD_FORMAT_SPECS[resolved.format].label,
  };
}
