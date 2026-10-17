/** The basis of a page of board rows, said once (Lane 66n): what the order is, where the ADP comes
 * from, what the gap is and how far the season's columns reach, in sentences short enough that the
 * whole stays within five rendered lines on a phone. The board, ADP, a club and the front door print
 * it; the run's injury capture follows it, said on the member's clock. Pure, so the tests read the
 * words a page prints. */
import { monthDayLabel } from '#lib/format/date.ts';
import type { FiguresReach } from './rest-words.ts';
import type { Format } from './schema.ts';

/** One sentence of the basis. A sentence about columns the phone does not draw is not said there. */
export interface BasisPart {
	text: string;
	phone: boolean;
}

export interface BasisFacts {
	format: Pick<Format, 'label' | 'teams' | 'rosFromWeek' | 'refreshedAt'>;
	season: number;
	/** Our order first (the board, a club, the front door) or the drafters' (ADP). */
	order: 'board' | 'adp';
	/** A position view's position, whose tiers its bands draw. */
	position?: string | null;
	/** The drafts behind the format's ADP and their window: "PPR drafts, Sep 9". */
	adpBasis: readonly string[];
	/** The rows carry the drafters' gap to our rank (row-framing.ts). */
	gap: boolean;
	/** How far this season's GP and A game reach, null before the first kickoff. */
	reach: FiguresReach | null;
	/** ADP's count of ranked players the drafts do not take yet. */
	noAdp?: number;
}

/** The gap's one definition, on every page that prints it, and the column head's title. */
export const GAP_WORDS =
	"Gap, drafters' ADP less our rank: green when they wait, rose when they reach.";

/** "Our PPR board, 2026 season, by points over replacement in a 12-team league.", or the rest of the
 * season from its week once the run ranks the rest. */
function ourBoard(facts: BasisFacts): string {
	const { format, season } = facts;
	const league = `for ${String(format.teams)} teams`;
	if (format.rosFromWeek !== undefined && format.refreshedAt !== undefined) {
		return `Our ${format.label} board, the rest of the ${String(season)} season from week ${String(format.rosFromWeek)}, by points over replacement ${league}, refreshed ${monthDayLabel(format.refreshedAt)}.`;
	}
	return `Our ${format.label} board, by points over replacement ${league}.`;
}

/** "GP and A game are this season's, through week 5.", naming the scoring when it is another's. */
function seasonColumns(format: Pick<Format, 'label'>, reach: FiguresReach): string {
	const scoring = reach.scoring === format.label ? '' : `, scored in ${reach.scoring}`;
	const through = reach.through === 0 ? '' : `, through week ${String(reach.through)}`;
	return `GP and A game are this season's${scoring}${through}.`;
}

export function boardBasis(facts: BasisFacts): BasisPart[] {
	const { format } = facts;
	const drafts = facts.adpBasis.join(' and ');
	const parts: BasisPart[] =
		facts.order === 'adp'
			? [
					{ text: `ADP from ${drafts}, earliest first.`, phone: true },
					{ text: ourBoard(facts), phone: true }
				]
			: [
					{ text: ourBoard(facts), phone: true },
					...(facts.position
						? [{ text: `Tiers are drawn within ${facts.position}.`, phone: true }]
						: []),
					{ text: `ADP from ${drafts}.`, phone: true }
				];
	if (facts.gap) parts.push({ text: GAP_WORDS, phone: true });
	if (facts.reach !== null) parts.push({ text: seasonColumns(format, facts.reach), phone: false });
	if (facts.noAdp !== undefined && facts.noAdp > 0) {
		parts.push({
			text: `${String(facts.noAdp)} players on our board have no ADP yet.`,
			phone: false
		});
	}
	return parts;
}
