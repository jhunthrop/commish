/** What a board row, a player page, the league page and the record print for a player the injury
 * capture lists (Lane 63). Every function is said on a clock: the page's build (the Eastern zone at
 * the build's instant), then the member's own once the page is live (run/live-status.svelte.ts). */
import {
	captureLine,
	captureShort,
	designationWord,
	rankWord,
	returningMark,
	calendarDay,
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
	/** The chip in the few characters a tight row has (the trade rows, Lane 268): "Q", "Out", "Back
	 * Sun"; null where his position pill already says it ("RB IR"). Left out where no tight row draws
	 * him; such a chip prints its mark. */
	short?: string | null;
	/** Drawn as a loss: a status that keeps him out. */
	sits: boolean;
	/** A week's question (questionable, or due back this week, Lane 153): no reason on its own to sit
	 * him. */
	question?: true;
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
			mark: seasonLongMark(status, zone),
			sits: true,
			line: draftOrder
				? draftOrderLongLine(status, capture.readAt, zone)
				: seasonLongLine(status, capture.readAt, restOfSeason, zone)
		};
	}
	// A return day on a week's designation: due back this week (Lane 153).
	const back = status.returning;
	return {
		rank: null,
		mark: back === undefined ? designationWord(status.status) : returningMark(back),
		sits: sitsHim(status.status),
		line: null,
		...(status.status === 'questionable' ? { question: true as const } : {})
	};
}

/** A week's designation as a player page says it: "Doubtful on the latest report, which does not
 * move his place on our board.", or for one due back this week "Expected back Sun Oct 25 on the
 * latest report, ..." (Lane 153). The report may be a week old by the time the page is read. */
export function weekNote(status: PlayerStatus): string {
	const word =
		status.returning !== undefined && !status.seasonLong
			? `Expected back ${calendarDay(status.returning, true)}`
			: designationWord(status.status);
	return `${word} on the latest report, which does not move his place on our board.`;
}

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
	return { view, note: `${view.line ?? weekNote(status)} ${capture}` };
}
