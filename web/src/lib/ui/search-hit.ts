import type { Position } from '#lib/types/player.ts';

/** One line of the search menu: who he is and where his page is. */
export interface SearchHit {
	id: string;
	name: string;
	position: Position;
	team: string;
	/** His face, which leads the line. */
	headshot: string;
	href: string;
}
