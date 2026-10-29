/** The League page's figures (Lane 292): the Proj gap on the member's score bug, the power panel by
 * position and the member's start and sit row; Lane 298's playoff chance on the standings and the
 * member's points against the median, a second record row. Pure functions over the scoreboard and record
 * answers; every sentence beside a figure is the API's, the cells' words are here. An answer from
 * before Lane 292 carries none of the fields, and the page then draws none of the figures. */
import { signed } from '#lib/format/number.ts';
import type { components } from '#lib/api/types.ts';
import type { LeagueSync } from '../api.ts';

type LeagueTeam = LeagueSync['teams'][number];
import type { LeagueRecord, Scoreboard } from '../inseason/api.ts';

type LeaguePowerColumn = components['schemas']['LeaguePowerColumn'];

/** Every word the figures print that is not a team's, for the copy guard. */
export const FIGURE_WORDS = {
	gap: 'Proj gap',
	power: 'Power',
	team: 'Team',
	overall: 'Pwr',
	startSit: 'Start/sit',
	matched: 'Matched',
	ours: 'Our picks',
	of: 'of',
	chance: 'Playoff chance',
	vsMedian: 'Vs median',
	above: 'Above',
	net: 'Net'
} as const;

/** The power panel's column heads: the API's spot keys, the superflex as the boards say it. */
export const POWER_HEADS: Readonly<Record<LeaguePowerColumn, string>> = {
	QB: 'QB',
	RB: 'RB',
	WR: 'WR',
	TE: 'TE',
	FLEX: 'FLEX',
	SUPERFLEX: 'SFLX'
};

/** The member's game's Proj gap and its sentence, drawn only before the game kicks off, when the
 * two projections are the bug's own figures; null when the answer has none. */
export interface GapFigure {
	cell: string;
	basis: string;
}

export function gapFigure(
	board: Scoreboard | null,
	me: number,
	upcoming: boolean
): GapFigure | null {
	if (board === null || !upcoming || board.projection_gap_basis === undefined) return null;
	const mine = board.games.find((g) => g.sides[0]?.roster_id === me);
	const gap = mine?.projection_gap;
	if (gap === undefined || gap === null) return null;
	return { cell: `${FIGURE_WORDS.gap} ${signed(gap)}`, basis: board.projection_gap_basis };
}

/** One row of the power panel: the team, its overall place and its place at each column. */
export interface PowerRow {
	rosterId: number;
	name: string;
	avatar: string | null;
	me: boolean;
	rank: number;
	ranks: readonly number[];
}

/** The panel: its heads, its rows in overall order, the API's sentence; null with no power. */
export interface PowerPanel {
	heads: readonly string[];
	rows: readonly PowerRow[];
	basis: string;
}

export function powerPanel(board: Scoreboard | null, sync: LeagueSync): PowerPanel | null {
	const power = board?.power;
	if (power === undefined || power.teams.length === 0) return null;
	const rows = power.teams.flatMap((t) => {
		const team = sync.teams.find((x) => x.roster_id === t.roster_id);
		return team === undefined
			? []
			: [
					{
						rosterId: t.roster_id,
						name: team.name,
						avatar: team.avatar ?? null,
						me: t.roster_id === sync.me,
						rank: t.rank,
						ranks: t.ranks
					}
				];
	});
	return { heads: power.columns.map((c) => POWER_HEADS[c]), rows, basis: power.basis };
}

/** One cell of a record row: its label, its figure, and its tone: short (rose) where the member's
 * lineup left points behind, over (green) where it came out ahead, even at none. */
export interface FigureCell {
	label: string;
	value: string;
	tone: 'short' | 'over' | 'even';
}

/** One of the member's record rows: its head, its cells and the API's sentence; figure keys the
 * row's data-figure and data-basis. */
export interface FigureRow {
	figure: 'start-sit' | 'vs-median';
	head: string;
	cells: readonly FigureCell[];
	basis: string;
}

/** A signed figure's tone: points behind is short, ahead over. */
function toneOf(ahead: number): FigureCell['tone'] {
	return ahead > 0 ? 'over' : ahead < 0 ? 'short' : 'even';
}

/** The member's start and sit row: weeks matched of weeks read, and what our picks scored less the
 * set lineup's, signed (rose when our picks would have added points), with the API's sentence; null
 * with no record. */
export function startSitRow(record: LeagueRecord | null): FigureRow | null {
	const s = record?.start_sit;
	if (s === undefined) return null;
	return {
		figure: 'start-sit',
		head: FIGURE_WORDS.startSit,
		cells: [
			{
				label: FIGURE_WORDS.matched,
				value: `${String(s.matched)} ${FIGURE_WORDS.of} ${String(s.weeks)}`,
				tone: 'even'
			},
			{ label: FIGURE_WORDS.ours, value: signed(s.ours_less_set), tone: toneOf(-s.ours_less_set) }
		],
		basis: s.basis
	};
}

/** The member's points against the median (Lane 298): the weeks above it of the weeks read, and the
 * weeks' net, signed (green above the median), with the API's sentence; null where the answer has
 * none. */
export function medianRow(sync: Pick<LeagueSync, 'points_vs_median'> | null): FigureRow | null {
	const m = sync?.points_vs_median;
	if (m === undefined) return null;
	return {
		figure: 'vs-median',
		head: FIGURE_WORDS.vsMedian,
		cells: [
			{
				label: FIGURE_WORDS.above,
				value: `${String(m.above)} ${FIGURE_WORDS.of} ${String(m.weeks.length)}`,
				tone: 'even'
			},
			{ label: FIGURE_WORDS.net, value: signed(m.total), tone: toneOf(m.total) }
		],
		basis: m.basis
	};
}

/** A team's playoff chance as its cell ("64%"), null where the answer has none. */
export function chanceCell(team: Pick<LeagueTeam, 'playoff_chance'>): string | null {
	const pct = team.playoff_chance;
	return pct === undefined || pct === null ? null : `${String(pct)}%`;
}

/** Whether the standings draw the chance column: every team has a figure, with its sentence. */
export function chanceShown(sync: Pick<LeagueSync, 'teams' | 'playoff_chance_basis'>): boolean {
	return (
		sync.playoff_chance_basis !== undefined &&
		sync.teams.length > 0 &&
		sync.teams.every((t) => chanceCell(t) !== null)
	);
}
