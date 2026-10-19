/** The week-ahead read beside the card (Lane 66v). The read quotes the published projection it was
 * written with, in PPR, as the card prints it (the run's `projection`); once the card's live read prints
 * another figure for that week, the read is withheld behind the run's words for it (`movedCaption`) and
 * the season read shows beneath it. The figures are the run's and the API's, each rounded once there:
 * this only compares them. */
import type { components } from '#lib/api/types.ts';
import type { WeekRead } from '#lib/run/schema.ts';

/** The card's live projection for a week: its scoring, and the figure it prints (null for none). */
export interface CardProjection {
	week: number;
	scoring: components['schemas']['ProjectionScoring']['format'];
	points: number | null;
}

/** What the page shows of the read: its body (null when withheld) and the caption over it. */
export interface ShownRead {
	body: string | null;
	caption: string;
}

/** The read as the page shows it beside the card's live projection (null until the card has read). */
export function shownWeekRead(read: WeekRead, card: CardProjection | null): ShownRead {
	const built = { body: read.body, caption: read.caption };
	// A read the run already withheld keeps the run's caption (a status change says when the new one is due).
	if (read.body === null) return built;
	if (card?.scoring !== 'ppr' || card.week !== read.week) return built;
	if (read.projection === undefined || read.movedCaption === undefined) return built;
	return card.points === read.projection ? built : { body: null, caption: read.movedCaption };
}
