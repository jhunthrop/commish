/** What a board row or a player page prints for a player the injury capture lists (Lane 63). */
import {
	captureLine,
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

/** The clock a page is built on: the NFL's, until the member's own is known in the browser. */
export const BUILT_ZONE = 'America/New_York';

/** One board view's status words: the capture's sentence for the basis line, and each listed row's. */
export interface BoardStatusWords {
	capture: string;
	rows: Readonly<Record<string, StatusView>>;
}

export function boardStatusWords(
	rows: readonly { id: string; status?: PlayerStatus }[],
	readAt: string,
	restOfSeason: boolean,
	zone: string
): BoardStatusWords {
	const listed = rows.flatMap((row) =>
		row.status === undefined
			? []
			: [[row.id, statusView(row.status, readAt, restOfSeason, zone)] as const]
	);
	return { capture: captureLine(readAt, zone), rows: Object.fromEntries(listed) };
}

/** A player page's status words: the mark and rank word, and the note under his figures. */
export interface PlayerStatusWords {
	view: StatusView;
	note: string;
}

export function playerStatusWords(
	status: PlayerStatus,
	readAt: string,
	restOfSeason: boolean,
	zone: string
): PlayerStatusWords {
	const view = statusView(status, readAt, restOfSeason, zone);
	return { view, note: `${view.line ?? weekNote(status.status)} ${captureLine(readAt, zone)}` };
}

/** The record's method words beside the capture's read. */
export function recordStatusWords(readAt: string, zone: string): string {
	return `${captureLine(readAt, zone)} ${HELD_OUT_METHOD}`;
}
