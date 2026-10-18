export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'] as const;
export type Position = (typeof POSITIONS)[number];

/** The positions every board carries in draft order, with no projected points and no tier (the
 * 2026-09-05 ruling): kickers and defenses. The list and its test are in run/market.ts, out of the
 * shell's chunk, which carries this file. */
export type MarketPosition = Extract<Position, 'K' | 'DST'>;

/** Who a player is, enough to draw a face, a name and a position pill. */
export interface PlayerRef {
	id: string;
	name: string;
	position: Position;
	positionRank: number;
	team: string;
	headshot: string;
}

/** A row of a format's board: the player and every number the row prints, each with its basis. */
export interface BoardPlayer extends PlayerRef {
	/** Our rank on this board, by points over replacement. */
	ourRank: number;
	/** The round of a 12-team draft his points over replacement rank in, on this board. */
	vorRound: number;
	/** Average draft position across the named sources, or null when no source has him. */
	adp: number | null;
	/** Drafters' ADP less our rank as the run writes it, null without an ADP, absent on an older run. */
	gap?: number | null;
	projected: number;
	/** Projected points over the replacement level at his position. */
	vor: number;
	expectedGames: number;
	/** Null in season: the rest-of-season board gives no range. */
	floor: number | null;
	median: number | null;
	ceiling: number | null;
	/** Tier within his position, 1 is the top. */
	tier: number;
}

/** The scale a range bar is drawn against, shared by every row in one view. */
export interface RangeScale {
	lo: number;
	hi: number;
}
