/** The week-ahead read beside the card (Lane 66v). The read quotes the published projection it was
 * written with, in PPR, as the card prints it (the run's `projection`); while his game is still to come
 * and the week's published projection has moved from it by the Proj change tile's threshold (card.ts
 * projectionMoved, Lane 162), the read is withheld behind the run's words for it (`movedCaption`). From kickoff through final the read written for the week stands
 * (Lane 158), its byline marked with the figure it was written at and the card's when that moved past the
 * threshold (Lane 222, B185), and a read the run withheld says it was not written for this game (Lane 160).
 * A withheld read is its caption alone, never under the not-written line, which
 * is said only when the run holds no read for him (Lane 158). The figures are the run's and the API's,
 * each rounded once there: this only compares them. */
import type { components } from '#lib/api/types.ts';
import type { GameHead } from '#lib/league/box/kickoff.ts';
import type { WeekRead } from '#lib/run/schema.ts';
import { CARD, projectionMoved } from './card.ts';
import { movedByline } from './read-byline.ts';

/** His game's state at the screen's clock, by the screen's one rule (kickoff.ts lineState), null for
 * a bye or a week with no game held. */
export type ReadGameState = GameHead['state'] | null;

/** The card's live projection for a week: its scoring, the week's published projection (null for
 * none) and his game's state at the card's clock. */
export interface CardProjection {
	week: number;
	scoring: components['schemas']['ProjectionScoring']['format'];
	points: number | null;
	state: ReadGameState;
}

/** What the page shows of the read: the read with its caption, or a withheld read's caption alone. */
export type ShownRead =
	{ withheld: false; body: string; caption: string } | { withheld: true; words: string };

/** The read's section as the page names it: the week it was written for, never "the week ahead",
 * which a week already played is not (Lane 95, B16). */
export function weekReadLabel(read: Pick<WeekRead, 'week'>): string {
	return `Our read for week ${String(read.week)}`;
}

/** His game has kicked off or is final: the read written for the week stands. */
function underway(state: ReadGameState): boolean {
	return state === 'kicked_off' || state === 'final';
}

/** A read the run withheld: its caption while his game for the read's week is to come, the
 * not-written line once that game is under way or final. */
function withheldWords(read: WeekRead, card: CardProjection | null): string {
	return card?.week === read.week && underway(card.state) ? CARD.readNotWritten : read.caption;
}

/** Whether the page withholds the read for the card's projection having moved (Lane 165 fix round 1,
 * M2): the one test shownWeekRead and the Wk tile's "Proj at the read" share. A read the run withheld,
 * or one from before the moved caption, is never withheld here. */
export function movedPastRead(
	read: Pick<WeekRead, 'body' | 'projection' | 'movedCaption' | 'week'>,
	card: CardProjection | null
): boolean {
	if (read.body === null || card?.scoring !== 'ppr' || card.week !== read.week) return false;
	if (underway(card.state)) return false;
	if (read.projection === undefined || read.movedCaption === undefined) return false;
	return projectionMoved(card.points, read.projection);
}

/** The figures a read under way is marked with (Lane 222, B185): the one it quotes and the one the card
 * holds as of his kickoff, when they are a move past the tile's threshold apart; null otherwise. From
 * kickoff the read stands, so a move is said in its byline, never silent. */
function movedUnderway(
	read: Pick<WeekRead, 'projection' | 'week'>,
	card: CardProjection | null
): { quoted: number; now: number } | null {
	if (card?.scoring !== 'ppr' || card.week !== read.week || !underway(card.state)) return null;
	const quoted = read.projection;
	if (quoted === null || quoted === undefined || card.points === null) return null;
	return projectionMoved(card.points, quoted) ? { quoted, now: card.points } : null;
}

/** The read as the page shows it beside the card's live projection (null until the card has read). */
export function shownWeekRead(read: WeekRead, card: CardProjection | null): ShownRead {
	// A read the run already withheld keeps the run's caption (a status change says when the new one is
	// due) while his game is to come; from kickoff through final that due time has passed, so the place
	// says no read was written for this game (Lane 160, B140).
	if (read.body === null) return { withheld: true, words: withheldWords(read, card) };
	const moved = movedUnderway(read, card);
	if (moved !== null) {
		const caption = movedByline(read.writtenAt, moved.quoted, moved.now);
		return { withheld: false, body: read.body, caption };
	}
	const built = { withheld: false, body: read.body, caption: read.caption } as const;
	// One threshold with the Proj change tile (Lane 162, D04): a move under it shows the read.
	return movedPastRead(read, card) && read.movedCaption !== undefined
		? { withheld: true, words: read.movedCaption }
		: built;
}

/** The read's place when the run holds no read for him: his next game while it is still to come,
 * never "next" for a game under way or final (Lane 158). */
export function noReadWords(state: ReadGameState): string {
	return underway(state) ? CARD.readNotWritten : CARD.readNotYet;
}
