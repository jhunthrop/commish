/** A player's "This season" block, worded at build: the season line, the game log, the basis line,
 * or the one sentence a player with no line gets. */
import { fixed, plural } from '#lib/format/number.ts';
import { POINTS_PER_GAME_DECIMALS, type GameLogRow, type PlayerSeason } from '#lib/run/season.ts';
import type { Format } from '#lib/run/schema.ts';
import { STAT_COLUMNS, type StatColumn } from '#lib/run/stat-columns.ts';
import type { Position } from '#lib/types/player.ts';
import type { LogHead, LogRow, SeasonLine } from '#lib/ui/game-log.ts';

export interface SeasonView {
	season: number;
	/** The format's chip word: "PPR". */
	scoring: string;
	heads: LogHead[];
	/** Null when he has no game yet, and the log prints `none` in its place. */
	line: SeasonLine | null;
	rows: LogRow[];
	/** The one sentence a player with no line gets. */
	none: string;
	basis: string;
}

/** An inactive week says why across its stat columns. An upcoming week and a bye leave them blank:
 * the opponent and the basis line's "through week" say enough. */
const NOTES: Readonly<Record<GameLogRow['status'], string>> = {
	played: '',
	inactive: 'No stat line',
	bye: '',
	upcoming: ''
};

function opponentWords(row: GameLogRow): string {
	if (row.opponent === null) return 'Bye';
	return `${row.home === true ? 'vs' : 'at'} ${row.opponent}`;
}

function logRow(row: GameLogRow, columns: readonly StatColumn[]): LogRow {
	const played = row.status === 'played';
	return {
		week: row.week,
		opponent: opponentWords(row),
		tone: played ? 'played' : row.status === 'bye' ? 'bye' : 'quiet',
		cells:
			played && row.points !== null
				? [...columns.map((column) => column.value(row)), fixed(row.points)]
				: null,
		note: NOTES[row.status]
	};
}

function basisWords(season: PlayerSeason, position: Position, format: Format): string {
	const { through } = season;
	const reach = through === 0 ? '' : ` through week ${String(through)}`;
	const parts = [`Stat lines from the league's own records${reach}, scored in ${format.label}.`];
	if (season.games > 0) {
		parts.push(`Points a game average the ${plural(season.games, 'game')} he played.`);
		if (STAT_COLUMNS[position].some((column) => column.snaps))
			parts.push("Snap % is his share of his team's offensive snaps.");
		if (position === 'QB' && season.totals.completions === null)
			parts.push('Completions are not in our records yet.');
	}
	return parts.join(' ');
}

function noneWords(season: PlayerSeason): string {
	const { through } = season;
	return through === 0
		? `The ${String(season.season)} season has not reached its first week.`
		: `He has no ${String(season.season)} stat line through week ${String(through)}.`;
}

export function seasonView(
	season: PlayerSeason,
	position: Position,
	formats: readonly Format[]
): SeasonView {
	const format = formats.find((candidate) => candidate.id === season.format);
	if (!format) throw new Error(`The season block is scored in ${season.format}, not on this run.`);
	const columns = STAT_COLUMNS[position];
	const played = season.games > 0 && season.pointsPerGame !== null;
	return {
		season: season.season,
		scoring: format.label,
		heads: [
			...columns.map(({ short, full }) => ({ short, full })),
			{ short: 'Pts', full: `${format.label} points` }
		],
		line:
			played && season.pointsPerGame !== null
				? {
						lead: 'Season',
						sub: plural(season.games, 'game'),
						cells: [
							...columns.map((column) => ({
								value: column.value(season.totals),
								caption: column.full
							})),
							{
								value: fixed(season.pointsPerGame, POINTS_PER_GAME_DECIMALS),
								caption: `${format.label} points a game`
							}
						]
					}
				: null,
		rows: season.log.map((row) => logRow(row, columns)),
		none: noneWords(season),
		basis: basisWords(season, position, format)
	};
}
