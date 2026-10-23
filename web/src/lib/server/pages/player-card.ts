/** The player card's words as the build knows them (Lane 66h): the rest-of-season tile from the run,
 * Avg and Last from his season so far, the tiles the week's read fills shown as "--" until it does,
 * the week ahead, and the read's stamp. The week's read (lib/player/live.ts) replaces what it holds. */
import { dayLabel } from '#lib/format/date.ts';
import { FIGURE, weekHead } from '#lib/format/figure-words.ts';
import { fixed, plural } from '#lib/format/number.ts';
import { countedWeek } from '#lib/run/reach.ts';
import type { GameLogRow, PlayerSeason } from '#lib/run/season.ts';
import { apiFormatOf } from '#lib/run/format-ids.ts';
import { positionRankShown } from '#lib/run/held-places.ts';
import { playerRestFrom, playerRestWords, restSpanWords } from '#lib/run/rest-from.ts';
import type { Capsule, Format, PlayerFormat, PlayerStatus } from '#lib/run/schema.ts';
import type { Position } from '#lib/types/player.ts';
import { BASIS_WORDS, mayMissGames, vsAvgReason } from '#lib/player/basis-words.ts';
import {
	CARD,
	NONE,
	restRankWords,
	type BasisTile,
	type CardHead,
	type CardTile,
	type RestParts,
	type TileScoring
} from '#lib/player/card.ts';

export interface CardBuild {
	/** The tiles but rest of season, which each format line carries. */
	tiles: CardTile[];
	/** The week ahead with its opponent, or "Bye" when it is his bye, null when the season has none
	 * left. */
	next: CardHead | null;
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

/** His rank in words in a format, by Lane 63's held rule (the board's and the pill's). */
function rankIn(
	numbers: PlayerFormat,
	position: Position,
	status: PlayerStatus | undefined
): string {
	return restRankWords(
		position,
		positionRankShown({ positionRank: numbers.positionRank, ...(status ? { status } : {}) })
	);
}

/** The scoring a run format's points are in, by the API's names: superflex scores PPR. */
function scoringOf(format: Format): TileScoring {
	const api = apiFormatOf(format);
	return api === 'half_ppr' || api === 'standard' ? api : 'ppr';
}

/** The rest-of-season tile in a format: in season his points from the board's first week and his
 * place at his position in our order (his points a game arrive with the week's read, in the tile's
 * own scoring, review L14, N2); on a preseason board his projection for the season. A player on a
 * season-long list shows Lane 63's word, never the rank his figure would earn (review N1). */
export function restTile(
	format: Format,
	numbers: PlayerFormat,
	position: Position,
	year: number,
	status: PlayerStatus | undefined
): CardTile {
	const rank = rankIn(numbers, position, status);
	if (format.rosFromWeek === undefined) {
		return {
			key: 'rest',
			label: CARD.projected,
			value: fixed(numbers.projected),
			caption: `${format.label} points for ${String(year)}, ${rank}`,
			tone: null
		};
	}
	return {
		key: 'rest',
		label: CARD.rest,
		value: fixed(numbers.projected),
		caption: `${restSpanWords(playerRestFrom(format, numbers))}, ${rank}`,
		tone: null
	};
}

/** The tile's parts the week's read words its caption from, null on a preseason board. */
export function restParts(
	format: Format,
	numbers: PlayerFormat,
	position: Position,
	status: PlayerStatus | undefined
): RestParts | null {
	if (format.rosFromWeek === undefined) return null;
	return {
		from: playerRestWords(playerRestFrom(format, numbers)),
		span: restSpanWords(playerRestFrom(format, numbers)),
		board: apiFormatOf(format),
		rank: rankIn(numbers, position, status),
		scoring: scoringOf(format),
		label: format.label
	};
}

/** The games his club has still to play on the run, from his log; null with no season to count in
 * (Lane 165, D17). */
export function gamesLeftOf(season: PlayerSeason | null): number | null {
	if (season === null) return null;
	return season.log.filter((row) => row.status === 'upcoming' && row.opponent !== null).length;
}

/** The in-season row under the tiles in a format (Lane 100, B17 and B51): the pace a game the order
 * starts from, as the run stores it, and our rest-of-season rate a game against his Avg, which the
 * week's read fills (Lane 139, C08). His preseason figure for the full season is not drawn beside the
 * pace (C09): it is the served board's over its own games, the pace the raw line's, so the two never
 * reconcile on the card. None preseason or for a player the preseason board did not rank. The reason
 * beside the rate is said only with the stored pace it rests on, its share when the run says it. */
export function basisTiles(
	format: Format,
	numbers: PlayerFormat,
	games: number,
	gamesLeft: number | null
): BasisTile[] {
	const points = numbers.preseasonPoints ?? null;
	if (format.rosFromWeek === undefined || points === null) return [];
	const pace = numbers.preseasonPerGame ?? null;
	return [
		...(pace === null
			? []
			: [
					{
						key: 'pace' as const,
						label: BASIS_WORDS.pace,
						value: fixed(pace),
						caption: BASIS_WORDS.paceCaption,
						reason: null,
						mayMiss: false
					}
				]),
		{
			key: 'vsAvg',
			label: BASIS_WORDS.vsAvg,
			value: NONE,
			caption: BASIS_WORDS.vsAvgCaption,
			reason:
				pace === null
					? null
					: vsAvgReason({
							games,
							blended: numbers.blendedPerGame ?? null,
							share: numbers.preseasonShare ?? null,
							rate: numbers.ratePerGame ?? null
						}),
			mayMiss: mayMissGames(numbers.expectedGames, gamesLeft)
		}
	];
}

/** The read's stamp: its day, and the facts it was written from. */
export function readStamp(capsule: Capsule | null): string | null {
	if (capsule?.writtenAt === undefined) return null;
	return `Written ${dayLabel(capsule.writtenAt)}, ${CARD.writtenFrom}`;
}

function lastPlayed(season: PlayerSeason): GameLogRow | null {
	return season.log.findLast((row) => row.status === 'played' && row.points !== null) ?? null;
}

/** The week ahead: the first week past his counted one that is a game to play or his bye, so a bye
 * week heads the card as the bye, never the game after it (the sweep's M6). */
function weekAhead(season: PlayerSeason): GameLogRow | null {
	const counted = countedWeek(season);
	return (
		season.log.find(
			(row) =>
				row.week > counted &&
				(row.status === 'bye' || (row.status === 'upcoming' && row.opponent !== null))
		) ?? null
	);
}

/** The card as built; with no season (a page held back with no copy, Lane 136) Avg and Last are empty
 * and no week heads it. */
export function cardBuild(season: PlayerSeason | null, capsule: Capsule | null): CardBuild {
	const upcoming = season === null ? null : weekAhead(season);
	const last = season === null ? null : lastPlayed(season);
	const opponents = Object.fromEntries(
		(season?.log ?? [])
			.filter((row) => row.status === 'played')
			.map((row) => [row.week, opponentWords(row)])
	);
	const next = upcoming ? { week: upcoming.week, opponent: opponentWords(upcoming) } : null;
	const avg = season?.pointsPerGame ?? null;
	const games = season?.games ?? 0;
	const tiles: CardTile[] = [
		{
			key: 'proj',
			// The run's week ahead heads it until the API's read arrives; never the reader's clock.
			label: next ? weekHead(next.week) : FIGURE.week,
			value: NONE,
			caption: CARD.readOnOpen,
			tone: 'lead'
		},
		{ key: 'opp', label: CARD.opp, value: NONE, caption: next?.opponent ?? '', tone: null },
		{
			key: 'avg',
			label: CARD.avg,
			value: avg === null ? NONE : fixed(avg),
			caption: avg === null ? '' : `a game in ${plural(games, 'game')}`,
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
	return { tiles, next, opponents, readStamp: readStamp(capsule), games };
}
