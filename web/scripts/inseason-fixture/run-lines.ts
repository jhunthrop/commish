// The fixture's one line builder (Lane 132, B111): a player line from a run's board row, schedule and
// game logs, as build.ts has drawn every line since Lane 25. build.ts builds the whole fixture with it
// from a rest-of-season run; project.ts builds with it the lines of the free agents the stand-in run's
// capture lists, which the fixture's waiver answer keeps. Every figure is the run's own:
//   - position_rank and points_over_replacement are the run's PPR board row (the latter a week, over
//     the weeks the order covers);
//   - rest_of_season_per_game is the row's points over his club's games from the run's first week
//     through week 17 (a full-season run's first week is week 1), byes out;
//   - last_games are the run's game logs scored with the league's own rules;
//   - the week's opponent, home, kickoff and bye are the run's schedule, its expected score and
//     weather the recorded week's game facts (data/games.json).
// The week's projection, the evidence and any designation are project.ts's to stamp.
import { readFile, readdir } from 'node:fs/promises';
import type { LeaguePlayer } from '../../src/lib/league/api.ts';
import type {
	PlayerLine,
	WaiverAdvice,
	WaiverRow,
	WeekFacts
} from '../../src/lib/league/inseason/api.ts';
import type { GameWeek } from '../../src/lib/format/game-facts.ts';
import { LAST_FANTASY_WEEK } from './week.ts';

const LAST_GAMES = 3;
const TENTH = 10;
const DECIMALS = 100;

export const round = (n: number): number => Math.round(n * DECIMALS) / DECIMALS;
export const tenth = (n: number): number => Math.round(n * TENTH) / TENTH;

export async function json<T>(url: URL): Promise<T> {
	return JSON.parse(await readFile(url, 'utf8')) as T;
}

export interface BoardRow {
	id: string;
	slug: string;
	headshot: string | null;
	name: string;
	position: string;
	team: string;
	positionRank: number;
	vor: number;
	/** His points over the weeks the run ranks, null without a projection. */
	projected: number | null;
	/** A kicker's or a defense's row in draft order (the board's market rows). */
	orderBasis?: string;
}

export interface Game {
	week: number;
	opponent: string;
	home: boolean;
	kickoff: string;
}

interface LogLine extends Record<string, number | string | boolean> {
	week: number;
	status: string;
}

export interface RunLineInputs {
	/** The run's folder under web/.runs/runs/. */
	run: URL;
	rows: readonly BoardRow[];
	slates: readonly { abbr: string; games: Game[] }[];
	/** The run's first week; a full-season run ranks from week 1. */
	fromWeek: number;
	/** The league's week the lines are for. */
	week: number;
	/** The weeks the rest-of-season order covers from the league's week. */
	weeksCovered: number;
	/** The league's scoring rules (Sleeper's scoring_settings). */
	scoring: Readonly<Record<string, number>>;
	/** The recorded week's game facts (data/games.json). */
	gameFacts: GameWeek;
}

export interface RunLines {
	lineOf: (player: LeaguePlayer) => Promise<PlayerLine>;
	boardLine: (row: BoardRow) => Promise<PlayerLine>;
}

const NO_FACTS = { game_total: null, spread: null, roof: null, weather: null } as const;

export async function runLines(inputs: RunLineInputs): Promise<RunLines> {
	const { run, week, scoring } = inputs;
	const boardById = new Map(inputs.rows.map((r) => [r.id, r] as const));
	const games = new Map(inputs.slates.map((s) => [s.abbr, s.games] as const));
	const gamesLeft = new Map(
		inputs.slates.map(
			(s) =>
				[
					s.abbr,
					s.games.filter((g) => g.week >= inputs.fromWeek && g.week <= LAST_FANTASY_WEEK).length
				] as const
		)
	);
	const facts = new Map(inputs.gameFacts.games.map((g) => [g.team, g] as const));
	const playerFiles = new Set(await readdir(new URL('players/', run)));

	/** His rest-of-season points a game, as the API's RestOfSeasonPerGame divides them. */
	const perGameOf = (row: BoardRow | null): number | null => {
		const projected = row?.projected ?? null;
		const left = row === null ? 0 : (gamesLeft.get(row.team) ?? 0);
		return projected === null || left === 0 ? null : tenth(projected / left);
	};

	/** Points under the league's own rules from one game's stat line. Two-point plays are not in the
	 * log, so they are not counted. */
	const leaguePoints = (line: LogLine): number => {
		const n = (field: string): number => Number(line[field] ?? 0);
		return round(
			n('passing_yards') * (scoring.pass_yd ?? 0) +
				n('passing_touchdowns') * (scoring.pass_td ?? 0) +
				n('interceptions') * (scoring.pass_int ?? 0) +
				n('rushing_yards') * (scoring.rush_yd ?? 0) +
				n('rushing_touchdowns') * (scoring.rush_td ?? 0) +
				n('receptions') * (scoring.rec ?? 0) +
				n('receiving_yards') * (scoring.rec_yd ?? 0) +
				n('receiving_touchdowns') * (scoring.rec_td ?? 0) +
				n('fumbles_lost') * (scoring.fum_lost ?? 0)
		);
	};

	const lastGames = async (boardId: string | null): Promise<WeekFacts['last_games']> => {
		if (boardId === null || !playerFiles.has(`${boardId}.json`)) return [];
		const file = await json<{ season: { log: LogLine[] } }>(
			new URL(`players/${boardId}.json`, run)
		);
		return file.season.log
			.filter((g) => g.status === 'played')
			.slice(-LAST_GAMES)
			.reverse()
			.map((g) => ({ week: g.week, points: leaguePoints(g) }));
	};

	const factsFor = async (team: string, boardId: string | null): Promise<WeekFacts> => {
		const game = games.get(team)?.find((g) => g.week === week) ?? null;
		const held = game === null ? undefined : facts.get(team);
		return {
			week,
			opponent: game?.opponent ?? null,
			home: game?.home ?? null,
			kickoff: game?.kickoff ?? null,
			bye: game === null,
			designation: null,
			played: false,
			points_this_week: null,
			last_games: await lastGames(boardId),
			allowed_to_position: null,
			...(held === undefined
				? NO_FACTS
				: {
						game_total: held.game_total,
						spread: held.spread,
						roof: held.roof,
						weather: held.weather
					})
		};
	};

	const lineOf = async (player: LeaguePlayer): Promise<PlayerLine> => {
		const row = player.board_id === null ? null : (boardById.get(player.board_id) ?? null);
		return {
			player,
			headshot: row?.headshot ?? null,
			slug: row?.slug ?? null,
			position_rank: row?.positionRank ?? null,
			points_over_replacement: row === null ? null : tenth(row.vor / inputs.weeksCovered),
			rest_of_season_per_game: perGameOf(row),
			// project.ts stamps the week's projection and the evidence after this build.
			week_projection: null,
			projection_delta: null,
			opp_rank: null,
			season_avg: null,
			last_points: null,
			held: false,
			facts: await factsFor(row?.team ?? player.team, player.board_id)
		};
	};

	// As the API answers an add on Sleeper: no host id (an ESPN league's is its board id, serve.ts).
	const boardLine = (row: BoardRow): Promise<PlayerLine> =>
		lineOf({
			host_id: '',
			board_id: row.id,
			name: row.name,
			position: row.position,
			team: row.team,
			injured_reserve: false
		});

	return { lineOf, boardLine };
}

/** A waiver row's sentence in the API's words (sentences.go Waiver): the gain and the drop, the gain
 * a week, or where the add sits in the order when he would not start. */
export function waiverSentence(
	add: PlayerLine,
	drop: PlayerLine | null,
	gain: number,
	starts: boolean
): string {
	const name = add.player.name;
	const dropped =
		drop === null
			? 'Your open roster spot takes him with no drop.'
			: `${drop.player.name} is the player it costs you least to lose.`;
	if (gain > 0 && !starts) {
		return `${name} does not start for you this week, and your lineup still gains ${gain.toFixed(1)} points over replacement a week with him on our rest-of-season order. ${dropped}`;
	}
	if (gain > 0) {
		return `${name} starts for you, and your lineup gains ${gain.toFixed(1)} points over replacement a week on our rest-of-season order. ${dropped}`;
	}
	if (add.position_rank !== null) {
		return `${name} is ${add.player.position}${String(add.position_rank)} in our rest-of-season order and would not start for you.`;
	}
	return `${name} is not in our order and would not start for you.`;
}

/** The free agents a capture lists, every status: the API reads each free agent's designation, so
 * the waiver answer keeps each one, listed or held out (Lane 132, B111). */
export function capturedFreeAgents(
	rows: readonly BoardRow[],
	listed: ReadonlySet<string>,
	held: ReadonlySet<string>
): BoardRow[] {
	return rows.filter((r) => r.orderBasis !== 'market' && listed.has(r.id) && !held.has(r.id));
}

/** A waiver row project.ts adds from the stand-in run's capture (B118): labelled in the fixture so a
 * script can tell it from the answer's own rows, and never served, so never drawn. Its line is the
 * stand-in run's (a preseason order, its points over replacement a week over that run's own weeks),
 * its gain the one rule over the member's lines (stand-in-lineup.ts). */
export type FixtureWaiverRow = WaiverRow & { standin?: true };
const STANDIN_LABEL = 'standin';

export const isStandInRow = (row: WaiverRow): boolean => (row as FixtureWaiverRow).standin === true;

/** The answer as the API would send it: every row without the fixture's label. */
export function servedWaivers(answer: WaiverAdvice): WaiverAdvice {
	return {
		...answer,
		rows: answer.rows.map(
			(row) =>
				Object.fromEntries(
					Object.entries(row).filter(([key]) => key !== STANDIN_LABEL)
				) as WaiverRow
		)
	};
}
