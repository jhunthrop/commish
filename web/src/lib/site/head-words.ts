/** Every page's one description sentence (Lane 169, ruling 1), in one place for the copy guard: a
 * prerendered page's built at prerender from the page's own facts, the pages the browser draws
 * (a league, a mock, a lobby, the live draft) each a static line. No sentence names the projection's
 * provider, says a betting word or a price. */
import { POSITION_NAMES } from '#lib/run/derive.ts';
import type { Position } from '#lib/types/player.ts';

/** "QB, RB and WR": the last two joined by "and". */
function listed(words: readonly string[]): string {
	if (words.length <= 1) return words.join('');
	return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;
}

/** "WR", "kicker", "defense": the site's one word for a position. */
const positionWord = (position: Position): string => POSITION_NAMES[position].one;

/** The positions the rankings page orders, as its purpose names them. */
const RANKED_POSITIONS = 'every QB, RB, WR and TE';

/** A board in words: whose season and scoring, and whether it ranks the rest of the season. */
export interface BoardFacts {
	season: number;
	label: string;
	teams: number;
	/** The board ranks the rest of the season (the run's format has rosFromWeek). */
	rest: boolean;
}

const boardName = (board: BoardFacts): string =>
	board.rest
		? `our ${String(board.season)} rest-of-season ${board.label} board`
		: `our ${String(board.season)} ${board.label} board`;

/** The game a player's description names: his week's opponent, home or away, or his bye. */
export type WeekGame =
	{ kind: 'game'; week: number; home: boolean; opponent: string } | { kind: 'bye'; week: number };

/** What a player's description is built from. */
export interface PlayerFacts {
	name: string;
	position: Position;
	/** His club's city and nickname, null for a free agent. */
	club: string | null;
	/** His place at his position, null while he is on a season-long list. */
	positionRank: number | null;
	season: number;
	/** The scoring his rank is in, "PPR". */
	label: string;
	/** The lead board ranks the rest of the season. */
	rest: boolean;
	/** His next game or bye, null once his season has none left. */
	game: WeekGame | null;
}

function playerWho(player: PlayerFacts): string {
	const position = positionWord(player.position);
	return player.club === null
		? `${player.name}, a free agent ${position}`
		: `${player.name}, ${player.club} ${position}`;
}

function playerRank(player: PlayerFacts): string {
	const order = player.rest
		? `our ${String(player.season)} rest-of-season order`
		: `our ${String(player.season)} ${player.label} order`;
	return player.positionRank === null
		? `unranked in ${order} while on a season-long list`
		: `${player.position}${String(player.positionRank)} in ${order}`;
}

function playerGame(game: WeekGame | null): string {
	if (game === null) return '';
	if (game.kind === 'bye') return `, on bye in week ${String(game.week)}`;
	return `, week ${String(game.week)} ${game.home ? 'against' : 'at'} the ${game.opponent}`;
}

export const HEAD_WORDS = {
	/** The front door: what the site holds. */
	front: (season: number, label: string) =>
		`Our ${String(season)} ${label} board from our own projections, every player's page, your league's lineup, waivers and trades, mock drafts and a cheat sheet.`,
	/** The rankings page in season (the brief's sentence), and as Players before the season. */
	rankings: (season: number, week: number) =>
		`Our ${String(season)} rest-of-season order for ${RANKED_POSITIONS}, with each player's week ${String(week)} game and the week's published projection.`,
	players: (season: number, label: string) =>
		`Our ${String(season)} ${label} order for ${RANKED_POSITIONS}, by position, with each player's rank overall.`,
	/** The rankings page's structured list. */
	rankingsList: (season: number) => `Our ${String(season)} order, top 50`,
	/** "Puka Nacua, Los Angeles Rams WR: WR3 in our 2026 rest-of-season order, week 8 at the San
	 * Francisco 49ers." */
	player: (player: PlayerFacts) =>
		`${playerWho(player)}: ${playerRank(player)}${playerGame(player.game)}.`,
	/** The record: what each of its records grades. */
	recordWeekly: (season: number, label: string, weekly: string, draft: string) =>
		`Our ${String(season)} record in ${label}: ${lowered(weekly)}, and ${lowered(draft)}.`,
	recordDraft: (season: number, lead: string) => `Our ${String(season)} record: ${lowered(lead)}.`,
	recordName: (season: number) => `Commish record, ${String(season)}`,
	/** A board, whole or at a position. */
	board: (board: BoardFacts, positions: readonly Position[]) =>
		`${capitalized(boardName(board))} for ${String(board.teams)}-team leagues: ${listed(positions.map((p) => POSITION_NAMES[p].many))}, ranked by points over replacement, in tiers.`,
	/** A position's board; in season the kickers' and defenses' tabs are this week's (week-head.ts). */
	boardPosition: (board: BoardFacts, position: Position, inSeason: boolean) => {
		const many = POSITION_NAMES[position].many;
		const teams = `${String(board.teams)}-team`;
		if (position !== 'K' && position !== 'DST')
			return `The ${many} on ${boardName(board)} for ${teams} leagues, ranked by points over replacement, in tiers.`;
		return inSeason
			? `This week's ${many} for ${teams} ${board.label} leagues.`
			: `The ${many} on ${boardName(board)} for ${teams} leagues, in the order drafters take them.`;
	},
	adp: (board: BoardFacts, gap: boolean) =>
		`Where ${board.label} drafters take each player, earliest first, beside ${boardName(board)}${gap ? ', with the gap between their pick and our rank' : ''}.`,
	clubs: (board: BoardFacts) =>
		`Every NFL club's players on ${boardName(board)}, with each club's rest-of-season schedule strength.`,
	club: (club: string, board: BoardFacts) =>
		`The ${club} players on ${boardName(board)}, with the club's ${String(board.season)} schedule and each opponent's expected wins.`,
	schedule: (season: number) =>
		`Every NFL club's ${String(season)} schedule strength for the rest of the season: the average expected wins of the opponents each club has still to play.`,
	/** /llms.txt's line for the player pages. */
	llmsPlayers:
		"One page per player at /players/<his name>: his rank in our order, his week's game, his season so far game by game, and our read of him.",
	/** The pages with no run facts. */
	sheet:
		'Your cheat sheet: players from our board in your own order, with your notes and tiers, ready to print.',
	print: 'Your cheat sheet, laid out to print.',
	account: 'Your Commish account: your leagues, your cheat sheets and your mock drafts.',
	compare: 'Pick two players to see which one we would take, with their figures side by side.',
	offline: 'The last board this device saved, for when it has no connection.'
} as const;

/** A page the browser draws, its title and line, the same for every address under it. */
export interface WorkerHead {
	title: string;
	description: string;
}

/** The pages the Worker answers with an empty body, by their route's first segment (ruling 1). */
export const WORKER_HEADS = {
	league: {
		title: 'Your league',
		description:
			"Your league on our board: your roster, this week's matchup and your league's free agents, kept up to date. Free."
	},
	mock: {
		title: 'Mock draft',
		description:
			"A mock draft on Commish: draft against our board on your league's settings, then read the report on your picks."
	},
	lobby: {
		title: 'Mock lobby',
		description:
			'A mock draft lobby on Commish: draft against other people on the clock, then read the report on your picks.'
	},
	companion: {
		title: 'Live draft',
		description:
			'Follow your live draft on Commish: at each of your picks you get our call, against the picks your league actually makes.'
	}
} as const satisfies Record<string, WorkerHead>;
export type WorkerSection = keyof typeof WORKER_HEADS;

function lowered(text: string): string {
	return text.charAt(0).toLowerCase() + text.slice(1);
}

function capitalized(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
