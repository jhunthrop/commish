export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'] as const;
export type Position = (typeof POSITIONS)[number];

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
	projected: number;
	/** Projected points over the replacement level at his position. */
	vor: number;
	expectedGames: number;
	floor: number;
	median: number;
	ceiling: number;
	/** Tier within his position, 1 is the top. */
	tier: number;
}

/** The scale a range bar is drawn against, shared by every row in one view. */
export interface RangeScale {
	lo: number;
	hi: number;
}
