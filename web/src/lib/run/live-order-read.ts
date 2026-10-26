/** The order a page reads at its clock (Lane 220, live-order.ts): the public order the Rankings read,
 * for the board's 12 teams with no league, and the lead its basis says in place of the run's board
 * sentence, with the time it was read. Loaded by a page's script after its first paint, so a page
 * carries none of it until then. */
import { answerReadAt, liveLeadPart, shapeWords } from '#lib/front/live-board.ts';
import { orderApi } from '#lib/order/api.ts';
import type { BasisPart } from './board-basis.ts';
import { ORDER_MAX_ROWS, livePlaces, type LivePlace } from './live-order.ts';

export interface OrderRead {
	places: ReadonlyMap<string, LivePlace>;
	lead: BasisPart;
}

/** The order's places for the players whose name or club holds `q` (every player with none), and
 * the lead for a board of `teams` teams, its time said in `zone`; `landed` is the page's clock. */
export async function readOrder(
	q: string | null,
	teams: number,
	zone: string,
	landed: () => number
): Promise<OrderRead> {
	const answer = await orderApi.read(null, {
		position: null,
		q,
		roster: null,
		limit: ORDER_MAX_ROWS
	});
	return {
		places: livePlaces(answer),
		lead: liveLeadPart(answer, shapeWords(teams, false), answerReadAt(answer, landed()), zone)
	};
}
