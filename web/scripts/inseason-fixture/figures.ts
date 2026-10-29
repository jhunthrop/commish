// The League page's figures (Lane 292) on the fixture's scoreboard, as the API answers them: each
// game's Proj gap from its sides' printed projections (inseason/dashboard.go projectionGap), the
// gap's sentence, and every team's power rank. STAND-IN: the power ranks are not the engine's (the
// fixture has no order to profile the rosters by); each team's overall place follows its points for,
// and its place at each spot is a fixed turn of the overall, so the panel draws every shape a rank
// takes. The sentences are the API's words, copied (dashboard.go).
import type { LeagueSync } from '../../src/lib/league/api.ts';
import type { Scoreboard } from '../../src/lib/league/inseason/api.ts';
import { roundTenth } from './tenths.ts';

/** dashboard.go ProjectionGapBasis, word for word. */
export const GAP_BASIS =
	"Proj gap is your starters' published projection less your opponent's, not a win chance: we show none until one is measured on a past season.";

/** dashboard.go powerWords over the fixture's weeks (its horizon, weeks 6 to 17). */
export const POWER_BASIS =
	"Power ranks each team's best lineup by our order at each starting spot, 1 the strongest, weeks 6 to 17, byes counted. Kickers and defenses are not ranked.";

/** The recorded league's ranked spots: a 1QB lineup with a flex. */
const COLUMNS = ['QB', 'RB', 'WR', 'TE', 'FLEX'] as const;

/** The first side's projection less the second's, to the tenth; null for a lone side or a side
 * with none. */
function gapOf(sides: Scoreboard['games'][number]['sides']): number | null {
	const [first, second] = sides;
	if (sides.length !== 2 || first?.projection == null || second?.projection == null) return null;
	return roundTenth(first.projection - second.projection);
}

/** The power stand-in: overall by points for, most first, ties by roster id; each spot a turn. */
function powerOf(sync: LeagueSync): NonNullable<Scoreboard['power']> {
	const order = [...sync.teams].sort(
		(a, b) => b.points_for - a.points_for || a.roster_id - b.roster_id
	);
	const n = order.length;
	return {
		basis: POWER_BASIS,
		columns: [...COLUMNS],
		teams: order.map((team, i) => ({
			roster_id: team.roster_id,
			rank: i + 1,
			ranks: COLUMNS.map((_, c) => ((i + c * 5) % n) + 1)
		}))
	};
}

/** The scoreboard with the Lane 292 fields. */
export function withFigures(board: Scoreboard, sync: LeagueSync): Scoreboard {
	return {
		...board,
		games: board.games.map((g) => ({ ...g, projection_gap: gapOf(g.sides) })),
		projection_gap_basis: GAP_BASIS,
		power: powerOf(sync)
	};
}
