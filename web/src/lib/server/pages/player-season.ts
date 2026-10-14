/** A player's "This season" block, worded at build: the head's aside, the season line, the game log
 * so far, the weeks still to play with their kickoff days, the basis line, or the one sentence a
 * player with no line gets. */
import { weekdayLabel } from '#lib/format/date.ts';
import { fixed, plural } from '#lib/format/number.ts';
import { POINTS_PER_GAME_DECIMALS, type GameLogRow, type PlayerSeason } from '#lib/run/season.ts';
import type { Format } from '#lib/run/schema.ts';
import { STAT_COLUMNS, captionFor, type StatColumn } from '#lib/run/stat-columns.ts';
import type { Position } from '#lib/types/player.ts';
import type { AheadRow, LogHead, LogRow, SeasonLine } from '#lib/ui/game-log.ts';

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
	basis: string;
}

/** His kickoff in a week, from the run's schedule, or null on his bye. */
export type KickoffOf = (week: number) => string | null;

function opponentWords(row: GameLogRow): string {
	if (row.opponent === null) return 'Bye';
	return `${row.home === true ? 'vs' : 'at'} ${row.opponent}`;
}

function logRow(row: GameLogRow, columns: readonly StatColumn[]): LogRow {
	// The schema holds a played week to its points, so a played week here always has them.
	const points = row.status === 'played' ? row.points : null;
	const played = points !== null;
	return {
		week: row.week,
		opponent: opponentWords(row),
		note: row.status === 'inactive' ? 'Did not play' : '',
		tone: played ? 'played' : row.status === 'bye' ? 'bye' : 'quiet',
		points: points === null ? null : fixed(points),
		cells: played ? columns.map((column) => column.value(row)) : null
	};
}

function aheadRow(row: GameLogRow, kickoffOf: KickoffOf): AheadRow {
	const bye = row.opponent === null;
	const kickoff = bye ? null : kickoffOf(row.week);
	// The run's reader holds every week still to play to a kickoff (season-checks.ts).
	if (!bye && kickoff === null)
		throw new Error(`Week ${String(row.week)} against ${String(row.opponent)} has no kickoff.`);
	return {
		week: row.week,
		opponent: opponentWords(row),
		bye,
		day: kickoff === null ? '' : weekdayLabel(kickoff)
	};
}

/** The weeks so far end where the first upcoming week begins; from there on, his bye included, the
 * weeks are still to play. */
function splitLog(log: readonly GameLogRow[]): [GameLogRow[], GameLogRow[]] {
	const first = log.findIndex((row) => row.status === 'upcoming');
	return first === -1 ? [[...log], []] : [log.slice(0, first), log.slice(first)];
}

function basisWords(season: PlayerSeason, position: Position, format: Format): string {
	const source = `Stat lines from the NFL's records, scored in ${format.label}`;
	if (season.games === 0) return `${source}.`;
	const parts = [`${source}, averaged over the ${plural(season.games, 'game')} he played.`];
	if (position === 'QB' && season.totals.completions === null)
		parts.push('Completions are not in our records yet.');
	return parts.join(' ');
}

function noneWords(season: PlayerSeason): string {
	const { through } = season;
	return through === 0
		? `The ${String(season.season)} season has not reached its first week.`
		: `He has no ${String(season.season)} stat line through week ${String(through)}.`;
}

function seasonLine(
	season: PlayerSeason,
	columns: readonly StatColumn[],
	format: Format
): SeasonLine | null {
	if (season.games === 0 || season.pointsPerGame === null) return null;
	return {
		lead: 'Season',
		sub: plural(season.games, 'game'),
		points: {
			value: fixed(season.pointsPerGame, POINTS_PER_GAME_DECIMALS),
			caption: `${format.label} points a game`
		},
		cells: columns.map((column) => {
			const value = column.value(season.totals);
			return { value, caption: captionFor(column, value) };
		})
	};
}

export function seasonView(
	season: PlayerSeason,
	position: Position,
	formats: readonly Format[],
	kickoffOf: KickoffOf
): SeasonView {
	const format = formats.find((candidate) => candidate.id === season.format);
	if (!format) throw new Error(`The season block is scored in ${season.format}, not on this run.`);
	const columns = STAT_COLUMNS[position];
	const [past, ahead] = splitLog(season.log);
	const reach = season.through === 0 ? '' : `, through week ${String(season.through)}`;
	return {
		season: season.season,
		aside: `${String(season.season)}, ${format.label}${reach}`,
		heads: columns.map(({ short, full }) => ({ short, full })),
		pointsHead: { short: 'Pts', full: `${format.label} points` },
		line: seasonLine(season, columns, format),
		rows: past.map((row) => logRow(row, columns)),
		ahead: ahead.map((row) => aheadRow(row, kickoffOf)),
		none: noneWords(season),
		basis: basisWords(season, position, format)
	};
}
