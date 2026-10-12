import { ROSTER_SHAPES } from "@research/domain/roster-shape";
import type { RosterShapeName } from "@research/domain/roster";
import { BOARD_FORMATS, type BoardFormat } from "@research/projections/preseason/board-formats";

/** One board the nightly run writes: a scoring format under a roster shape at a team count. */
export interface BoardVariant {
  readonly format: BoardFormat;
  readonly shape: RosterShapeName;
  readonly teamCount: number;
}

/** The team counts a drafter's league is read at. The stored points are one board per format; what
 *  moves with the league size is the draft value half (replacement level, tiers, the value order). */
export const NIGHTLY_TEAM_COUNTS: readonly number[] = [8, 10, 12, 14, 16];

/** Every variant, format-major so the files sort the way a reader browses them. */
export const BOARD_VARIANTS: readonly BoardVariant[] = BOARD_FORMATS.flatMap((format) =>
  (Object.keys(ROSTER_SHAPES) as RosterShapeName[]).flatMap((shape) => NIGHTLY_TEAM_COUNTS.map((teamCount) => ({ format, shape, teamCount }))),
);

/** `ppr-12` for the standard shape (spec §2.1's own example), `ppr-superflex-12` for another. */
export function boardKeyOf({ format, shape, teamCount }: BoardVariant): string {
  return shape === "standard" ? `${format}-${teamCount}` : `${format}-${shape}-${teamCount}`;
}

/** The board a player page and the capsule writer read: PPR, the standard shape, twelve teams. */
export const PAGE_BOARD_VARIANT: BoardVariant = { format: "ppr", shape: "standard", teamCount: 12 };

export const NIGHTLY_CONFIG = {
  /** The local bucket root a run is written under when no `--out` is given (`<root>/runs/<runId>/`), relative to the working directory. Gitignored. */
  defaultOutputDir: "nightly-out",
  /** The environment variable naming the output directory, overriding the default. */
  outputDirEnv: "NIGHTLY_OUTPUT_DIR",
  /** Pull figures printed beside a capsule on the player page (the approved mock shows three). */
  pullFiguresPerCapsule: 3,
  gates: {
    /** The largest drop in a held-out season's rank correlation, against the last clean run, that
     *  does not fail the run. Stored boards for a held-out season move only when the fit rewrites
     *  them, so any drop past rounding is a real regression. */
    maxHeldOutRankCorrelationDrop: 0.005,
    /** A board must carry at least this many players per starting slot league-wide, so the bench
     *  rounds of the deepest league the variant names still have a pool to draft from. */
    depthPlayersPerRosterSpot: 1,
  },
} as const;
