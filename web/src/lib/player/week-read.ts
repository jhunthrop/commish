/** The week-ahead read beside the card (Lane 66v). The read stands whatever the week's published
 * projection does since it was written (Lane 274, founder ruling: projections move on every fantasy site
 * without the read changing); the Proj change tile says the move and the Wk tile the figure at the read.
 * A read the run withheld says it was not written for this game once that game is under way (Lane 160).
 * A withheld read is its caption alone, never under the not-written line, which
 * is said only when the run holds no read for him (Lane 158). The figures are the run's and the API's,
 * each rounded once there: this only compares them. */
import type { components } from '#lib/api/types.ts';
import type { GameHead } from '#lib/league/box/kickoff.ts';
import { weekdayWord } from '#lib/format/date.ts';
import type { ReadsDue, WeekRead } from '#lib/run/schema.ts';
import { CARD } from './card.ts';

/** A nightly in the small hours belongs to the night before: its night is the Eastern day this long
 * before it (research capsules/week/rollover.py NIGHT_RUNS_PAST_MIDNIGHT, ported to both apps). */
export const NIGHT_RUNS_PAST_MIDNIGHT_MS = 6 * 60 * 60 * 1000;

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

/** His game has kicked off or is final: a withheld read's due time has passed. */
function underway(state: ReadGameState): boolean {
	return state === 'kicked_off' || state === 'final';
}

/** A read the run withheld: its caption while his game for the read's week is to come, the
 * not-written line once that game is under way or final. */
function withheldWords(read: WeekRead, card: CardProjection | null): string {
	return card?.week === read.week && underway(card.state) ? CARD.readNotWritten : read.caption;
}

/** The read as the page shows it beside the card's live projection (null until the card has read). */
export function shownWeekRead(read: WeekRead, card: CardProjection | null): ShownRead {
	// A read the run already withheld keeps the run's caption (a status change says when the new one is
	// due) while his game is to come; from kickoff through final that due time has passed, so the place
	// says no read was written for this game (Lane 160, B140).
	if (read.body === null) return { withheld: true, words: withheldWords(read, card) };
	return { withheld: false, body: read.body, caption: read.caption };
}

/** The night a nightly at `at` belongs to, on the Eastern clock: "Tuesday" for Wednesday 05:30 UTC. */
export function nightOf(at: string): string {
	return weekdayWord(new Date(Date.parse(at) - NIGHT_RUNS_PAST_MIDNIGHT_MS).toISOString());
}

/** The read's place when the run holds no read for him: his next game while it is still to come,
 * never "next" for a game under way or final (Lane 158); while the coming week's reads are not yet
 * written, the night of the nightly that writes them (Lane 256, the run's `weekReadsDue`), until the
 * screen's clock (`now`, null before the screen has read one) passes it, when a run that was never
 * published has left the promise standing (Lane 265). A run from before names no instant. */
export function noReadWords(
	state: ReadGameState,
	due: ReadsDue | null,
	now: number | null
): string {
	if (underway(state)) return CARD.readNotWritten;
	if (due?.at === undefined) return CARD.readNotYet;
	if (now !== null && now >= Date.parse(due.at)) return CARD.readNotYet;
	return CARD.readsDue(due.week, nightOf(due.at));
}
