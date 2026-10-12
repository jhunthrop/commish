import type { BoardRow } from "@research/board/service";
import { ROSTER_SHAPE_LABEL } from "@research/domain/roster";
import { BOARD_FORMAT_SPECS, boardBasisLine } from "@research/projections/preseason/board-formats";
import type { BoardFile } from "../artifacts";
import { boardKeyOf, type BoardVariant } from "../config";

/** The sentence the value, tier and order columns are measured under. */
export function valueBasisOf(variant: BoardVariant): string {
  return `Value over replacement and tiers for a ${variant.teamCount}-team ${ROSTER_SHAPE_LABEL[variant.shape].toLowerCase()} league, ${BOARD_FORMAT_SPECS[variant.format].basisLabel}.`;
}

export function boardFileOf(runId: string, season: number, variant: BoardVariant, rows: readonly BoardRow[]): BoardFile {
  return {
    runId,
    season,
    key: boardKeyOf(variant),
    format: variant.format,
    formatLabel: BOARD_FORMAT_SPECS[variant.format].label,
    shape: variant.shape,
    shapeLabel: ROSTER_SHAPE_LABEL[variant.shape],
    teamCount: variant.teamCount,
    pointsBasis: boardBasisLine(variant.format, season),
    valueBasis: valueBasisOf(variant),
    rows,
  };
}
