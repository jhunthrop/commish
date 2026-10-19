/** The player card's week (Lane 66h) in words: the API's answer for him worded into the tiles, the
 * week ahead's box row and cell, the verb and the basis lines. Pure, so the tests read what the card
 * prints; live.ts reads the answer and builds the links. */
import type { components } from '#lib/api/types.ts';
import { memberZone, weekdayTime } from '#lib/format/clock.ts';
import { gameStateOf, toBePlayed } from '#lib/format/game-facts.ts';
import { weekHead } from '#lib/format/figure-words.ts';
import { playerRestWords } from '#lib/run/rest-from.ts';
import {
	avgLastPart,
	deltaPart,
	gamePart,
	kickedOffPart,
	OPP_PART,
	projPart
} from '#lib/league/box/basis.ts';
import {
	BOX,
	deltaWord,
	easeOf,
	expectedWords,
	gameOf,
	oppRankWord,
	weatherCell,
	type WeatherCell
} from '#lib/league/box/box.ts';
import { askedQuery } from '#lib/league/box/asked.ts';
import { AGAINST } from '#lib/league/box/lineup.ts';
import type { LeagueHost } from '#lib/league/api.ts';
import { hostWords } from '#lib/league/names.ts';
import type { LogNext } from '#lib/ui/game-log.ts';
import {
	CARD,
	NONE,
	printTenth,
	withTile,
	type CardHead,
	type CardTile,
	type RestParts
} from './card.ts';
import type { CardProjection } from './week-read.ts';

/** Tenths in a point, the precision the API prints. */
const TENTHS = 10;

type Schemas = components['schemas'];
export type PlayerWeek = Schemas['PlayerWeek'];
export type PlayerVerbKind = Schemas['PlayerVerb']['kind'];

/** The player the card reads, as his page names him. */
export interface CardPlayer {
	id: string;
	name: string;
	team: string;
	position: string;
}

/** The followed league the card reads in, null with none. */
export interface CardLeague {
	id: string;
	host: LeagueHost;
}

/** The week ahead's cell under his name: "vs ARI Sun 3:05 pm", then "32.5 to 20" and the weather. */
export interface NextCell {
	where: string;
	when: string;
	expected: string | null;
	weather: WeatherCell | null;
}

/** The card's one verb with a league: its words, where it goes, and the line under it. */
export interface CardVerb {
	kind: PlayerVerbKind;
	label: string;
	href: string;
	/** The platform's page, opened in a new tab, his name put on the clipboard first. */
	external: boolean;
	note: string | null;
}

export interface LiveCard {
	week: number;
	/** The head the read gives the card: the API's week and its game or bye, the empty figure when
	 * the API names no game that week, so the head never shows the build's week over the read's. */
	head: CardHead;
	tiles: CardTile[];
	cell: NextCell | null;
	next: LogNext | null;
	verb: CardVerb | null;
	basis: string[];
	/** The week's projection as the card prints it, which the week-ahead read is held to (Lane 66v). */
	projection: CardProjection;
	/** His rest of season at the read's clock (Lane 86), which the page's figures beside the read take;
	 * null where the run's stand. */
	rest: LiveRest | null;
}

/** His rest-of-season points at the read's clock and the week they start from, as words. */
export interface LiveRest {
	points: number;
	from: string;
}

const SCORING_WORDS: Readonly<Record<Schemas['ProjectionScoring']['format'], string>> = {
	ppr: 'PPR',
	half_ppr: 'half-PPR',
	standard: 'standard'
};

/** The direction of an opponent's rank in words, for the tile's caption: "ARI, among the easiest
 * for receivers". */
export function oppCaption(
	opponent: string,
	rank: number,
	of: number | null,
	position: string
): string {
	const against = AGAINST[position] ?? 'his position';
	switch (easeOf(rank, of)) {
		case 'easy':
			return `${opponent}, among the easiest for ${against}`;
		case 'hard':
			return `${opponent}, among the toughest for ${against}`;
		case 'even':
			return `${opponent}, in the middle for ${against}`;
	}
}

/** A league screen's address with him named (?player=, and his position for Waivers), as live.ts
 * builds it. */
export type ScreenHref = (
	screen: 'start' | 'waivers' | 'trades',
	query: Readonly<Record<string, string>>
) => string;

/** The verb the league's screens give him, the platform named. */
export function verbOf(
	verb: NonNullable<PlayerWeek['verb']>,
	league: CardLeague,
	who: CardPlayer,
	screenHref: ScreenHref
): CardVerb {
	const host = hostWords(league.host);
	const asked = { id: who.id, position: who.position };
	const player = askedQuery('start', asked);
	const pickup = askedQuery('waivers', asked);
	switch (verb.kind) {
		case 'start':
			return {
				kind: verb.kind,
				label: 'Start him',
				href: screenHref('start', player),
				external: false,
				note: null
			};
		case 'lineup':
			return {
				kind: verb.kind,
				label: 'Open your lineup',
				href: screenHref('start', player),
				external: false,
				note: null
			};
		case 'trade':
			return {
				kind: verb.kind,
				label: 'Trade for him',
				href: screenHref('trades', player),
				external: false,
				note: null
			};
		case 'claim':
			return {
				kind: verb.kind,
				label: `Add on ${host}`,
				href: screenHref('waivers', pickup),
				external: false,
				note: verb.note
			};
		case 'waivers':
			return verb.host_url === null
				? {
						kind: verb.kind,
						label: CARD.findOnWaivers,
						href: screenHref('waivers', pickup),
						external: false,
						note: verb.note
					}
				: {
						kind: verb.kind,
						label: `Open ${host} waivers`,
						href: verb.host_url,
						external: true,
						note:
							verb.note ??
							`Claims are not sent to ${host} from here, so this copies his name and opens ${host}'s waiver page.`
					};
	}
}

/** Why his Proj is "--": his bye, no snapshot stored for the week, or the snapshot leaves him out. */
function noProjWords(week: PlayerWeek): string {
	if (week.line.facts.bye) return CARD.byeWeek;
	return week.projection_read_at === null ? CARD.projNotIn : CARD.projNotHim;
}

function projTile(week: PlayerWeek): CardTile {
	const value = week.line.week_projection;
	const scoring = SCORING_WORDS[week.projection_scoring.format];
	return {
		key: 'proj',
		// Beside the season's Projected, headed by the API's week, never the clock (the ruling).
		label: weekHead(week.week),
		value: value === null ? NONE : printTenth(value),
		caption: value === null ? noProjWords(week) : scoring,
		tone: 'lead'
	};
}

function oppTile(week: PlayerWeek, position: string): CardTile {
	const { opp_rank: rank, facts } = week.line;
	const opponent = facts.opponent ?? '';
	if (rank === null) {
		return {
			key: 'opp',
			label: CARD.opp,
			value: NONE,
			caption: facts.bye ? BOX.bye : `${opponent}, ${CARD.notRanked}`,
			tone: null
		};
	}
	const of = facts.allowed_to_position?.of ?? null;
	return {
		key: 'opp',
		label: CARD.opp,
		value: oppRankWord(rank),
		caption: oppCaption(opponent, rank, of, position),
		tone: easeOf(rank, of)
	};
}

function avgTile(week: PlayerWeek, games: number, fallback: CardTile): CardTile {
	const avg = week.line.season_avg;
	if (avg === null) return fallback;
	return { ...fallback, value: printTenth(avg), caption: games > 0 ? fallback.caption : '' };
}

function lastTile(
	week: PlayerWeek,
	opponents: Readonly<Record<number, string>>,
	fallback: CardTile
): CardTile {
	const last = week.line.last_points;
	const game = week.line.facts.last_games[0];
	if (last === null || game === undefined) return fallback;
	const against = opponents[game.week];
	return {
		...fallback,
		value: printTenth(last),
		caption: `week ${String(game.week)}${against === undefined ? '' : ` ${against}`}`
	};
}

/** The change's caption: when it is measured from, or why there is none. With no Proj the Proj tile
 * says why, so the change says nothing. */
function deltaCaption(week: PlayerWeek, zone: string): string {
	const read = week.projection_previous_read_at;
	if (week.line.week_projection === null) return CARD.noProjToCompare;
	if (read === null) return CARD.noEarlierRead;
	return week.line.projection_delta === null
		? CARD.notInEarlier
		: `since ${weekdayTime(read, zone)}`;
}

function deltaTile(week: PlayerWeek, zone: string, now: number): CardTile {
	const ahead = toBePlayed(week.line.facts, now) || week.line.facts.bye;
	return {
		key: 'delta',
		label: CARD.delta,
		value: ahead ? deltaWord(week.line.projection_delta) : NONE,
		caption: ahead
			? deltaCaption(week, zone)
			: gameStateOf(week.line.facts) === 'final'
				? CARD.gameFinal
				: CARD.kickedOff,
		tone: 'quiet'
	};
}

/** The week his rest of season starts from: the read's when it says one, the run's before. */
function fromOf(week: PlayerWeek, rest: RestParts): string {
	return week.rest_from_week == null ? rest.from : playerRestWords(week.rest_from_week);
}

/** His rest of season at the read's clock (Lane 86), when the read is in the tile's own scoring and
 * says it: the points over his club's games left now and the week they start from. Null on a
 * preseason board, in another scoring and on a read older than the fields: the run's stand. */
function restNow(week: PlayerWeek, rest: RestParts | null): LiveRest | null {
	const points = week.rest_of_season_points;
	if (week.projection_scoring.format !== rest?.scoring || points == null) return null;
	return { points, from: fromOf(week, rest) };
}

/** Rest of season with his figure a game from the API's read (the league rows' one source), only
 * when the read is in the tile's own scoring: a league in another scoring leaves it out and the
 * caption names the tile's (review N2). In that scoring the read's points replace the run's, and in
 * any its week: a game kicked off since the run is no longer counted (Lane 86). The tile as built on a
 * preseason board. */
function restTile(week: PlayerWeek, rest: RestParts | null, fallback: CardTile): CardTile {
	if (rest === null) return fallback;
	const same = week.projection_scoring.format === rest.scoring;
	const now = restNow(week, rest);
	const perGame = week.line.rest_of_season_per_game;
	const game = same && perGame !== null ? `, ${printTenth(perGame)} a game` : '';
	const scoring = same ? '' : `, in ${rest.label} scoring`;
	const from = fromOf(week, rest);
	return {
		...fallback,
		...(now === null ? {} : { value: printTenth(now.points) }),
		caption: `${from}${game}, ${rest.rank}${scoring}`
	};
}

/** The basis lines the week's read says, once each and short (the Waivers forms): the projection's
 * with its change's, then the evidence columns' scoring with the game facts' read while his game is
 * still to be played at `now`. A "--" says why on its own tile. */
export function liveBasis(week: PlayerWeek, league: boolean, zone: string, now: number): string[] {
	// The card's page names no zone elsewhere, so each time says it (basis.ts, the one source).
	const clock = { zone, zoned: true };
	const proj = [
		projPart(
			{
				readAt: week.projection_read_at,
				scoring: week.projection_scoring,
				defense: false,
				league
			},
			clock
		),
		deltaPart(week.projection_previous_read_at, clock)
	]
		.filter((said) => said !== null)
		.join(' ');
	const scoring = league
		? 'your scoring'
		: `${SCORING_WORDS[week.projection_scoring.format]} scoring`;
	const evidence = `${OPP_PART} ${avgLastPart(scoring)}`;
	const facts = gamePart([week.line], clock, now, 'next') ?? kickedOffPart([week.line]);
	return [proj, facts === null ? evidence : `${evidence} ${facts}`];
}

/** The card's head from the read: its week, and the game or the bye in it. */
function headOf(week: PlayerWeek, zone: string): CardHead {
	const game = gameOf(week.line.facts, zone);
	const opponent = game === null ? NONE : game === 'bye' ? BOX.bye : game.where;
	return { week: week.week, opponent };
}

/** His week's game under his name and as the log's accent row: the expected score and the weather
 * only while it is still to be played (Lane 80), "Kicked off" or "Final" in place of the kickoff
 * after. */
function nextOf(
	week: PlayerWeek,
	zone: string,
	now: number
): { cell: NextCell | null; next: LogNext | null } {
	const { facts } = week.line;
	const game = gameOf(facts, zone);
	if (game === null || game === 'bye') return { cell: null, next: null };
	const ahead = toBePlayed(facts, now);
	const cell: NextCell = {
		where: game.where,
		when: game.when,
		expected: ahead ? expectedWords(facts) : null,
		weather: ahead ? weatherCell(facts) : null
	};
	const proj = week.line.week_projection;
	return {
		cell,
		next: {
			week: week.week,
			opponent: game.where,
			when: game.when,
			proj: proj === null ? NONE : printTenth(proj),
			expected: cell.expected,
			weather: cell.weather
		}
	};
}

export interface LiveInput {
	week: PlayerWeek;
	player: CardPlayer;
	league: CardLeague | null;
	/** The tiles as built, the rest of season kept. */
	tiles: readonly CardTile[];
	/** Each played week's opponent, for Last's caption. */
	opponents: Readonly<Record<number, string>>;
	/** His games so far, for Avg's caption. */
	games: number;
	/** Rest of season's first week and his rank at his position in our order, null before the run
	 * ranks the rest of the season. */
	rest: RestParts | null;
	screenHref: ScreenHref;
	zone?: string;
	/** The time the card is drawn at, in ms: a game kicked off by then says no facts read. */
	now: number;
}

/** The card once the week is read. */
export function liveCard({
	week,
	player,
	league,
	tiles,
	opponents,
	games,
	rest,
	screenHref,
	zone = memberZone(),
	now
}: LiveInput): LiveCard {
	const fallback = (key: CardTile['key']): CardTile => {
		const found = tiles.find((tile) => tile.key === key);
		if (!found) throw new Error(`The card has no ${key} tile.`);
		return found;
	};
	const updated = [
		projTile(week),
		restTile(week, rest, fallback('rest')),
		oppTile(week, player.position),
		avgTile(week, games, fallback('avg')),
		lastTile(week, opponents, fallback('last')),
		deltaTile(week, zone, now)
	].reduce<CardTile[]>((all, tile) => withTile(all, tile), [...tiles]);
	const { cell, next } = nextOf(week, zone, now);
	const verb =
		league !== null && week.verb !== null ? verbOf(week.verb, league, player, screenHref) : null;
	return {
		week: week.week,
		head: headOf(week, zone),
		tiles: updated,
		cell,
		next,
		verb,
		basis: liveBasis(week, verb !== null, zone, now),
		rest: restNow(week, rest),
		projection: {
			week: week.week,
			scoring: week.projection_scoring.format,
			points: week.line.week_projection
		}
	};
}

/** A Compare row: his name and the card's tiles. */
export interface CompareRow {
	name: string;
	tiles: readonly CardTile[];
}

function figure(row: CompareRow, key: CardTile['key']): number | null {
	const value = Number(row.tiles.find((tile) => tile.key === key)?.value);
	return Number.isFinite(value) ? value : null;
}

/** The start or sit question answered from the figures both rows hold (review M5): this week's Proj
 * first, else points a game this season, else the board's figure in its own words; null when they
 * share none or tie. */
export function compareSay(a: CompareRow, b: CompareRow): string | null {
	const ahead = (key: CardTile['key'], words: string): string | null => {
		const x = figure(a, key);
		const y = figure(b, key);
		if (x === null || y === null || x === y) return null;
		// The gap of two printed tenths, taken in whole tenths so no float shows (no new rounding).
		const tenths = Math.abs(Math.round(x * TENTHS) - Math.round(y * TENTHS));
		return `${x > y ? a.name : b.name} by ${printTenth(tenths / TENTHS)} ${words}`;
	};
	const proj = ahead('proj', 'projected points this week');
	if (proj !== null) return proj;
	// One row with no Proj is named, so the figure that answers instead is read as such.
	const missing = [a, b].filter((row) => figure(row, 'proj') === null);
	const [one] = missing;
	const lead = missing.length === 1 && one ? `No projection for ${one.name} this week. ` : '';
	const avg = ahead('avg', 'a game this season');
	if (avg !== null) return `${lead}${avg}`;
	const restLabel = a.tiles.find((tile) => tile.key === 'rest')?.label;
	const rest = ahead(
		'rest',
		restLabel === CARD.projected ? 'projected points for the season' : 'points rest of season'
	);
	return rest === null ? null : `${lead}${rest}`;
}

export type { RestParts } from './card.ts';
