/** The board's Basis panel, row by row, framed by the row's rule (row-framing.ts). Pure, so the tests
 * read the panel the page prints. */
import { rowFraming } from './row-framing.ts';
import type { Format } from './schema.ts';

/** One row of the board's Basis panel: a colour or column, and what it stands for. */
export interface BasisTerm {
	term: string;
	means: string;
}

export interface BasisFacts {
	format: Pick<Format, 'basis' | 'rosFromWeek'>;
	/** The scoring in words (catalog.ts scoringBasis). */
	scoring: string;
	/** The run is past the season's first kickoff, so the lead names the sort and the season. */
	underway: boolean;
	/** How many players the whole board ranks, the population every tint is counted in. */
	boardSize: number;
	/** The drafts behind this format's ADP and their window: "PPR drafts, Sep 5 to Sep 9". */
	adpBasis: readonly string[];
	/** The rows carry a range. */
	range: boolean;
}

/** The scoring; once the season is underway the order and the tiers (the lead names the sort and
 * the season); the tint against the whole board, by round before the run ranks the rest of the
 * season; below replacement; the drafters' ADP; and last the range, when the rows carry one, so the
 * band that hides its column hides its line. */
export function boardBasisTerms(facts: BasisFacts): BasisTerm[] {
	const { format, boardSize, adpBasis } = facts;
	const framing = rowFraming(format);
	const among = String(boardSize);
	return [
		{ term: 'Scoring', means: facts.scoring },
		...(facts.underway ? [{ term: 'Order', means: format.basis.slice(1).join(', ') }] : []),
		{
			term: 'Green',
			means: framing.round
				? `The round his points over replacement rank in, among ${among}`
				: `Above replacement, deeper the higher he ranks among ${among}`
		},
		{ term: 'Rose', means: 'Below replacement' },
		{
			term: 'Drafters',
			means: `Their ADP from ${adpBasis.join(' and ')}${framing.compare ? ', against our rank' : ''}`
		},
		// Last, so the band that hides the range column hides its line too (BoardView's style).
		...(facts.range ? [{ term: 'Range', means: 'Floor to ceiling' }] : [])
	];
}
