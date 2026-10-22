/** A player's "This season" block, worded at build: the head's aside, the season line, the game log
 * so far, the weeks still to play with their kickoff days, the basis line, or the one sentence a
 * player with no line gets. */
import { weekdayLabel } from '#lib/format/date.ts';
import { fixed, plural } from '#lib/format/number.ts';

/** Tenths in a point, the box's printed precision. */
const TENTHS = 10;
import {
	POINTS_PER_GAME_DECIMALS,
	type GameLogRow,
	type PlayerSeason,
	type PriorSeason
} from '#lib/run/season.ts';
import { countedWeek } from '#lib/run/reach.ts';
import type { Format, Game, Slate } from '#lib/run/schema.ts';
import { rowGame } from '#lib/run/row-game.ts';
import { GAME_STATE_WORDS } from '#lib/format/game-facts.ts';
import { UNKNOWN_CLUB_WEEK } from '#lib/player/club-words.ts';
import { HELD_PAGE_WORDS } from '#lib/player/held-words.ts';
import { STAT_COLUMNS, captionFor, type StatColumn } from '#lib/run/stat-columns.ts';
import type { Position } from '#lib/types/player.ts';
import type { AheadRow, LogHead, LogRow, PriorRow, SeasonLine } from '#lib/ui/game-log.ts';

export interface SeasonView {
	season: number;
	/** The block head's aside: "2026, PPR, through week 5". */
	aside: string;
	heads: LogHead[];
	pointsHead: LogHead;
	/** Null when he has no game yet, and the log prints `none` in its place. */
	line: SeasonLine | null;
	rows: LogRow[];
	ahead: AheadRow[];
	/** The one sentence a player with no line gets. */
	none: string;
	/** What the box leaves unsaid, null with nothing: its source is the page's one credit line and its
	 * scoring its aside (Lane 139, C22). */
	basis: string | null;
	/** His earlier seasons, newest first, collapsed under the box (Lane 66h). */
	prior: PriorRow[];
}

/** A week's game, from the run's schedule: its kickoff and its state at the run (Lane 80), null on a
 * run from before the field; null on his bye. The game is the row's (run/row-game.ts): a mover's week
 * under the club his line was for is that club's game (Lane 136). */
export type KickoffOf = (
	row: Pick<GameLogRow, 'week' | 'opponent' | 'home'>
) => { kickoff: string; state: Game['state'] | null } | null;

/** His weeks' games on the run's slates, by the row (run/row-game.ts). */
export function kickoffsFrom(slates: readonly Slate[], team: string): KickoffOf {
	const byClub = new Map(slates.map((slate) => [slate.abbr, slate] as const));
	if (!byClub.has(team)) throw new Error(`${team} has no slate on the run's schedule.`);
	return (row) => {
		const game = rowGame(byClub, team, row);
		return game === null ? null : { kickoff: game.kickoff, state: game.state ?? null };
	};
}

function opponentWords(row: GameLogRow): string {
	if (row.status === 'bye') return 'Bye';
	// An inactive week of a player who changed clubs before his newest line names no club (Lane 120).
	if (row.opponent === null) return UNKNOWN_CLUB_WEEK;
	return `${row.home === true ? 'vs' : 'at'} ${row.opponent}`;
}

function logRow(row: GameLogRow, columns: readonly StatColumn[]): LogRow {
	// The schema holds a played week to its points, so a played week here always has them.
	const points = row.status === 'played' ? row.points : null;
	const played = points !== null;
	return {
		week: row.week,
		opponent: opponentWords(row),
		note: row.status === 'inactive' && row.opponent !== null ? 'Did not play' : '',
		tone: played ? 'played' : row.status === 'bye' ? 'bye' : 'quiet',
		points: points === null ? null : fixed(points),
		cells: played ? columns.map((column) => column.value(row)) : null
	};
}

/** A week still to play's day: "Kicked off" or "Final" by the run's state where his stats are not in
 * yet (Lane 80), else its kickoff's day. */
function dayWords(game: NonNullable<ReturnType<KickoffOf>>): string {
	const { state } = game;
	return state === 'kicked_off' || state === 'final'
		? GAME_STATE_WORDS[state]
		: weekdayLabel(game.kickoff);
}

function aheadRow(row: GameLogRow, kickoffOf: KickoffOf): AheadRow {
	const bye = row.status === 'bye';
	const game = bye ? null : kickoffOf(row);
	// The run's reader holds every week still to play to a kickoff (season-checks.ts).
	if (!bye && game === null)
		throw new Error(`Week ${String(row.week)} against ${String(row.opponent)} has no kickoff.`);
	return {
		week: row.week,
		opponent: opponentWords(row),
		bye,
		day: game === null ? '' : dayWords(game)
	};
}

/** The weeks so far end where the first upcoming week begins; from there on, his bye included, the
 * weeks are still to play. */
function splitLog(log: readonly GameLogRow[]): [GameLogRow[], GameLogRow[]] {
	const first = log.findIndex((row) => row.status === 'upcoming');
	return first === -1 ? [[...log], []] : [log.slice(0, first), log.slice(first)];
}

/** A week past the records with no club to name: a free agent's (Lane 123), who has no game in it, so
 * the log lists no row for it rather than saying he did not play a week not yet played. */
function unnamedAhead(row: GameLogRow, through: number): boolean {
	return row.week > through && row.status === 'inactive' && row.opponent === null;
}

/** The box's own basis: only what neither its aside (the season and scoring) nor the page's credit line
 * (the stats' source, Lane 139, C22) says. Avg's tile names his games (review M6). */
function basisWords(season: PlayerSeason, position: Position): string | null {
	return season.games > 0 && position === 'QB' && season.totals.completions === null
		? 'Completions are not in our records yet.'
		: null;
}

function noneWords(season: PlayerSeason): string {
	const { through } = season;
	return through === 0
		? `The ${String(season.season)} season has not reached its first week.`
		: `He has no ${String(season.season)} stats through week ${String(through)}.`;
}

/** The season's points as the box adds them: the sum of the tenths each played row prints (review
 * M3), summed in whole tenths so no float drifts. */
function printedTotal(log: readonly GameLogRow[]): string {
	const tenths = log.reduce(
		(sum, row) =>
			row.status === 'played' && row.points !== null
				? sum + Math.round(Number(fixed(row.points)) * TENTHS)
				: sum,
		0
	);
	return fixed(tenths / TENTHS);
}

function seasonLine(
	season: PlayerSeason,
	columns: readonly StatColumn[],
	format: Format
): SeasonLine | null {
	if (season.games === 0 || season.pointsPerGame === null) return null;
	const perGame = fixed(season.pointsPerGame, POINTS_PER_GAME_DECIMALS);
	return {
		lead: 'Season',
		sub: `${plural(season.games, 'game')}, ${perGame} a game`,
		total: printedTotal(season.log),
		points: {
			value: perGame,
			caption: `${format.label} points a game`
		},
		cells: columns.map((column) => {
			const value = column.value(season.totals);
			return { value, caption: captionFor(column, value) };
		})
	};
}

/** An earlier season's row, worded like the season line. */
function priorRow(prior: PriorSeason, columns: readonly StatColumn[]): PriorRow {
	const perGame =
		prior.pointsPerGame === null
			? ''
			: `, ${fixed(prior.pointsPerGame, POINTS_PER_GAME_DECIMALS)} a game`;
	return {
		season: prior.season,
		sub: `${plural(prior.games, 'game')}${perGame}`,
		total: prior.totals.points === null ? '' : fixed(prior.totals.points),
		cells: columns.map((column) => column.value(prior.totals))
	};
}

/** The block of a page held back with no earlier copy (Lane 136): no line, no log, the one sentence in
 * the log's place, in the format the page leads with. */
export function heldSeasonView(year: number, position: Position, format: Format): SeasonView {
	return {
		season: year,
		aside: `${String(year)}, ${format.label}`,
		heads: STAT_COLUMNS[position].map(({ short, full }) => ({ short, full })),
		pointsHead: { short: 'Pts', full: `${format.label} points` },
		line: null,
		rows: [],
		ahead: [],
		none: HELD_PAGE_WORDS.log,
		basis: HELD_PAGE_WORDS.basis,
		prior: []
	};
}

export function seasonView(
	season: PlayerSeason,
	position: Position,
	formats: readonly Format[],
	kickoffOf: KickoffOf,
	prior: readonly PriorSeason[] = []
): SeasonView {
	const format = formats.find((candidate) => candidate.id === season.format);
	if (!format) throw new Error(`The season block is scored in ${season.format}, not on this run.`);
	const columns = STAT_COLUMNS[position];
	const [past, ahead] = splitLog(season.log);
	// The head never says week 5 over a table that has his week 6 (the sweep's X3).
	const through = countedWeek(season);
	const reach = through === 0 ? '' : `, through week ${String(through)}`;
	return {
		season: season.season,
		aside: `${String(season.season)}, ${format.label}${reach}`,
		heads: columns.map(({ short, full }) => ({ short, full })),
		pointsHead: { short: 'Pts', full: `${format.label} points` },
		line: seasonLine(season, columns, format),
		rows: past
			.filter((row) => !unnamedAhead(row, season.through))
			.map((row) => logRow(row, columns)),
		ahead: ahead.map((row) => aheadRow(row, kickoffOf)),
		none: noneWords(season),
		basis: basisWords(season, position),
		prior: prior.map((p) => priorRow(p, columns))
	};
}
