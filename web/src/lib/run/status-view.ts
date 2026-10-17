/** What a board row, a player page, the league page and the record print for a player the injury
 * capture lists (Lane 63). Every function is said on a clock: the page's build (the Eastern zone at
 * the build's instant), then the member's own once the page is live (run/live-status.svelte.ts). */
import {
	captureLine,
	captureShort,
	designationWord,
	rankWord,
	seasonLongMark,
	draftOrderLongLine,
	seasonLongLine,
	sitsHim,
	type CaptureStamp
} from '#lib/format/designation.ts';
import type { PlayerStatus } from './schema.ts';

export interface StatusView {
	/** The word his rank shows as, for a season-long status: "IR". Null for a week's designation. */
	rank: string | null;
	/** The chip, the shared pill's (StatusPill): the week's designation ("Questionable"), or the
	 * season-long status with its start ("IR since Sep 22"). The capture's read is said once, in the
	 * page's basis. */
	mark: string;
	/** Drawn as a loss: a status that keeps him out. */
	sits: boolean;
	/** The sentence a season-long status carries, null for a week's. */
	line: string | null;
}

/** The clock the words are said on, and what the board's figures are. */
export interface Saying {
	capture: CaptureStamp;
	/** The board ranks the rest of the season (its sentence names that figure). */
	restOfSeason: boolean;
	zone: string;
	/** The instant the words are said at, for whether the capture is behind. */
	now: number;
}

/** His status as a row and a page print it. */
export function statusView(status: PlayerStatus, saying: Saying, draftOrder = false): StatusView {
	const { capture, restOfSeason, zone } = saying;
	if (status.seasonLong) {
		return {
			rank: rankWord(status.status),
			mark: seasonLongMark(status, capture.readAt, zone),
			sits: true,
			line: draftOrder
				? draftOrderLongLine(status, capture.readAt, zone)
				: seasonLongLine(status, capture.readAt, restOfSeason, zone)
		};
	}
	return {
		rank: null,
		mark: designationWord(status.status),
		sits: sitsHim(status.status),
		line: null
	};
}

/** A week's designation as a player page says it: "Doubtful on the latest report, which does not
 * move his place on our board." The report may be a week old by the time the page is read. */
export function weekNote(status: PlayerStatus['status']): string {
	return `${designationWord(status)} on the latest report, which does not move his place on our board.`;
}

/** The record's method words beside the capture's: the frozen boards it grades never moved anyone. */
export const HELD_OUT_METHOD =
	"The board puts a player on a season-long list below the available players at his position. The record grades each week's board as it froze, before that move.";

/** The clock a page is built on: the NFL's, until the member's own is known in the browser. */
export const BUILT_ZONE = 'America/New_York';

/** One board's status words: the capture's sentence for the basis line, and each listed row's. */
export interface BoardStatusWords {
	capture: string;
	rows: Readonly<Record<string, StatusView>>;
}

/** A row the status words are said for: a kicker's or a defense's (in draft order) carries no figure
 * of ours, so his season-long line names none. */
export interface ListedRow {
	id: string;
	status?: PlayerStatus;
	orderBasis?: 'projection' | 'market';
}

export function boardStatusWords(rows: readonly ListedRow[], saying: Saying): BoardStatusWords {
	const listed = rows.flatMap((row) =>
		row.status === undefined
			? []
			: [[row.id, statusView(row.status, saying, row.orderBasis === 'market')] as const]
	);
	return {
		capture: captureShort(saying.capture, saying.now, saying.zone),
		rows: Object.fromEntries(listed)
	};
}

/** A player page's status words: the mark and rank word, and the note under his figures. */
export interface PlayerStatusWords {
	view: StatusView;
	note: string;
}

export function playerStatusWords(status: PlayerStatus, saying: Saying): PlayerStatusWords {
	const view = statusView(status, saying);
	const capture = captureLine(saying.capture, saying.now, saying.zone);
	return { view, note: `${view.line ?? weekNote(status.status)} ${capture}` };
}

/** The record's method words beside the capture's read. */
export function recordStatusWords(saying: Saying): string {
	return `${captureLine(saying.capture, saying.now, saying.zone)} ${HELD_OUT_METHOD}`;
}
