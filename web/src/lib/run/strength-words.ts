/**
 * Schedule strength in words, one source for the schedule page, the clubs page and a club's page.
 * What strength is and what an opponent's figure is are the run's own words (schedule.json's
 * `method`, a slate's `rest.method` and `opponentBasis`, research/nightly/reads/schedule.py), printed
 * as given, so the pages never describe a figure the run has changed (Lane 66n). The method is a noun
 * phrase that carries its own article ("the average of each club's opponents' expected wins for the
 * season, ..."), so these lines never add one.
 *
 * In season the figure is the rest of the season's (Lane 80): the run's games still to play, headed
 * "Rest of season strength". The preseason figure shows only before the first kickoff, headed
 * "Preseason strength". In season on a run from before the rest was written, no strength is shown.
 */
import { windowLabel } from '#lib/format/date.ts';
import { fixed, ordinal } from '#lib/format/number.ts';
import { playedThroughWords, type Reach } from './reach.ts';
import type { Slate } from './schema.ts';

type Window = Pick<Slate, 'window'>;

export type StrengthKind = 'rest' | 'preseason';

/** Each figure's head, as a page names it. */
export const STRENGTH_HEADS: Readonly<Record<StrengthKind, string>> = {
	rest: 'Rest of season strength',
	preseason: 'Preseason strength'
};

/** The schedule grid's narrow column head for each. */
export const STRENGTH_COLUMNS: Readonly<Record<StrengthKind, string>> = {
	rest: 'Rest of season',
	preseason: 'Preseason'
};

/** The strength a page shows for a slate: its kind, the run's tenth, its rank and the run's method
 * and read. */
export interface StrengthView extends Window {
	kind: StrengthKind;
	strength: number;
	rank: number;
	method: string;
}

/** The slate's strength as the page shows it: the preseason figure before the first kickoff, the
 * rest of season's after it, null in season with none (a run from before, or no game left). */
export function strengthView(
	slate: Pick<Slate, 'strength' | 'rank' | 'method' | 'window' | 'rest'>,
	underway: boolean
): StrengthView | null {
	const { window } = slate;
	if (!underway)
		return {
			kind: 'preseason',
			strength: slate.strength,
			rank: slate.rank,
			method: slate.method,
			window
		};
	const rest = slate.rest ?? null;
	return rest === null ? null : { kind: 'rest', ...rest, window };
}

/** "Opponents show expected wins, set before the season.": a club page's basis sentence, from the
 * run's opponent basis ("Expected wins, set before the season"), its read said once under the hero's
 * figure (readWords). */
export function winsBasis(opponentBasis: string): string {
	return `Opponents show ${opponentBasis.charAt(0).toLowerCase()}${opponentBasis.slice(1)}.`;
}

/** "Rest of season strength is the average of each club's remaining opponents' expected wins, ...,
 * read Sep 7.": the schedule and clubs pages' leads. */
function strengthWords(view: StrengthView): string {
	return `${STRENGTH_HEADS[view.kind]} is ${view.method}, read ${windowLabel(view.window)}.`;
}

/** The games a schedule sets back, said where it does so: "weeks 1 to 5 and week 6's Thursday game
 * are played, so faded", or nothing before the first game is in. */
export function playedWords(reach: Reach): string {
	const played = playedThroughWords(reach);
	return played === '' ? '' : `${played}, so faded`;
}

/** The schedule page's lead, two rendered lines on a desk: what strength is and when it was read,
 * then how the grid is ordered, shaded and faded. With no strength to show, the grid keeps the
 * clubs' order and the lead says only what is shaded and faded. */
export function scheduleLead(
	view: StrengthView | null,
	strong: { count: number; atLeast: string },
	reach: Reach
): string {
	const played = playedWords(reach);
	const faded = played === '' ? '' : `, ${played}`;
	const shaded = `the ${String(strong.count)} highest opponents shaded (${strong.atLeast} or more)${faded}.`;
	return view === null
		? `${shaded.charAt(0).toUpperCase()}${shaded.slice(1)}`
		: `${strengthWords(view)} Hardest first, ${shaded}`;
}

/** The clubs page's lead: "Every club's players on our PPR board. Rest of season strength is ...". */
export function clubsLead(formatLabel: string, first: StrengthView | null): string {
	const strength = first ? ` ${strengthWords(first)}` : '';
	return `Every club's players on our ${formatLabel} board.${strength}`;
}

/** A slate's strength as every page prints it: the tenth the run writes (the ruling on the sweep's
 * X9), formatted, never rounded here. */
export function strengthFigure(strength: number): string {
	return fixed(strength, 1);
}

/** "Read Sep 7": when a club's hero figure was read. */
export function readWords(slate: Window): string {
	return `Read ${windowLabel(slate.window)}`;
}

/** A club's schedule rank as a figure and its caption, "10th" and "hardest of 32", the last club
 * the easiest. */
export function hardestFigure(rank: number, of: number): { figure: string; caption: string } {
	return rank === of
		? { figure: '1st', caption: `easiest of ${String(of)}` }
		: { figure: ordinal(rank), caption: `hardest of ${String(of)}` };
}

/** "the hardest of 32", "3rd hardest of 32", "the easiest of 32": a schedule rank where 1 is the
 * hardest. */
export function hardestWords(rank: number, of: number): string {
	if (rank === of) return `the easiest of ${String(of)}`;
	return `${rank === 1 ? 'the hardest' : `${ordinal(rank)} hardest`} of ${String(of)}`;
}
