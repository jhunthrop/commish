/** The player card's week (Lane 66h) in words: the API's answer for him worded into the tiles, the
 * week ahead's box row and cell, the verb and the basis lines. Pure, so the tests read what the card
 * prints; live.ts reads the answer and builds the links. */
import type { components } from '#lib/api/types.ts';
import { memberZone, weekdayTime } from '#lib/format/clock.ts';
import { fixed } from '#lib/format/number.ts';
import {
	BOX,
	EVIDENCE_SHORT,
	deltaWord,
	easeOf,
	expectedWords,
	factsReadShort,
	gameOf,
	oppRankWord,
	projShort,
	weatherCell,
	type WeatherCell
} from '#lib/league/box/box.ts';
import { AGAINST } from '#lib/league/box/lineup.ts';
import type { LeagueHost } from '#lib/league/api.ts';
import { hostWords } from '#lib/league/names.ts';
import type { LogNext } from '#lib/ui/game-log.ts';
import { CARD, NONE, withTile, type CardTile } from './card.ts';

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

/** Rest of season's parts the card's caption names: its first week and his rank, "WR1". */
export interface RestParts {
	fromWeek: number;
	rank: string;
}

export interface LiveCard {
	week: number;
	tiles: CardTile[];
	cell: NextCell | null;
	next: LogNext | null;
	verb: CardVerb | null;
	basis: string[];
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
	const player = { player: who.id };
	// Waivers narrows to his position when its first answer does not hold him.
	const pickup = { player: who.id, position: who.position };
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
		label: CARD.proj,
		value: value === null ? NONE : fixed(value, 1),
		caption: value === null ? noProjWords(week) : `${CARD.week} ${String(week.week)}, ${scoring}`,
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
	return { ...fallback, value: fixed(avg, 1), caption: games > 0 ? fallback.caption : '' };
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
		value: fixed(last, 1),
		caption: `week ${String(game.week)}${against === undefined ? '' : ` ${against}`}`
	};
}

/** The change's caption: when it is measured from, or why there is none. With no Proj the Proj tile
 * says why, so the change says nothing. */
function deltaCaption(week: PlayerWeek, zone: string): string {
	const read = week.projection_previous_read_at;
	if (week.line.week_projection === null) return '';
	if (read === null) return CARD.noEarlierRead;
	return week.line.projection_delta === null
		? CARD.notInEarlier
		: `since ${weekdayTime(read, zone)}`;
}

function deltaTile(week: PlayerWeek, zone: string): CardTile {
	return {
		key: 'delta',
		label: CARD.delta,
		value: deltaWord(week.line.projection_delta),
		caption: deltaCaption(week, zone),
		tone: 'quiet'
	};
}

/** Rest of season with his figure a game from the API's read (the league rows' one source), when it
 * carries one; the tile as built otherwise. */
function restTile(week: PlayerWeek, rest: RestParts | null, fallback: CardTile): CardTile {
	const perGame = week.line.rest_of_season_per_game;
	if (rest === null) return fallback;
	const game = perGame === null ? '' : `, ${fixed(perGame, 1)} a game`;
	return {
		...fallback,
		caption: `from week ${String(rest.fromWeek)}${game}, ${rest.rank} in our order`
	};
}

/** The basis lines the week's read says, once each and short (the Waivers forms): the projection's
 * with its change's, then the evidence columns' scoring with the game facts' read. A "--" says why on
 * its own tile. */
export function liveBasis(week: PlayerWeek, league: boolean, zone: string): string[] {
	const proj = projShort(
		week.projection_read_at,
		week.projection_previous_read_at,
		week.projection_scoring,
		false,
		zone,
		league
	);
	const scoring = `${SCORING_WORDS[week.projection_scoring.format]} scoring`;
	const evidence = league ? EVIDENCE_SHORT : EVIDENCE_SHORT.replace('your scoring', scoring);
	const facts = factsReadShort([week.line], zone);
	return [proj, facts === null ? evidence : `${evidence} ${facts}`];
}

function nextOf(week: PlayerWeek, zone: string): { cell: NextCell | null; next: LogNext | null } {
	const game = gameOf(week.line.facts, zone);
	if (game === null || game === 'bye') return { cell: null, next: null };
	const cell: NextCell = {
		where: game.where,
		when: game.when,
		expected: expectedWords(week.line.facts),
		weather: weatherCell(week.line.facts)
	};
	const proj = week.line.week_projection;
	return {
		cell,
		next: {
			week: week.week,
			opponent: game.where,
			when: game.when,
			proj: proj === null ? NONE : fixed(proj, 1),
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
	zone = memberZone()
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
		deltaTile(week, zone)
	].reduce<CardTile[]>((all, tile) => withTile(all, tile), [...tiles]);
	const { cell, next } = nextOf(week, zone);
	const verb =
		league !== null && week.verb !== null ? verbOf(week.verb, league, player, screenHref) : null;
	return {
		week: week.week,
		tiles: updated,
		cell,
		next,
		verb,
		basis: liveBasis(week, verb !== null, zone)
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
		return `${x > y ? a.name : b.name} by ${fixed(Math.abs(x - y), 1)} ${words}`;
	};
	const proj = ahead('proj', `${CARD.proj} this week`);
	if (proj !== null) return proj;
	// One row with no Proj is named, so the figure that answers instead is read as such.
	const missing = [a, b].filter((row) => figure(row, 'proj') === null);
	const [one] = missing;
	const lead = missing.length === 1 && one ? `No ${CARD.proj} for ${one.name} this week. ` : '';
	const avg = ahead('avg', 'a game this season');
	if (avg !== null) return `${lead}${avg}`;
	const restLabel = a.tiles.find((tile) => tile.key === 'rest')?.label;
	const rest = ahead(
		'rest',
		restLabel === CARD.projected ? 'projected points for the season' : 'points rest of season'
	);
	return rest === null ? null : `${lead}${rest}`;
}
