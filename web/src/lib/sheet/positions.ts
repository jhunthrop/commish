import type { Position } from '#lib/types/player.ts';

/** A position's players as a count reads them: "6 WRs", "3 defenses". */
export const POSITION_GROUP: Readonly<Record<Position, string>> = {
	QB: 'QBs',
	RB: 'RBs',
	WR: 'WRs',
	TE: 'TEs',
	K: 'kickers',
	DST: 'defenses'
};
