/** How far the season's figures reach, as every screen's "through week" says it (Lane 80, the sweep's
 * M2 and Y2): the last week whose games are all in, then the next week's games named by their day
 * ("week 6's Thursday game"). The bases count only games some player's counts hold (countedReach), so
 * a basis over a Sunday player's GP never claims his week 6, even once his game is final by the
 * hourly status; the schedule sets back every game final by its state (finalsReach). */
import { weekdayWord } from '#lib/format/date.ts';
import type { Game, Slate } from './schema.ts';
import type { GameLogRow, PlayerSeason } from './season.ts';

/** What a season's reach reads of a season block: its through week and its log's statuses. */
export type CountedSeason = Pick<PlayerSeason, 'through'> & {
	/** Each week's status, and its opponent where the caller has it (none named: no game). */
	log: readonly (Pick<GameLogRow, 'week' | 'status'> & { opponent?: GameLogRow['opponent'] })[];
};

/** The week his season's figures reach (the ruling on the sweep's X3): the run's through week, or his
 * own later game already in the records (played, or inactive once his club's game is in), as a
 * Thursday game is before Sunday's are. A player page's head says it as his own ("through week 5"). A
 * week naming no opponent holds no game (a free agent's, Lane 123), so it reaches nothing. */
export function countedWeek(season: CountedSeason): number {
	return season.log.reduce(
		(week, row) =>
			row.status === 'played' || (row.status === 'inactive' && row.opponent !== null)
				? Math.max(week, row.week)
				: week,
		season.through
	);
}

/** The newest week any player's counted game belongs to; 0 with no season block. */
export function newestCountedWeek(seasons: readonly CountedSeason[]): number {
	return seasons.reduce((week, season) => Math.max(week, countedWeek(season)), 0);
}

export interface Reach {
	/** The last week whose games are all in, 0 before week 1's. */
	complete: number;
	/** The week after it with some games in: their days in kickoff order (empty on a run with no
	 * states) and how many games; null with none. */
	partial: { week: number; days: string[]; games: number } | null;
}

type SlateGames = Pick<Slate, 'abbr'> & {
	games: readonly Pick<Game, 'week' | 'opponent' | 'kickoff' | 'state'>[];
};

/** Each game of a week once (both clubs' sides are one game), keyed by its two clubs. */
function gameKey(club: string, opponent: string): string {
	return [club, opponent].sort().join('-');
}

/** A partial week from its games' kickoffs: their days in kickoff order and how many. */
function partialOf(week: number, kickoffs: readonly string[]): NonNullable<Reach['partial']> {
	const ordered = [...kickoffs].sort((a, b) => Date.parse(a) - Date.parse(b));
	return { week, days: [...new Set(ordered.map(weekdayWord))], games: ordered.length };
}

/** What the bases' "through week" says (review finding 1): the complete week, then the next week's
 * games a player's counts hold (a played or inactive row in his log, his club's game by the
 * schedule), never a game final by status alone with no line behind it. A counted club the schedule
 * does not place says "part of the week". */
export function countedReach(
	seasons: readonly (CountedSeason & { team: string })[],
	slates: readonly SlateGames[],
	complete: number
): Reach {
	const newest = newestCountedWeek(seasons);
	if (newest <= complete) return { complete, partial: null };
	const clubs = new Set(
		seasons
			.filter((s) =>
				s.log.some((r) => r.week === newest && (r.status === 'played' || r.status === 'inactive'))
			)
			.map((s) => s.team)
	);
	const kickoffs = new Map<string, string>();
	let placed = true;
	for (const club of clubs) {
		const game = slates.find((s) => s.abbr === club)?.games.find((g) => g.week === newest);
		if (game === undefined) placed = false;
		else kickoffs.set(gameKey(club, game.opponent), game.kickoff);
	}
	return placed
		? { complete, partial: partialOf(newest, [...kickoffs.values()]) }
		: { complete, partial: { week: newest, days: [], games: 0 } };
}

/** What the schedule sets back (the run's game states): the complete week, then the next week's
 * games final by their state, a status final included. */
export function finalsReach(slates: readonly SlateGames[], complete: number): Reach {
	const week = complete + 1;
	const kickoffs = new Map<string, string>();
	for (const slate of slates) {
		for (const game of slate.games) {
			if (game.week === week && game.state === 'final')
				kickoffs.set(gameKey(slate.abbr, game.opponent), game.kickoff);
		}
	}
	return kickoffs.size === 0
		? { complete, partial: null }
		: { complete, partial: partialOf(week, [...kickoffs.values()]) };
}

const joinAnd = (words: readonly string[]): string =>
	words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;

/** "week 6's Thursday game", "week 16's Thursday and Saturday games", "part of week 6". */
function partialWords(partial: NonNullable<Reach['partial']>): string {
	const { week, days, games } = partial;
	if (days.length === 0) return `part of week ${String(week)}`;
	return `week ${String(week)}'s ${joinAnd(days)} ${games === 1 ? 'game' : 'games'}`;
}

/** "through week 5", "through week 5 and week 6's Thursday game", "" before week 1's games. */
export function reachWords(reach: Reach): string {
	const { complete, partial } = reach;
	const whole = complete === 0 ? '' : `week ${String(complete)}`;
	if (partial === null) return whole === '' ? '' : `through ${whole}`;
	return `through ${whole === '' ? '' : `${whole} and `}${partialWords(partial)}`;
}

/** The schedule's faded weeks: "weeks 1 to 5 and week 6's Thursday game are played", "week 1 is
 * played", "" before any game is in. */
export function playedThroughWords(reach: Reach): string {
	const { complete, partial } = reach;
	const whole = complete === 0 ? '' : complete === 1 ? 'week 1' : `weeks 1 to ${String(complete)}`;
	const parts = [whole, partial === null ? '' : partialWords(partial)].filter((p) => p !== '');
	if (parts.length === 0) return '';
	const many = complete > 1 || parts.length > 1 || (partial?.games ?? 0) > 1;
	return `${parts.join(' and ')} ${many ? 'are' : 'is'} played`;
}
