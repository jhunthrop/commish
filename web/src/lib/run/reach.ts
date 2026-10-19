/** How far the season's figures reach, as every screen's "through week" says it (Lane 80, the sweep's
 * M2 and Y2): the last week whose games are all in, then the next week's games the run already holds
 * final, named by their day ("week 6's Thursday game"), so a basis over a Sunday player's GP never
 * claims his week 6. The days come from the schedule's game states (schedule.json); a run from before
 * them says "part of week 6" once any player's counted game is past the complete week. */
import { weekdayWord } from '#lib/format/date.ts';
import type { Game, Slate } from './schema.ts';
import type { GameLogRow, PlayerSeason } from './season.ts';

/** What a season's reach reads of a season block: its through week and its log's statuses. */
export type CountedSeason = Pick<PlayerSeason, 'through'> & {
	log: readonly Pick<GameLogRow, 'week' | 'status'>[];
};

/** The week his season's figures reach (the ruling on the sweep's X3): the run's through week, or his
 * own later game already in the records (played, or inactive once his club's game is in), as a
 * Thursday game is before Sunday's are. A player page's head says it as his own ("through week 5"). */
export function countedWeek(season: CountedSeason): number {
	return season.log.reduce(
		(week, row) =>
			row.status === 'played' || row.status === 'inactive' ? Math.max(week, row.week) : week,
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

/** The final games of a week, each once (both clubs' sides are one game), in kickoff order. */
function finalGames(slates: readonly SlateGames[], week: number): string[] {
	const kickoffs = new Map<string, string>();
	for (const slate of slates) {
		for (const game of slate.games) {
			if (game.week !== week || game.state !== 'final') continue;
			kickoffs.set([slate.abbr, game.opponent].sort().join('-'), game.kickoff);
		}
	}
	return [...kickoffs.values()].sort((a, b) => Date.parse(a) - Date.parse(b));
}

export function reachOf(
	seasons: readonly CountedSeason[],
	slates: readonly SlateGames[],
	complete: number
): Reach {
	const week = complete + 1;
	const finals = finalGames(slates, week);
	if (finals.length > 0) {
		const days = [...new Set(finals.map(weekdayWord))];
		return { complete, partial: { week, days, games: finals.length } };
	}
	const newest = newestCountedWeek(seasons);
	return newest > complete
		? { complete, partial: { week: newest, days: [], games: 0 } }
		: { complete, partial: null };
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
