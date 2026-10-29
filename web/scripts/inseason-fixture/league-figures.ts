// The league answer's Lane 298 fields on the fixture's sync answer, as the API answers them: each
// team's playoff chance with its sentence, and the member's points against the median. STAND-IN: the
// fixture keeps no season schedule, so neither figure is the API's reckoning: each team's chance is a
// fixed figure by its place in the standings (the leader clinched at 100, the last out at 0, the rest
// between, so the column draws every shape a cell takes), and the member's weeks against the median
// are five made-up weeks. The sentences are the API's words, copied (api/internal/leaguesync
// chance.go chanceBasis for a Sleeper league of six seats by record, median.go VsMedianBasis); a Go
// test holds these copies to the API word for word.
import type { LeagueSync } from '../../src/lib/league/api.ts';

/** chance.go chanceBasis, a Sleeper league with six seats by record, word for word. */
export const CHANCE_BASIS =
	"Playoff chance from 2,000 replays of the schedule left, each team at its season rate, scores varying week to week as this league's have. The top 6 by record make it, ties by points for. Only a clinched place reads 100 and only a team that is out reads 0. Divisions are not counted.";

/** median.go VsMedianBasis, word for word. */
export const VS_MEDIAN_BASIS =
	"Vs median is your points less the league's median score each played week, from the platform's scores. Weeks the platform did not score for every team are left out.";

/** The stand-in chance by place in the standings, first to twelfth. */
const CHANCE_BY_PLACE = [100, 97, 88, 74, 61, 52, 40, 29, 18, 9, 3, 0] as const;

/** The stand-in weeks against the median: week, points, the week's median. */
const WEEKS: readonly (readonly [number, number, number])[] = [
	[1, 118.4, 104.2],
	[2, 96.1, 101.7],
	[3, 131.0, 108.5],
	[4, 99.8, 99.8],
	[5, 112.6, 106.0]
];

/** A tenth as the API prints it. */
function tenth(n: number): number {
	return Math.round(n * 10) / 10;
}

/** The sync answer with the Lane 298 fields. */
export function withLeagueFigures(sync: LeagueSync): LeagueSync {
	const weeks = WEEKS.map(([week, points, median]) => ({
		week,
		points,
		median,
		diff: tenth(points - median)
	}));
	return {
		...sync,
		teams: sync.teams.map((t, i) => ({
			...t,
			playoff_chance: CHANCE_BY_PLACE[i] ?? 0
		})),
		playoff_chance_basis: CHANCE_BASIS,
		points_vs_median: {
			weeks,
			above: weeks.filter((w) => w.diff > 0).length,
			total: tenth(weeks.reduce((sum, w) => sum + w.diff, 0)),
			basis: VS_MEDIAN_BASIS
		}
	};
}
