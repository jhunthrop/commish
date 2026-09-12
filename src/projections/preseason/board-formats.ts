import { HALF_PPR_SCORING, PPR_SCORING, STANDARD_SCORING } from "@/domain/scoring";
import type { ScoringRules } from "@/scoring/compute";
import { BENCHMARK_SOURCES } from "./benchmarks";

/**
 * THE SCORING FORMAT A BOARD IS PRICED UNDER (the scoring-formats round, 2026-09-08) — one value
 * that every derived name is looked up from: the board source a persist writes, the ADP benchmark
 * source the blend anchors to, the daily snapshot's own `format` column, the path segment the feed
 * publishes the board under, the exact preset rules, the label a screen prints and the basis line a
 * board names itself with.
 *
 * ONE VALUE, MANY LOOKUPS, NEVER A SECOND LITERAL. Before this round the product carried "ppr" in
 * four spellings across four modules (`commish_board_v9_ppr_12`, `ffc_adp_ppr_12`, `ppr_12`, the
 * feed's `/adp/ppr`), each correct only because there was one format. A second format is exactly
 * when four spellings drift, so they are derived here from the one `BoardFormat` and nowhere else.
 *
 * THE THREE PRESETS AND NO MORE. `domain/scoring.ts` ships four (TE premium is the fourth); the
 * engine carries a per-game line with receptions on it, so any of the four is one scoring pass
 * away, but a board also needs an ADP feed to anchor to and the feed publishes exactly these three.
 * TE premium resolves to the PPR board through `boardFormatForRules`, and says so.
 */
export type BoardFormat = "ppr" | "half" | "std";

export const BOARD_FORMATS: readonly BoardFormat[] = ["ppr", "half", "std"];

/** The format every league-free surface shows first, and the tie-break when a custom sheet sits
 *  exactly between two presets. */
export const DEFAULT_BOARD_FORMAT: BoardFormat = "ppr";

/**
 * The board's model version — the `v9` in `commish_board_v9_ppr_12`. Bumped by a fit round, never
 * by a format: the three formats of one version are the same model scored three ways, and a reader
 * comparing them needs the version to agree. See `board-store.ts`'s `BOARD_SOURCE` docblock for
 * the whole v1-through-v9 history the value carries.
 */
export const BOARD_SOURCE_VERSION = "v9";

/** The league size every persisted board is valued under. `boardRows` recomputes value and tiers
 *  for the caller's own shape; the stored points do not depend on it. */
export const BOARD_TEAM_COUNT = 12;

/** The path segment Fantasy Football Calculator publishes each format's board under
 *  (`/api/v1/adp/<segment>`), spelled the way the feed spells it. */
export type FfcAdpFormat = "ppr" | "half-ppr" | "standard";

export interface BoardFormatSpec {
  readonly format: BoardFormat;
  /** The exact preset the board's points are composed under. */
  readonly rules: ScoringRules;
  /** The label a screen prints: "PPR", "Half PPR", "Standard". */
  readonly label: string;
  /** The label inside a basis sentence, lower case where the word is a common noun. */
  readonly basisLabel: string;
  /** `preseason_rankings.source` for this format's own published ADP board. */
  readonly adpSource: string;
  /** `adp_snapshots.format` for this format's daily capture. */
  readonly snapshotFormat: string;
  /** The feed's own path segment for this format. */
  readonly feedFormat: FfcAdpFormat;
}

export const BOARD_FORMAT_SPECS: Readonly<Record<BoardFormat, BoardFormatSpec>> = {
  ppr: {
    format: "ppr",
    rules: PPR_SCORING,
    label: "PPR",
    basisLabel: "PPR",
    adpSource: BENCHMARK_SOURCES.adp,
    snapshotFormat: "ppr_12",
    feedFormat: "ppr",
  },
  half: {
    format: "half",
    rules: HALF_PPR_SCORING,
    label: "Half PPR",
    basisLabel: "half PPR",
    adpSource: BENCHMARK_SOURCES.adpHalf,
    snapshotFormat: "half_12",
    feedFormat: "half-ppr",
  },
  std: {
    format: "std",
    rules: STANDARD_SCORING,
    label: "Standard",
    basisLabel: "standard scoring",
    adpSource: BENCHMARK_SOURCES.adpStd,
    snapshotFormat: "std_12",
    feedFormat: "standard",
  },
};

export function isBoardFormat(value: string): value is BoardFormat {
  return (BOARD_FORMATS as readonly string[]).includes(value);
}

/** The `preseason_projections.source` a format's board is written and read under. */
export function boardSourceFor(format: BoardFormat): string {
  return `commish_board_${BOARD_SOURCE_VERSION}_${format}_${BOARD_TEAM_COUNT}`;
}

/** Which of the three boards a league's own rules read, and whether that was a match or a nearest. */
export interface ResolvedBoardFormat {
  readonly format: BoardFormat;
  /** `true` when every weight agrees with the format's preset; `false` for a custom sheet or TE
   *  premium, in which case `note` says what was chosen and why. */
  readonly exact: boolean;
  /** One sentence for the board's basis line, or `null` on an exact match. */
  readonly note: string | null;
}

function sameWeights(a: ScoringRules, b: ScoringRules): boolean {
  return (Object.keys(b) as (keyof ScoringRules)[]).every((key) => a[key] === b[key]);
}

/** The format whose reception weight is nearest the league's own; a tie goes to the default. */
function nearestByReceptionWeight(pointsPerReception: number): BoardFormat {
  const ordered = [DEFAULT_BOARD_FORMAT, ...BOARD_FORMATS.filter((format) => format !== DEFAULT_BOARD_FORMAT)];
  return ordered.reduce((best, format) => {
    const distance = Math.abs(BOARD_FORMAT_SPECS[format].rules.pointsPerReception - pointsPerReception);
    const bestDistance = Math.abs(BOARD_FORMAT_SPECS[best].rules.pointsPerReception - pointsPerReception);
    return distance < bestDistance ? format : best;
  });
}

/**
 * THE ONE RULE FOR "WHICH BOARD DOES THIS LEAGUE READ" (coordinator's design, item 3). An exact
 * preset reads its own board. Anything else (TE premium, a commissioner's edited sheet) reads the
 * nearest of the three by points per reception, the weight that separates the three formats, and
 * the note says so once in the board's basis line rather than letting a reader assume the board
 * was priced under his own rules.
 */
export function boardFormatForRules(rules: ScoringRules): ResolvedBoardFormat {
  const exact = BOARD_FORMATS.find((format) => sameWeights(rules, BOARD_FORMAT_SPECS[format].rules));
  if (exact !== undefined) return { format: exact, exact: true, note: null };
  const format = nearestByReceptionWeight(rules.pointsPerReception);
  const spec = BOARD_FORMAT_SPECS[format];
  return {
    format,
    exact: false,
    note:
      `Your league's scoring matches none of the three published formats (${rules.pointsPerReception} points a reception` +
      `${rules.teReceptionBonus > 0 ? `, a ${rules.teReceptionBonus} tight end bonus` : ""}), so this is the ${spec.label} board, ` +
      "the nearest by points per reception.",
  };
}

/** "2026 board, 12-team half PPR": WHICH board a number came from, with no claim about the order
 *  it is printed in. The sheet names itself with this, because a sheet is in the MANAGER's order
 *  and "in board order" would be false the moment he moved somebody. */
export function boardScoringLine(format: BoardFormat, season: number): string {
  return `${season} board, ${BOARD_TEAM_COUNT}-team ${BOARD_FORMAT_SPECS[format].basisLabel}`;
}

/** "2026 board, 12-team half PPR, in board order": the sentence every board surface names itself with. */
export function boardBasisLine(format: BoardFormat, season: number): string {
  return `${boardScoringLine(format, season)}, in board order`;
}
