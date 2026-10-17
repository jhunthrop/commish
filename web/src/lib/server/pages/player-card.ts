/** The player card's words as the build knows them (Lane 66h): the rest-of-season tile from the run,
 * Avg and Last from his season so far, the tiles the week's read fills shown as "--" until it does,
 * the week ahead, and the read's stamp. The week's read (lib/player/live.ts) replaces what it holds. */
import { dayLabel } from '#lib/format/date.ts';
import { fixed, plural } from '#lib/format/number.ts';
import type { GameLogRow, PlayerSeason } from '#lib/run/season.ts';
import type { Capsule, Format, PlayerFormat } from '#lib/run/schema.ts';
import type { Position } from '#lib/types/player.ts';
import { CARD, NONE, type CardTile } from '#lib/player/card.ts';

/** The last week a rest-of-season figure counts, as the API's rest_of_season_per_game does. */
export const LAST_COUNTED_WEEK = 17;

export interface CardBuild {
	/** The tiles but rest of season, which each format line carries. */
	tiles: CardTile[];
	/** The week ahead with its opponent, null when the season has none left. */
	next: { week: number; opponent: string } | null;
	/** Each played week's opponent, "vs BUF", for Last's caption once the week is read. */
	opponents: Record<number, string>;
	/** "Written Oct 13, from his facts through last season", null when the run does not say. */
	readStamp: string | null;
	/** His games so far. */
	games: number;
}

function opponentWords(row: Pick<GameLogRow, 'opponent' | 'home'>): string {
	return row.opponent === null ? 'Bye' : `${row.home === true ? 'vs' : 'at'} ${row.opponent}`;
}

/** His rank at his position, "WR1". */
export function positionRank(position: Position, rank: number): string {
	return `${position}${String(rank)}`;
}

/** The games his club has from a week through the last counted week, byes out. */
export function gamesFrom(season: PlayerSeason, fromWeek: number): number {
	return season.log.filter(
		(row) => row.week >= fromWeek && row.week <= LAST_COUNTED_WEEK && row.opponent !== null
	).length;
}

/** The rest-of-season tile in a format: in season his points from the board's first week with his
 * points a game and his place at his position in our order; on a preseason board his projection for
 * the season. */
export function restTile(
	format: Format,
	numbers: PlayerFormat,
	season: PlayerSeason,
	position: Position,
	year: number
): CardTile {
	const rank = positionRank(position, numbers.positionRank);
	const from = format.rosFromWeek;
	if (from === undefined) {
		return {
			key: 'rest',
			label: CARD.projected,
			value: fixed(numbers.projected),
			caption: `${format.label} points for ${String(year)}, ${rank} in our order`,
			tone: null
		};
	}
	const games = gamesFrom(season, from);
	const perGame = games === 0 ? '' : `, ${fixed(numbers.projected / games)} a game`;
	return {
		key: 'rest',
		label: CARD.rest,
		value: fixed(numbers.projected),
		caption: `from week ${String(from)}${perGame}, ${rank} in our order`,
		tone: null
	};
}

/** The read's stamp: its day, and the facts it was written from. */
export function readStamp(capsule: Capsule | null): string | null {
	if (capsule?.writtenAt === undefined) return null;
	return `Written ${dayLabel(capsule.writtenAt)}, ${CARD.writtenFrom}`;
}

function lastPlayed(season: PlayerSeason): GameLogRow | null {
	return season.log.findLast((row) => row.status === 'played' && row.points !== null) ?? null;
}

export function cardBuild(season: PlayerSeason, capsule: Capsule | null): CardBuild {
	const upcoming = season.log.find((row) => row.status === 'upcoming' && row.opponent !== null);
	const last = lastPlayed(season);
	const opponents = Object.fromEntries(
		season.log.filter((row) => row.status === 'played').map((row) => [row.week, opponentWords(row)])
	);
	const next = upcoming ? { week: upcoming.week, opponent: opponentWords(upcoming) } : null;
	const avg = season.pointsPerGame;
	const tiles: CardTile[] = [
		{
			key: 'proj',
			label: CARD.proj,
			value: NONE,
			caption: next ? `${CARD.week} ${String(next.week)}` : '',
			tone: 'lead'
		},
		{ key: 'opp', label: CARD.opp, value: NONE, caption: next?.opponent ?? '', tone: null },
		{
			key: 'avg',
			label: CARD.avg,
			value: avg === null ? NONE : fixed(avg),
			caption: avg === null ? '' : `a game in ${plural(season.games, 'game')}`,
			tone: null
		},
		{
			key: 'last',
			label: CARD.last,
			value: last?.points == null ? NONE : fixed(last.points),
			caption: last ? `week ${String(last.week)} ${opponentWords(last)}` : '',
			tone: null
		},
		{ key: 'delta', label: CARD.delta, value: NONE, caption: '', tone: 'quiet' }
	];
	return { tiles, next, opponents, readStamp: readStamp(capsule), games: season.games };
}
