/** One board for a signed-in member (Lane 96 fix round 1, B08): the front door's strip prints the
 * API's live order, the one Players and Rest of 2026 read at the same clock (restlive.go RestAt and
 * LiveBoard), in its order and to its tenth. A reader who is signed out, or whose read fails, keeps
 * the run's figures, said with the run's time beside them. Pure, so the tests read every figure and
 * word the strip prints. */
import { timeOfDay, zoneWord } from '#lib/format/clock.ts';
import type { BasisPart } from '#lib/run/board-basis.ts';
import type { BoardRowView } from '#lib/run/schema.ts';
import type { components } from '#lib/api/types.ts';

type OrderAdvice = components['schemas']['OrderAdvice'];

/** How many rows the strip shows. */
export const STRIP_ROWS = 10;
/** How many of the run's rows the page carries for the live order to draw from: a live top ten is
 * the run's top players re-valued, so it sits within these on any one-quarterback shape. */
export const STRIP_POOL = 40;
/** The clock a prerendered page says the run's time on, before the page knows the reader's. */
export const BUILD_ZONE = 'America/Chicago';

/** "Projected and Over repl. as of the run, 8:50 am Central.": the run's figures with its time. */
export function runStampPart(refreshedAt: string, zone: string): BasisPart {
	return {
		text: `Projected and Over repl. as of the run, ${timeOfDay(refreshedAt, zone)} ${zoneWord(zone)}.`,
		phone: true
	};
}

/** The shape the live figures are for: "for 12 teams", or in a league "for 12 teams, your league's
 * shape". */
export function shapeWords(teams: number, league: boolean): string {
	const base = `for ${String(teams)} teams`;
	return league ? `${base}, your league's shape` : base;
}

/** The order's first sentence without its stop: "Our rest-of-season order from week 7". */
function orderLead(basis: string): string {
	const end = basis.indexOf('. ');
	return (end < 0 ? basis : basis.slice(0, end)).replace(/\.$/, '');
}

/** The live strip's lead, in place of the run's: the API's own words for its weeks, the shape and
 * when it was read. "Our rest-of-season order from week 7, by points over replacement for 12 teams,
 * your league's shape, read 7:25 pm Central." */
export function liveLeadPart(
	answer: Pick<OrderAdvice, 'basis'>,
	shape: string,
	readAt: number,
	zone: string
): BasisPart {
	const at = new Date(readAt).toISOString();
	return {
		text: `${orderLead(answer.basis)}, by points over replacement ${shape}, read ${timeOfDay(at, zone)} ${zoneWord(zone)}.`,
		phone: true
	};
}

/** The strip at the API's clock: the answer's first `size` rows in its order, each the run's row for
 * him with the answer's Projected, Over repl., place and the round of a `teams`-team draft it falls in. Null when a row the answer ranks is not
 * among the run's carried rows or carries no figure: the page then keeps the run's strip and its
 * stamp, never a strip half one board and half the other. */
export function liveStrip(
	pool: readonly BoardRowView[],
	answer: Pick<OrderAdvice, 'rows'>,
	teams: number,
	size: number = STRIP_ROWS
): BoardRowView[] | null {
	const byId = new Map(pool.map((row) => [row.id, row]));
	const shown = answer.rows.slice(0, size);
	if (shown.length < Math.min(size, pool.length)) return null;
	const out: BoardRowView[] = [];
	for (const row of shown) {
		const id = row.line.player.board_id;
		const run = id === null ? undefined : byId.get(id);
		if (
			run === undefined ||
			row.rest_of_season_points === null ||
			row.points_over_replacement === null
		) {
			return null;
		}
		out.push({
			...run,
			projected: row.rest_of_season_points,
			vor: row.points_over_replacement,
			ourRank: row.rank,
			// The round his place falls in, as the run words it from its own rank (row-framing.ts).
			vorRound: Math.ceil(row.rank / teams),
			// The run's Gap is its ADP less its own rank: the live place leaves it unsaid.
			gap: null
		});
	}
	return out;
}

/** The run's basis with its first sentence the live lead in place of the run's (the run stamp is
 * the run's strip's alone). */
export function liveBasis(runBasis: readonly BasisPart[], lead: BasisPart): BasisPart[] {
	return [lead, ...runBasis.slice(1)];
}
