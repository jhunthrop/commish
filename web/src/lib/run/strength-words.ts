/**
 * Schedule strength in words, one source for the schedule page, the clubs page and a club's page.
 * The run's method is a noun phrase that carries its own article ("the average of its opponents'
 * expected wins for the season, ..."), so these lines print it as given and never add one.
 */
import { windowLabel } from '#lib/format/date.ts';
import { hardestWords } from '#lib/format/number.ts';
import type { Slate } from './schema.ts';

type Basis = Pick<Slate, 'method' | 'window'>;

/** "the average of its opponents' expected wins ..., read Sep 7". */
export function strengthBasis(slate: Basis): string {
	return `${slate.method}, read ${windowLabel(slate.window)}`;
}

/** The weeks a schedule sets back, said where it does so: "weeks 1 to 5 are played, so faded",
 * or nothing before the first kickoff. */
export function playedWords(played: number): string {
	if (played === 0) return '';
	return played === 1
		? 'week 1 is played, so faded'
		: `weeks 1 to ${String(played)} are played, so faded`;
}

/** The schedule page's lead: "Strength is the average of ..., read Sep 7 · hardest first · ...". */
export function scheduleLead(
	slate: Basis,
	opponentBasis: string,
	strong: { count: number; atLeast: string },
	played: number
): string {
	const faded = played === 0 ? '' : ` · ${playedWords(played)}`;
	return `Strength is ${strengthBasis(slate)} · hardest first · each week shows the opponent's ${opponentBasis.toLowerCase()}, shaded for the ${String(strong.count)} highest of the 32 (${strong.atLeast} or more)${faded}`;
}

/** The clubs page's lead: "Every club's players on our PPR board · schedule strength is ...". */
export function clubsLead(formatLabel: string, first: Basis | undefined): string {
	const strength = first ? ` · schedule strength is ${strengthBasis(first)}` : '';
	return `Every club's players on our ${formatLabel} board${strength}`;
}

/** A club's figure caption: "the average of ..., the hardest of 32, read Sep 7". */
export function clubCaption(slate: Basis & Pick<Slate, 'rank'>, of: number): string {
	return `${slate.method}, ${hardestWords(slate.rank, of)}, read ${windowLabel(slate.window)}`;
}
