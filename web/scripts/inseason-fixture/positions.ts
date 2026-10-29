// The Waivers answer's position panel on the fixture (Lane 291), as the API builds it (inseason
// waiver_positions.go): a card a position the league starts, the member's place among the twelve
// teams by the rest-of-season points of the starters each team's best lineup fields there (a flex or
// superflex spot counted for the position of the player who fills it), the median team's figure, the
// need on that same measure (the member under the median by the close call a week over the weeks
// covered), the same standing for this week's Proj where any player at the position has one, the
// member's players there, and the best free agents the table lists: five by rest-of-season points,
// and five by this week's Proj for the This week list, each with the table's own row.
//
// STAND-INS, named in the lane's report; only the panel's shape and its rules are meant to hold, and
// the apps' parity should assert its words, not these figures:
// - a player's rest-of-season points are the recorded board's points (boards-ppr.json), and the fill
//   picks starters by the board's points over replacement (vor) as the engine picks by points over
//   replacement a game, summing their points; the API's week-by-week fill with byes is not ported;
// - the member's players on injured reserve or a season-long list never start (the engine's
//   InjuredReserve); other teams' designations are not in the fixture, so theirs all may start;
// - this week's figures are the member's lines' own Proj (a player without one sits) and, for every
//   other team, the one projection snapshot (projection.json), a player it has no row for
//   at his board points over the weeks left; a position ranks this week where any rostered player
//   there carries a week figure (the API's rule);
// - the board places no defense, so only the member's own defenses (his lines) fill a D/ST spot:
//   the D/ST card ranks him against teams the fixture gives none.
import type { LeagueSync } from '../../src/lib/league/api.ts';
import type { PlayerLine, WaiverAdvice, WaiverRow } from '../../src/lib/league/inseason/api.ts';
import type { components } from '../../src/lib/api/types.ts';
import { roundTenth } from './tenths.ts';

type Card = components['schemas']['WaiverPositionCard'];
type Free = components['schemas']['WaiverPositionFree'];
type Standing = components['schemas']['WaiverStanding'];
type Position = Card['position'];

/** The panel's positions in a lineup's order. */
const POSITIONS: readonly Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const FLEX: readonly Position[] = ['RB', 'WR', 'TE'];
const SUPER_FLEX: readonly Position[] = ['QB', 'RB', 'WR', 'TE'];
const SKILL: readonly Position[] = ['QB', 'RB', 'WR', 'TE'];
/** The free agents a card lists at most (waiver_positions.go PanelFree). */
const PANEL_FREE = 5;
/** The need's least shortfall a week (trades.go CloseCall). */
const CLOSE_CALL = 0.5;

/** One player as the stand-in fills a lineup with him. */
export interface PanelPlayer {
	id: string;
	position: Position;
	points: number | null;
	/** His points over replacement, the fill's order for the rest of the season. */
	por: number | null;
	proj: number | null;
}

/** The fixture's inputs: the league read, each board id's position, points and points over
 * replacement, the week's Proj. */
export interface PanelInputs {
	sync: Pick<LeagueSync, 'teams' | 'me' | 'held_by' | 'terms'>;
	board: ReadonlyMap<string, { position: string; points: number | null; vor: number | null }>;
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

const desc =
	<T>(key: (item: T) => number | null) =>
	(a: T, b: T): number =>
		(key(b) ?? -Infinity) - (key(a) ?? -Infinity);

/** The best lineup: each spot takes the best player left it accepts by order, players out kept out.
 * Returns the figure the starters sum to by position, and who starts. */
export function fill(
	players: readonly PanelPlayer[],
	spots: readonly Position[][],
	order: (p: PanelPlayer) => number | null,
	figure: (p: PanelPlayer) => number | null,
	out: ReadonlySet<string> = new Set()
): { by: Map<Position, number>; starts: Set<string> } {
	const ranked = [...players].filter((p) => !out.has(p.id)).sort(desc(order));
	const by = new Map<Position, number>();
	const starts = new Set<string>();
	for (const spot of spots) {
		const p = ranked.find((c) => !starts.has(c.id) && spot.includes(c.position));
		if (p === undefined) continue;
		starts.add(p.id);
		const v = figure(p);
		by.set(p.position, (by.get(p.position) ?? 0) + (v ?? 0));
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

/** The need on the rank's own measure (waiver_positions.go PositionNeed). */
export function positionNeed(p: Position, s: Standing | null, weeks: number): boolean {
	if (s === null || !SKILL.includes(p)) return false;
	return roundTenth(s.median - s.points) >= roundTenth(CLOSE_CALL * Math.max(1, weeks));
}

/** A line's id in the fills: his board id, or his host id where the board does not place him (a
 * defense on this fixture). */
const idOf = (line: PlayerLine): string => line.player.board_id ?? `host:${line.player.host_id}`;

/** Every team's players the board places, and the member's lines it does not (his defenses), so the
 * member's whole active roster fills his lineups as the engine's does. */
function playersOf(inputs: PanelInputs, roster: readonly PlayerLine[]): Map<number, PanelPlayer[]> {
	const out = new Map<number, PanelPlayer[]>();
	for (const [id, team] of Object.entries(inputs.sync.held_by)) {
		const b = inputs.board.get(id);
		if (b === undefined || !POSITIONS.includes(b.position as Position)) continue;
		const list = out.get(team) ?? [];
		const position = b.position as Position;
		list.push({ id, position, points: b.points, por: b.vor, proj: inputs.proj(id) });
		out.set(team, list);
	}
	const mine = out.get(inputs.sync.me) ?? [];
	for (const line of roster) {
		const position = line.player.position as Position;
		if (mine.some((p) => p.id === idOf(line)) || !POSITIONS.includes(position)) continue;
		mine.push({ id: idOf(line), position, points: null, por: null, proj: null });
	}
	out.set(inputs.sync.me, mine);
	return out;
}

/** The member's players the engine keeps out of every lineup: on injured reserve or a season-long
 * list (InjuredReserve). */
function keptOut(roster: readonly PlayerLine[]): Set<string> {
	const out = new Set<string>();
	for (const line of roster) {
		const d = line.facts.designation;
		const away =
			line.player.injured_reserve || d?.status === 'injured_reserve' || d?.season_long === true;
		if (away) out.add(idOf(line));
	}
	return out;
}

const pointsOf = (inputs: PanelInputs, line: PlayerLine): number | null =>
	line.player.board_id === null ? null : (inputs.board.get(line.player.board_id)?.points ?? null);

const rowKey = (row: WaiverRow): string =>
	`${row.add.player.host_id}|${row.add.player.board_id ?? ''}`;

/** The table's free agents at p, the best five by key, each with his row. */
function freeAt(
	rows: readonly WaiverRow[],
	p: Position,
	inputs: PanelInputs,
	key: (f: Free) => number | null
): Free[] {
	return [...new Map(rows.map((r) => [rowKey(r), r])).values()]
		.filter((r) => r.add.player.position === p)
		.map((row) => ({ row, rest_of_season_points: pointsOf(inputs, row.add) }))
		.filter((f) => key(f) !== null)
		.sort(desc(key))
		.slice(0, PANEL_FREE);
}

/** The answer with its panel (the full page's alone). */
export function withPositions(answer: WaiverAdvice, inputs: PanelInputs): WaiverAdvice {
	const spots = spotsOf(inputs.sync.terms.roster);
	const teams = inputs.sync.teams.map((t) => t.roster_id);
	const me = teams.indexOf(inputs.sync.me);
	const players = playersOf(inputs, answer.roster);
	const out = keptOut(answer.roster);
	const outFor = (t: number): Set<string> => (t === inputs.sync.me ? out : new Set());
	const season = teams.map((t) =>
		fill(
			players.get(t) ?? [],
			spots,
			(p) => p.por,
			(p) => p.points,
			outFor(t)
		)
	);
	// The member's week is his lines' own Proj, a player without one (a bye) never starting, as the
	// Lineup rule has it; every other team's is the stand-in's.
	const myProj = new Map(answer.roster.map((l) => [idOf(l), l.week_projection] as const));
	const weekFigure = (p: PanelPlayer): number | null =>
		myProj.has(p.id)
			? (myProj.get(p.id) ?? null)
			: (p.proj ?? (p.points === null ? null : p.points / inputs.weeks));
	const myWeekOut = new Set([
		...out,
		...[...myProj].filter(([, v]) => v === null).map(([id]) => id)
	]);
	const week = teams.map((t) =>
		fill(
			players.get(t) ?? [],
			spots,
			weekFigure,
			weekFigure,
			t === inputs.sync.me ? myWeekOut : new Set()
		)
	);
	const weekRead = answer.projection_read_at !== null;
	const positions = POSITIONS.filter((p) => spots.some((s) => s.includes(p))).map((p): Card => {
		const pointed = [...players.values()].some((list) =>
			list.some((c) => c.position === p && c.points !== null)
		);
		const rest = pointed
			? standingOf(
					season.map((f) => f.by.get(p) ?? 0),
					me
				)
			: null;
		// The API's rule (panelLeagueOf): a position ranks this week where any rostered player there
		// carries a week figure, bench included; none, and it ranks nobody (review M4, re-review N1).
		const projected =
			weekRead &&
			[...players.values()].some((list) =>
				list.some((c) => c.position === p && weekFigure(c) !== null)
			);
		const mine = answer.roster
			.filter((l) => l.player.position === p)
			.map((line) => ({
				line,
				starter: (season[me]?.starts ?? new Set()).has(idOf(line)),
				starts_this_week: (week[me]?.starts ?? new Set()).has(idOf(line)),
				rest_of_season_points: pointsOf(inputs, line)
			}))
			.sort(desc((m) => m.rest_of_season_points));
		return {
			position: p,
			teams: teams.length,
			need: positionNeed(p, rest, inputs.weeks),
			rest_of_season: rest,
			week: projected
				? standingOf(
						week.map((f) => f.by.get(p) ?? 0),
						me
					)
				: null,
			mine,
			available: freeAt(answer.rows, p, inputs, (f) => f.rest_of_season_points),
			...(projected
				? { available_week: freeAt(answer.rows, p, inputs, (f) => f.row.add.week_projection) }
				: {})
		};
	});
	return { ...answer, positions };
}
