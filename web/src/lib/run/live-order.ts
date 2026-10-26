/** One value and one order for a player on every in-season page (Lane 220, B184): the run is our
 * rest-of-season board at the nightly's instant, and the API's order is the same board at the read's
 * clock, a club's games that have kicked off since taken out (api restlive.go RestAt and LiveBoard).
 * Once the season is under way a page that ranks or scores a player prints the order's figures, the
 * ones the Rankings read: his rank, his place at his position, his rest-of-season points and his
 * points over replacement, each from one answer. A page whose rows the answer does not all hold keeps
 * the run's, every row of them, so no table mixes the run's clock with the read's. Pure, so the tests
 * read every figure a page prints. */
import type { components } from '#lib/api/types.ts';
import type { BasisPart } from './board-basis.ts';
import { leadOf } from './held-places.ts';
import type { PlayerFormat, PlayerStatus } from './schema.ts';

type OrderAdvice = components['schemas']['OrderAdvice'];

/** The largest view of the order the API answers (api inseason MaxOrderRows). */
export const ORDER_MAX_ROWS = 400;

/** A player's place in the order at the read's clock. */
export interface LivePlace {
	rank: number;
	/** Null for a player on a season-long list, whose run row says the list's word. */
	positionRank: number | null;
	projected: number;
	vor: number;
}

/** Each player the answer places with both figures, by board id. */
export function livePlaces(answer: Pick<OrderAdvice, 'rows'>): ReadonlyMap<string, LivePlace> {
	const places = new Map<string, LivePlace>();
	for (const row of answer.rows) {
		const id = row.line.player.board_id;
		const projected = row.rest_of_season_points;
		const vor = row.points_over_replacement;
		if (id === null || projected === null || vor === null) continue;
		places.set(id, { rank: row.rank, positionRank: row.line.position_rank, projected, vor });
	}
	return places;
}

/** The fields a run row ranks and scores a player by. */
export type Placed = Pick<
	PlayerFormat,
	'ourRank' | 'positionRank' | 'projected' | 'vor' | 'vorRound' | 'gap'
>;

/** A run row at the read's clock: the order's rank, place, points and value, and the round a
 * `teams`-team draft his place falls in, as the run words it from its own rank (row-framing.ts). The
 * run's Gap is its ADP less its own rank, so the order's place leaves it unsaid. */
export function placedAt<R extends Placed>(row: R, place: LivePlace, teams: number): R {
	return {
		...row,
		ourRank: place.rank,
		positionRank: place.positionRank ?? row.positionRank,
		projected: place.projected,
		vor: place.vor,
		vorRound: Math.ceil(place.rank / teams),
		gap: null
	};
}

/** Every run row at the read's clock in the order's order, or null when the answer does not place
 * one of them: the page then keeps the run's rows, never a table half one board and half the other. */
export function placedRows<R extends Placed & { id: string }>(
	rows: readonly R[],
	places: ReadonlyMap<string, LivePlace>,
	teams: number
): R[] | null {
	const out: R[] = [];
	for (const row of rows) {
		const place = places.get(row.id);
		if (place === undefined) return null;
		out.push(placedAt(row, place, teams));
	}
	return out.toSorted((a, b) => a.ourRank - b.ourRank);
}

/** Each club card's lead at the read's clock: the first of its pool, placed by the order, who is on no
 * season-long list; null when the answer does not place a pool's every player, so the index keeps the
 * run's leads, every one of them. A card with no lead on the run has none at the clock. */
export function placedLeads<
	R extends Placed & { id: string; status?: PlayerStatus },
	C extends { lead: R | null; pool: readonly R[] }
>(cards: readonly C[], places: ReadonlyMap<string, LivePlace>, teams: number): C[] | null {
	const out: C[] = [];
	for (const card of cards) {
		if (card.lead === null) {
			out.push(card);
			continue;
		}
		const pool = placedRows(card.pool, places, teams);
		if (pool === null) return null;
		out.push({ ...card, lead: leadOf(pool) });
	}
	return out;
}

/** The run's basis with the order's lead in place of the run's board sentence (the run's time goes
 * with it, the lead says when the order was read); led by it where the run's basis names no board. */
export function liveBasis(runBasis: readonly BasisPart[], lead: BasisPart): BasisPart[] {
	const at = runBasis.findIndex((part) => part.topic === 'board');
	if (at < 0) return [lead, ...runBasis];
	return runBasis.map((part, i) => (i === at ? lead : part));
}
