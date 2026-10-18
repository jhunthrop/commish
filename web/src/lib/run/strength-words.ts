/**
 * Schedule strength in words, one source for the schedule page, the clubs page and a club's page.
 * What strength is and what an opponent's figure is are the run's own words (schedule.json's
 * `method` and `opponentBasis`, research/nightly/reads/schedule.py), printed as given, so the pages
 * never describe a figure the run has changed (Lane 66n). The method is a noun phrase that carries its
 * own article ("the average of its opponents' expected wins for the season, ..."), so these lines
 * never add one.
 */
import { windowLabel } from '#lib/format/date.ts';
import { ordinal } from '#lib/format/number.ts';
import type { Slate } from './schema.ts';

type Basis = Pick<Slate, 'method' | 'window'>;
type Window = Pick<Slate, 'window'>;

/** "Opponents show expected wins, set before the season.": a club page's basis sentence, from the
 * run's opponent basis ("Expected wins, set before the season"), its read said once under the hero's
 * figure (readWords). */
export function winsBasis(opponentBasis: string): string {
	return `Opponents show ${opponentBasis.charAt(0).toLowerCase()}${opponentBasis.slice(1)}.`;
}

/** "Strength is the average of its opponents' expected wins for the season, ..., read Sep 7.": the
 * schedule and clubs pages' leads. */
function strengthWords(slate: Basis): string {
	return `Strength is ${slate.method}, read ${windowLabel(slate.window)}.`;
}

/** The weeks a schedule sets back, said where it does so: "weeks 1 to 5 are played, so faded",
 * or nothing before the first kickoff. */
export function playedWords(played: number): string {
	if (played === 0) return '';
	return played === 1
		? 'week 1 is played, so faded'
		: `weeks 1 to ${String(played)} are played, so faded`;
}

/** The schedule page's lead, two rendered lines on a desk: what strength is and when it was read,
 * then how the grid is ordered, shaded and faded. */
export function scheduleLead(
	slate: Basis,
	strong: { count: number; atLeast: string },
	played: number
): string {
	const faded = played === 0 ? '' : `, ${playedWords(played)}`;
	return `${strengthWords(slate)} Hardest first, the ${String(strong.count)} highest opponents shaded (${strong.atLeast} or more)${faded}.`;
}

/** The clubs page's lead: "Every club's players on our PPR board. Strength is ...". */
export function clubsLead(formatLabel: string, first: Basis | undefined): string {
	const strength = first ? ` ${strengthWords(first)}` : '';
	return `Every club's players on our ${formatLabel} board.${strength}`;
}

/** A club's hero figure's caption, four words, its read said under it. */
export const CLUB_FIGURE_CAPTION = "Opponents' average expected wins";

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
