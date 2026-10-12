import type { BoardRow } from "@research-ts/board/service";
import type { Position } from "@research-ts/domain/player";
import type { RosterShapeName } from "@research-ts/domain/roster";
import type { BoardReason } from "@research-ts/projections/preseason/board";
import type { BoardFormat } from "@research-ts/projections/preseason/board-formats";

/**
 * THE RUN FORMAT (spec §2.1): what one nightly run writes under `runs/<runId>/`, and what the web
 * build prerenders from. Every number a page prints arrives with the sentence that names its basis
 * in the same object, which is what the basis gate checks (`gates.ts`).
 */

/** `boards/<format>-<teams>.json`, `boards/<format>-<shape>-<teams>.json`. */
export interface BoardFile {
  readonly runId: string;
  readonly season: number;
  readonly key: string;
  readonly format: BoardFormat;
  readonly formatLabel: string;
  readonly shape: RosterShapeName;
  readonly shapeLabel: string;
  readonly teamCount: number;
  /** "2026 board, 12-team PPR, in board order": what the projected points are. */
  readonly pointsBasis: string;
  /** What the value, tier and order columns are measured against: this league size and shape. */
  readonly valueBasis: string;
  /** In served order (`overallRank`), market-order rows last, exactly as the board service returns. */
  readonly rows: readonly BoardRow[];
}

/** One format's projection on a player page, with its basis. */
export interface PlayerFormatLine {
  readonly format: BoardFormat;
  readonly projectedPoints: number | null;
  readonly floorPoints: number | null;
  readonly medianPoints: number | null;
  readonly ceilingPoints: number | null;
  readonly overallRank: number | null;
  readonly positionRank: number | null;
  readonly tier: number | null;
  readonly valueOverReplacement: number | null;
  readonly marketOrderRank: number | null;
  readonly basis: string;
}

/** One ADP reading on a player page, with the source it was read from. */
export interface PlayerAdpLine {
  readonly format: BoardFormat;
  readonly adp: number;
  readonly source: string;
  readonly capturedAt: string;
}

/** A number lifted out of the capsule prose to print large beside it, exactly as the prose prints it. */
export interface PullFigure {
  readonly text: string;
  /** The sentence it was lifted from, so the page can caption it in the writer's own words. */
  readonly sentence: string;
}

export interface PlayerCapsuleArtifact {
  readonly bodyCompact: string;
  readonly bodyFull: string;
  readonly source: "llm" | "template";
  readonly pullFigures: readonly PullFigure[];
}

/** `players/<id>.json`: the page of one player, every format inlined. */
export interface PlayerFile {
  readonly runId: string;
  readonly season: number;
  readonly id: string;
  readonly name: string;
  readonly team: string;
  readonly position: Position;
  readonly headshotUrl: string | null;
  readonly byeWeek: number | null;
  readonly formats: readonly PlayerFormatLine[];
  readonly adp: readonly PlayerAdpLine[];
  readonly capsule: PlayerCapsuleArtifact | null;
  readonly reasons: readonly BoardReason[];
}

/** `adp.json`: the latest capture of each format's ADP, with its source named. */
export interface AdpFile {
  readonly runId: string;
  readonly season: number;
  readonly formats: readonly {
    readonly format: BoardFormat;
    readonly formatLabel: string;
    readonly source: string;
    readonly capturedAt: string | null;
    readonly players: readonly { readonly id: string; readonly adp: number }[];
  }[];
}

/** `record.json`: the prospective register's running score, the method on the page. */
export interface RecordFile {
  readonly runId: string;
  readonly season: number;
  readonly method: string;
  readonly columns: readonly {
    readonly boardSource: string;
    readonly role: "served" | "shadow" | null;
    readonly column: string;
    readonly weeks: number;
    readonly spearman: number | null;
    readonly meanAbsoluteRankError: number | null;
  }[];
}

/** `index.json`: what the search box loads. */
export interface IndexEntry {
  readonly id: string;
  readonly name: string;
  readonly team: string;
  readonly position: Position;
}

export type StepStatus = "ran" | "skipped" | "failed";

export interface StepRecord {
  readonly name: string;
  readonly status: StepStatus;
  readonly summary: string;
}

export interface GateRecord {
  readonly gate: string;
  readonly passed: boolean;
  /** Named reasons, one per failure, e.g. `board_depth_short:ppr-12:TE`. Empty when passed. */
  readonly reasons: readonly string[];
  readonly summary: string;
}

export interface HeldOutScore {
  readonly season: number;
  readonly rankCorrelation: number | null;
  readonly sampleSize: number;
}

export interface ArtifactRecord {
  readonly key: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** `manifest.json`: everything about the run, written last. */
export interface Manifest {
  readonly runId: string;
  readonly status: "passed" | "failed";
  readonly season: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly steps: readonly StepRecord[];
  readonly gates: readonly GateRecord[];
  readonly heldOut: readonly HeldOutScore[];
  readonly counts: { readonly boards: number; readonly players: number; readonly capsules: number; readonly adpFormats: number };
  readonly artifacts: readonly ArtifactRecord[];
}
