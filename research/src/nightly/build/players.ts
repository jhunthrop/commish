import type { BoardRow } from "@research/board/service";
import type { StoredPlayerCapsule } from "@research/capsules/store";
import { BOARD_FORMATS, BOARD_FORMAT_SPECS, boardBasisLine, type BoardFormat } from "@research/projections/preseason/board-formats";
import type { IndexEntry, PlayerAdpLine, PlayerCapsuleArtifact, PlayerFile, PlayerFormatLine } from "../artifacts";
import { NIGHTLY_CONFIG, type BoardVariant } from "../config";
import type { AdpCapture } from "../reads/adp";
import { valueBasisOf } from "./boards";
import { pullFiguresOf } from "./pull-figures";

/** Each format's page board (the standard shape at the page's team count): format, then player id
 *  to row, in served order. */
export type PageBoards = ReadonlyMap<BoardFormat, ReadonlyMap<string, BoardRow>>;

export function pageBoardsOf(rowsByFormat: ReadonlyMap<BoardFormat, readonly BoardRow[]>): PageBoards {
  return new Map([...rowsByFormat].map(([format, rows]) => [format, new Map(rows.map((row) => [row.playerId, row] as const))] as const));
}

function formatLineOf(format: BoardFormat, row: BoardRow, season: number, variant: BoardVariant): PlayerFormatLine {
  return {
    format,
    projectedPoints: row.projectedPoints,
    floorPoints: row.floorPoints,
    medianPoints: row.medianPoints,
    ceilingPoints: row.ceilingPoints,
    overallRank: row.overallRank,
    positionRank: row.positionRankInValue,
    tier: row.tier,
    valueOverReplacement: row.valueOverReplacement,
    marketOrderRank: row.marketOrderRank,
    basis: `${boardBasisLine(format, season)}. ${valueBasisOf({ ...variant, format })}`,
  };
}

function adpLinesOf(playerId: string, adp: readonly AdpCapture[]): readonly PlayerAdpLine[] {
  return adp.flatMap((capture) => {
    const value = capture.adpByPlayerId.get(playerId);
    if (value === undefined || capture.capturedAt === null) return [];
    return [{ format: capture.format, adp: value, source: capture.source, capturedAt: capture.capturedAt.toISOString() }];
  });
}

function capsuleOf(stored: StoredPlayerCapsule | undefined): PlayerCapsuleArtifact | null {
  if (stored === undefined) return null;
  return {
    bodyCompact: stored.bodyCompact,
    bodyFull: stored.bodyFull,
    source: stored.source,
    pullFigures: pullFiguresOf(stored.bodyFull, NIGHTLY_CONFIG.pullFiguresPerCapsule),
  };
}

/** Every player on any format's page board, in the PPR board's order first, each once. */
export function pagePlayerIds(boards: PageBoards): readonly string[] {
  const ids = new Set<string>();
  for (const format of BOARD_FORMATS) for (const playerId of boards.get(format)?.keys() ?? []) ids.add(playerId);
  return [...ids];
}

export interface PlayerPageInputs {
  readonly runId: string;
  readonly season: number;
  readonly pageVariant: BoardVariant;
  readonly boards: PageBoards;
  readonly adp: readonly AdpCapture[];
  readonly capsules: ReadonlyMap<string, StoredPlayerCapsule>;
}

/** One player's page, every format inlined, from the rows already read. */
export function playerFileOf(playerId: string, inputs: PlayerPageInputs): PlayerFile {
  const rowsByFormat = BOARD_FORMATS.flatMap((format) => {
    const row = inputs.boards.get(format)?.get(playerId);
    return row === undefined ? [] : [[format, row] as const];
  });
  const [, identity] = rowsByFormat[0] ?? [];
  if (identity === undefined) throw new Error(`player ${playerId} is on no page board; pagePlayerIds and playerFileOf disagree.`);
  return {
    runId: inputs.runId,
    season: inputs.season,
    id: playerId,
    name: identity.name,
    team: identity.team,
    position: identity.position,
    headshotUrl: identity.headshotUrl,
    byeWeek: identity.byeWeek,
    formats: rowsByFormat.map(([format, row]) => formatLineOf(format, row, inputs.season, inputs.pageVariant)),
    adp: adpLinesOf(playerId, inputs.adp),
    capsule: capsuleOf(inputs.capsules.get(playerId)),
    reasons: identity.reasons,
  };
}

export function indexEntryOf(file: PlayerFile): IndexEntry {
  return { id: file.id, name: file.name, team: file.team, position: file.position };
}

/** The format labels a reader of the ADP page sees, keyed by format. */
export function formatLabel(format: BoardFormat): string {
  return BOARD_FORMAT_SPECS[format].label;
}
