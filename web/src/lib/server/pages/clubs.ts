/** The clubs index, a club's page and the strength of schedule page, from clubs.json, schedule.json
 * and the default board. */
import { error } from '@sveltejs/kit';
import { rangeScale } from '#lib/run/derive.ts';
import type { BoardRow, Club, Format, Game, Schedule, Slate } from '#lib/run/schema.ts';
import type { RangeScale } from '#lib/types/player.ts';
import { board, clubs, defaultFormat, schedule } from '../run.ts';

const NOT_FOUND = 404;

export interface ClubCard extends Club {
	slate: Slate;
	/** His best-ranked player on the default board, or null for a club with none. */
	lead: BoardRow | null;
	players: number;
}

export interface ClubsPage {
	format: Format;
	clubs: ClubCard[];
}

export interface ScheduleGame extends Game {
	/** The opponent's own value in the schedule's basis. */
	value: number;
}

export interface ClubPage {
	club: Club;
	format: Format;
	slate: Slate;
	games: ScheduleGame[];
	schedule: Pick<Schedule, 'opponentBasis' | 'season'>;
	rows: BoardRow[];
	scale: RangeScale | null;
	clubs: Club[];
}

export interface SchedulePage {
	schedule: Schedule;
	clubs: Club[];
	weeks: number[];
}

/** An opponent's value. The run's schema guarantees one for every opponent on a slate. */
function opponentValue(loaded: Schedule, abbr: string): number {
	const value = loaded.opponentValues[abbr];
	if (value === undefined) throw new Error(`schedule.json has no value for ${abbr}.`);
	return value;
}

function slateOf(loaded: Schedule, abbr: string): Slate {
	const slate = loaded.slates.find((candidate) => candidate.abbr === abbr);
	if (!slate) throw new Error(`schedule.json has no slate for ${abbr}.`);
	return slate;
}

export async function clubsPage(): Promise<ClubsPage> {
	const format = await defaultFormat();
	const [list, loaded, rows] = await Promise.all([clubs(), schedule(), board(format.id)]);
	return {
		format,
		clubs: list.map((club) => {
			const own = rows.rows.filter((row) => row.team === club.abbr);
			return {
				...club,
				slate: slateOf(loaded, club.abbr),
				lead: own[0] ?? null,
				players: own.length
			};
		})
	};
}

export async function clubEntries(): Promise<{ abbr: string }[]> {
	return (await clubs()).map((club) => ({ abbr: club.abbr.toLowerCase() }));
}

export async function clubPage(abbr: string): Promise<ClubPage> {
	const format = await defaultFormat();
	const [list, loaded, rows] = await Promise.all([clubs(), schedule(), board(format.id)]);
	const club = list.find((candidate) => candidate.abbr.toLowerCase() === abbr);
	if (!club) error(NOT_FOUND, 'No such club.');
	const slate = slateOf(loaded, club.abbr);
	const own = rows.rows.filter((row) => row.team === club.abbr);
	return {
		club,
		format,
		slate,
		games: slate.games.map((game) => ({
			...game,
			value: opponentValue(loaded, game.opponent)
		})),
		schedule: { opponentBasis: loaded.opponentBasis, season: loaded.season },
		rows: own,
		scale: own.length > 0 ? rangeScale(own) : null,
		clubs: list
	};
}

export async function schedulePage(): Promise<SchedulePage> {
	const [loaded, list] = await Promise.all([schedule(), clubs()]);
	const lastWeek = Math.max(
		...loaded.slates.flatMap((slate) => slate.games.map((game) => game.week))
	);
	return {
		schedule: { ...loaded, slates: [...loaded.slates].sort((a, b) => a.rank - b.rank) },
		clubs: list,
		weeks: Array.from({ length: lastWeek }, (_, i) => i + 1)
	};
}
