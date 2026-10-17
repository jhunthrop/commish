/** The player card's week (Lane 66h) in words: the API's answer for him worded into the tiles, the
 * week ahead's box row and cell, the verb and the basis lines. Pure, so the tests read what the card
 * prints; live.ts reads the answer and builds the links. */
import type { components } from '#lib/api/types.ts';
import { memberZone, weekdayTime } from '#lib/format/clock.ts';
import { fixed } from '#lib/format/number.ts';
import {
	BOX,
	EVIDENCE_BASIS,
	deltaBasis,
	deltaWord,
	easeOf,
	expectedWords,
	factsReadLine,
	gameOf,
	oppRankWord,
	projBasis,
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

/** A league screen's address with him named, as live.ts builds it. */
export type ScreenHref = (screen: 'start' | 'waivers' | 'trades', player: string) => string;

/** The verb the league's screens give him, the platform named. */
export function verbOf(
	verb: NonNullable<PlayerWeek['verb']>,
	league: CardLeague,
	player: string,
	screenHref: ScreenHref
): CardVerb {
	const host = hostWords(league.host);
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
				href: screenHref('waivers', player),
				external: false,
				note: verb.note
			};
		case 'waivers':
			return verb.host_url === null
				? {
						kind: verb.kind,
						label: `Open ${host} waivers`,
						href: screenHref('waivers', player),
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

function projTile(week: PlayerWeek): CardTile {
	const value = week.line.week_projection;
	const scoring = SCORING_WORDS[week.projection_scoring.format];
	return {
		key: 'proj',
		label: CARD.proj,
		value: value === null ? NONE : fixed(value, 1),
		caption: `${CARD.week} ${String(week.week)}, ${scoring}`,
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
			caption: facts.bye ? BOX.bye : opponent,
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

function deltaTile(week: PlayerWeek, zone: string): CardTile {
	const read = week.projection_previous_read_at;
	return {
		key: 'delta',
		label: CARD.delta,
		value: deltaWord(week.line.projection_delta),
		caption:
			read === null || week.line.projection_delta === null
				? ''
				: `since ${weekdayTime(read, zone)}`,
		tone: 'quiet'
	};
}

/** The basis lines the week's read says, once each: the projection's, its change's (or why it has
 * none), and the evidence columns' scoring, then the game facts' read. */
export function liveBasis(week: PlayerWeek, league: boolean, zone: string): string[] {
	const proj = projBasis(week.projection_read_at, week.projection_scoring, false, zone, league);
	const delta =
		deltaBasis(week.projection_previous_read_at, zone) ??
		`${CARD.delta} shows "${NONE}" until this week's projection has been read twice.`;
	const scoring = league
		? "this league's scoring"
		: `${SCORING_WORDS[week.projection_scoring.format]} scoring`;
	const evidence = EVIDENCE_BASIS.replace("in this league's scoring", `in ${scoring}`);
	const opp =
		week.line.opp_rank === null && !week.line.facts.bye
			? ` ${CARD.opp} shows "${NONE}" until the season ranks his opponent.`
			: '';
	const facts = factsReadLine([week.line], zone);
	return [proj, delta, `${evidence}${opp}`, ...(facts === null ? [] : [facts])];
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
		oppTile(week, player.position),
		avgTile(week, games, fallback('avg')),
		lastTile(week, opponents, fallback('last')),
		deltaTile(week, zone)
	].reduce<CardTile[]>((all, tile) => withTile(all, tile), [...tiles]);
	const { cell, next } = nextOf(week, zone);
	const verb =
		league !== null && week.verb !== null ? verbOf(week.verb, league, player.id, screenHref) : null;
	return {
		week: week.week,
		tiles: updated,
		cell,
		next,
		verb,
		basis: liveBasis(week, verb !== null, zone)
	};
}
