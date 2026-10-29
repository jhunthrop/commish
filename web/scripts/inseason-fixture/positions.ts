// The Waivers answer's position panel on the fixture (Lane 291), as the API builds it (inseason
// waiver_positions.go): a card a position the league starts, the member's place among the twelve
// teams by the points of the starters each team's best lineup fields there (a flex or superflex spot
// counted for the position of the player who fills it), the median team's figure, the same for this
// week's Proj, the member's players there and the five best free agents the table lists, each with
// the table's own row. STAND-INS, named in the lane's report: a player's rest-of-season points are
// the recorded board's points (boards-ppr.json, the fixture's one board), each lineup is filled
// greedily by them (the API's week-by-week fill with byes is not ported), this week's by the one
// projection snapshot (projection.json), a player it has no row for at his board points over the
// weeks left, and the need mark is the API's rule on those figures (the member's figure under the
// median by half a point a week over the weeks the order covers). Only the panel's shape and its
// rules are meant to hold.
import type { LeagueSync } from '../../src/lib/league/api.ts';
import type { PlayerLine, WaiverAdvice, WaiverRow } from '../../src/lib/league/inseason/api.ts';
import type { components } from '../../src/lib/api/types.ts';
import { roundTenth } from './tenths.ts';

type Card = components['schemas']['WaiverPositionCard'];
type Standing = components['schemas']['WaiverStanding'];
type Position = Card['position'];

/** The panel's positions in a lineup's order. */
const POSITIONS: readonly Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const FLEX: readonly Position[] = ['RB', 'WR', 'TE'];
const SUPER_FLEX: readonly Position[] = ['QB', 'RB', 'WR', 'TE'];
/** The free agents a card lists at most (waiver_positions.go PanelFree). */
const PANEL_FREE = 5;
/** The need's least shortfall a week (trades.go CloseCall). */
const CLOSE_CALL = 0.5;

/** One player as the stand-in fills a lineup with him. */
export interface PanelPlayer {
	id: string;
	position: Position;
	points: number | null;
	proj: number | null;
}

/** The fixture's inputs: the league read, each board id's position and points, the week's Proj. */
export interface PanelInputs {
	sync: Pick<LeagueSync, 'teams' | 'me' | 'held_by' | 'terms'>;
	board: ReadonlyMap<string, { position: string; points: number | null }>;
	proj: (boardId: string) => number | null;
	weeks: number;
}

type Spots = Readonly<Record<string, number>>;

/** The starting spots, each its positions: the dedicated first, then the flex, then the superflex. */
function spotsOf(roster: Spots): Position[][] {
	const out: Position[][] = [];
	const each = (count: number, positions: readonly Position[]): void => {
		for (let i = 0; i < count; i++) out.push([...positions]);
	};
	each(roster.qb ?? 0, ['QB']);
	each(roster.rb ?? 0, ['RB']);
	each(roster.wr ?? 0, ['WR']);
	each(roster.te ?? 0, ['TE']);
	each(roster.k ?? 0, ['K']);
	each(roster.def ?? 0, ['DEF']);
	each(roster.flex ?? 0, FLEX);
	each(roster.super_flex ?? 0, SUPER_FLEX);
	return out;
}

/** The best lineup by a figure: each spot takes the best player left it accepts. Returns the
 * figure by position and who starts. */
export function fill(
	players: readonly PanelPlayer[],
	spots: readonly Position[][],
	figure: (p: PanelPlayer) => number | null
): { by: Map<Position, number>; starts: Set<string> } {
	const order = [...players].sort((a, b) => (figure(b) ?? -Infinity) - (figure(a) ?? -Infinity));
	const by = new Map<Position, number>();
	const starts = new Set<string>();
	for (const spot of spots) {
		const p = order.find((c) => !starts.has(c.id) && spot.includes(c.position));
		if (p === undefined) continue;
		starts.add(p.id);
		by.set(p.position, (by.get(p.position) ?? 0) + (figure(p) ?? 0));
	}
	return { by, starts };
}

function median(values: readonly number[]): number {
	const s = [...values].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	const at = (i: number): number => s[i] ?? 0;
	return s.length % 2 === 1 ? at(mid) : (at(mid - 1) + at(mid)) / 2;
}

/** The member's place among the figures (waiver_positions.go StandingOf). */
export function standingOf(figures: readonly number[], me: number): Standing {
	const mine = roundTenth(figures[me] ?? 0);
	return {
		rank: 1 + figures.filter((f) => roundTenth(f) > mine).length,
		points: mine,
		median: roundTenth(median(figures))
	};
}

function playersOf(inputs: PanelInputs): Map<number, PanelPlayer[]> {
	const out = new Map<number, PanelPlayer[]>();
	for (const [id, roster] of Object.entries(inputs.sync.held_by)) {
		const b = inputs.board.get(id);
		if (b === undefined || !POSITIONS.includes(b.position as Position)) continue;
		const list = out.get(roster) ?? [];
		list.push({ id, position: b.position as Position, points: b.points, proj: inputs.proj(id) });
		out.set(roster, list);
	}
	return out;
}

const pointsOf = (inputs: PanelInputs, line: PlayerLine): number | null =>
	line.player.board_id === null ? null : (inputs.board.get(line.player.board_id)?.points ?? null);

const rowKey = (row: WaiverRow): string =>
	`${row.add.player.host_id}|${row.add.player.board_id ?? ''}`;

/** The answer with its panel (the full page's alone). */
export function withPositions(answer: WaiverAdvice, inputs: PanelInputs): WaiverAdvice {
	const spots = spotsOf(inputs.sync.terms.roster);
	const teams = inputs.sync.teams.map((t) => t.roster_id);
	const me = teams.indexOf(inputs.sync.me);
	const players = playersOf(inputs);
	const season = teams.map((t) => fill(players.get(t) ?? [], spots, (p) => p.points));
	const week = teams.map((t) =>
		fill(
			players.get(t) ?? [],
			spots,
			(p) => p.proj ?? (p.points === null ? null : p.points / inputs.weeks)
		)
	);
	const weekRead = answer.projection_read_at !== null;
	const positions = POSITIONS.filter((p) => spots.some((s) => s.includes(p))).map((p): Card => {
		const seasonFigures = season.map((f) => f.by.get(p) ?? 0);
		const rest = standingOf(seasonFigures, me);
		const pointed = [...players.values()].some((list) =>
			list.some((c) => c.position === p && c.points !== null)
		);
		const mine = answer.roster
			.filter((l) => l.player.position === p)
			.map((line) => ({
				line,
				starter: (season[me]?.starts ?? new Set()).has(line.player.board_id ?? ''),
				starts_this_week: (week[me]?.starts ?? new Set()).has(line.player.board_id ?? ''),
				rest_of_season_points: pointsOf(inputs, line)
			}))
			.sort(
				(a, b) => (b.rest_of_season_points ?? -Infinity) - (a.rest_of_season_points ?? -Infinity)
			);
		const available = [...new Map(answer.rows.map((r) => [rowKey(r), r])).values()]
			.filter((r) => r.add.player.position === p)
			.map((row) => ({ row, rest_of_season_points: pointsOf(inputs, row.add) }))
			.sort(
				(a, b) => (b.rest_of_season_points ?? -Infinity) - (a.rest_of_season_points ?? -Infinity)
			)
			.slice(0, PANEL_FREE);
		const short = rest.median - rest.points;
		return {
			position: p,
			teams: teams.length,
			need: pointed && p !== 'K' && p !== 'DEF' && roundTenth(short) >= CLOSE_CALL * inputs.weeks,
			rest_of_season: pointed ? rest : null,
			week: weekRead
				? standingOf(
						week.map((f) => f.by.get(p) ?? 0),
						me
					)
				: null,
			mine,
			available
		};
	});
	return { ...answer, positions };
}
