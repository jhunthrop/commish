/** The League page's figures (Lane 292): the Proj gap on the member's score bug, the power panel by
 * position and the member's start and sit row. Pure functions over the scoreboard and record
 * answers; every sentence beside a figure is the API's, the cells' words are here. An answer from
 * before Lane 292 carries none of the fields, and the page then draws none of the figures. */
import { signed } from '#lib/format/number.ts';
import type { components } from '#lib/api/types.ts';
import type { LeagueSync } from '../api.ts';
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
	of: 'of'
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

/** The member's start and sit row: weeks matched of weeks read, and what our picks scored less the
 * set lineup's, signed, with the API's sentence; null with no record. */
export interface StartSitRow {
	matched: string;
	ours: string;
	/** ahead (rose) when our picks would have added points, the member's lineup leaving them on the
	 * bench; behind (green) when the member's scored more; even at none. */
	tone: 'ahead' | 'behind' | 'even';
	basis: string;
}

export function startSitRow(record: LeagueRecord | null): StartSitRow | null {
	const s = record?.start_sit;
	if (s === undefined) return null;
	return {
		matched: `${String(s.matched)} ${FIGURE_WORDS.of} ${String(s.weeks)}`,
		ours: signed(s.ours_less_set),
		tone: s.ours_less_set > 0 ? 'ahead' : s.ours_less_set < 0 ? 'behind' : 'even',
		basis: s.basis
	};
}
