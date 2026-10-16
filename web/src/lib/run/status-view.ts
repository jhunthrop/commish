/** What a board row or a player page prints for a player the injury capture lists (Lane 63). */
import {
	designationMark,
	designationWord,
	rankWord,
	seasonLongLine,
	sitsHim
} from '#lib/format/designation.ts';
import type { PlayerStatus } from './schema.ts';

export interface StatusView {
	/** The word his rank shows as, for a season-long status: "IR". Null for a week's designation. */
	rank: string | null;
	/** The chip: the week's mark with when the capture read it, or the season-long status's word. */
	mark: string;
	/** Drawn as a loss: a status that keeps him out. */
	sits: boolean;
	/** The sentence a season-long status carries, null for a week's. */
	line: string | null;
}

/** His status as a row and a page print it, on the zone's clock. */
export function statusView(
	status: PlayerStatus,
	readAt: string,
	restOfSeason: boolean,
	zone: string
): StatusView {
	if (status.seasonLong) {
		return {
			rank: rankWord(status.status),
			mark: designationWord(status.status),
			sits: true,
			line: seasonLongLine(status, readAt, restOfSeason, zone)
		};
	}
	return {
		rank: null,
		mark: designationMark(status.status, readAt, zone),
		sits: sitsHim(status.status),
		line: null
	};
}

/** A week's designation as a player page says it: "Doubtful this week, which does not move his place
 * on our board." */
export function weekNote(status: PlayerStatus['status']): string {
	return `${designationWord(status)} this week, which does not move his place on our board.`;
}

/** The record's method words beside the capture's: the frozen boards it grades never moved anyone. */
export const HELD_OUT_METHOD =
	"The board puts a player on a season-long list below the available players at his position. The record grades each week's board as it froze, before that move.";
