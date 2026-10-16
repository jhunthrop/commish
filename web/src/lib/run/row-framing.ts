/** How a board row frames its rank against the drafts, one rule for every page that draws board rows
 * (the front door's top ten, the board, ADP, a club), so two pages on one run never disagree. Before
 * the run ranks the rest of the season, drafters are compared with our rank ("2 picks later") and
 * the value names the round it ranks in. Once it does, the ADP is the drafts' September order and
 * our rank the rest of the season's: the two are never compared, the ADP stands alone as a fact,
 * and the round goes (the figure and its tint stay). */
import { roundlessVorCell, vorCell, type VorCellProps } from '#lib/ui/heat.ts';
import type { Format } from './schema.ts';

export interface RowFraming {
	/** The Drafters cell compares drafters with our rank. */
	compare: boolean;
	/** The over replacement cell names the round his value ranks in. */
	round: boolean;
}

/** The framing of a board that ranks the full season from the preseason projection. */
export const PRESEASON_FRAMING: RowFraming = { compare: true, round: true };
const REST_OF_SEASON_FRAMING: RowFraming = { compare: false, round: false };

/** A player on a season-long list (Lane 63): his rank is shown as the word, so nothing frames the
 * rank his figure would earn. The ADP stands alone and the round goes, on any board. */
export const HELD_FRAMING: RowFraming = REST_OF_SEASON_FRAMING;

export function rowFraming(format: Pick<Format, 'rosFromWeek'>): RowFraming {
	return format.rosFromWeek === undefined ? PRESEASON_FRAMING : REST_OF_SEASON_FRAMING;
}

/** The over replacement cell as the framing prints it: its round named only where the row names it,
 * the tint kept either way. */
export function framedVorCell(vor: number, round: number, framing: RowFraming): VorCellProps {
	return framing.round ? vorCell(vor, round) : roundlessVorCell(vor, round);
}
