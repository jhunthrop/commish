/** The player card's week (Lane 66h) in words: the API's answer for him worded into the tiles, the
 * week ahead's box row and cell, the verb and the basis lines. Pure, so the tests read what the card
 * prints; live.ts reads the answer and builds the links. */
import type { components } from '#lib/api/types.ts';
import { kickoffAt, memberZone, stampAt, weekdayName } from '#lib/format/clock.ts';
import { isFreeAgent } from '#lib/format/free-agent.ts';
import {
	lineState,
	lineupOpen,
	pastKickoff,
	toPlay,
	type GameLine
} from '../league/box/kickoff.ts';
import { signed } from '#lib/format/number.ts';
import { weekHead } from '#lib/format/figure-words.ts';
import {
	playerRestWords,
	restFromWords,
	restOfSeasonHead,
	restSpanWords,
	tierBasisWords,
	tierSpanOf
} from '#lib/run/rest-from.ts';
import type { BoardFormat } from '#lib/sheet/model.ts';
import {
	avgLastPart,
	kickedOffPartAt,
	OPP_PART,
	projUnstampedPart
} from '#lib/league/box/basis.ts';
import {
	BOX,
	deltaWord,
	easeOf,
	expectedScoreWords,
	gameOf,
	heldGame,
	oppRankWord,
	printTenth,
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
	SHOWN_CHANGE_FROM,
	projectionMove,
	listedTiles,
	restRankWords,
	NONE,
	publishedOn,
	compareLeadsWithoutVerb,
	withTile,
	type BasisTile,
	type CardHead,
	type CardTile,
	type ProjectionMove,
	type RestParts
} from './card.ts';
import { vsAvgCaption } from './basis-words.ts';
import { movedPastRead, type CardProjection } from './week-read.ts';
import type { WeekRead } from '#lib/run/schema.ts';

/** What of the week's read the change tile needs: its week and the projection it quotes. */
export type ReadQuote = Pick<WeekRead, 'week' | 'projection' | 'body' | 'movedCaption'>;

/** Tenths in a point, the precision the API prints. */
const TENTHS = 10;

/** The week tile's and the change tile's own words (Lane 139, C06, C12, C21): the week's figure named as
 * the published projection with its one read stamp, the change with none. */
export const WEEK_TILE = {
	published: 'published projection',
	/** The figure a standing read was written on, beside a tile that now shows another (Lane 165, D10),
	 * so the read never quotes a number the tile does not show. */
	atRead: (points: string, scoring: string | null) =>
		`Proj at the read ${points}${scoring === null ? '' : ` in ${scoring}`}`,
	sinceEarlier: 'since the earlier read',
	underShown: `Moved under ${String(SHOWN_CHANGE_FROM)} since the earlier read`,
	/** With a read written for the week the change is measured from the figure it quotes, the move that
	 * decides whether the read stands (Lane 162, D04). */
	sinceRead: 'since our read was written',
	underShownRead: `Moved under ${String(SHOWN_CHANGE_FROM)} since our read was written`,
	notInRead: 'Not in our read',
	changePart: `${CARD.delta} is its move since the earlier read, shown from ${String(SHOWN_CHANGE_FROM)}.`,
	changePartRead: `${CARD.delta} is its move since our read was written, shown from ${String(SHOWN_CHANGE_FROM)}. The read is withheld from the same move.`
} as const;

type Schemas = components['schemas'];
export type PlayerWeek = Schemas['PlayerWeek'];
export type PlayerVerbKind = Schemas['PlayerVerb']['kind'];
type AfterBye = Schemas['PlayerAfterBye'];

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

/** The week ahead's cell under his name: "vs ARI Sun 3:05 pm CT", then "Expected score LAR 32.5, ARI
 * 20" and the weather. */
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
	/** The in-season row under the tiles, vs Avg filled from the read (Lane 100). */
	basisTiles: BasisTile[];
	cell: NextCell | null;
	next: LogNext | null;
	verb: CardVerb | null;
	/** His lineup verb was held back because the week's lineup can no longer be set: Compare is the
	 * card's verb (Lane 100, B64). */
	compareLeads: boolean;
	basis: string[];
	/** The week's projection as the card prints it, which the week-ahead read is held to (Lane 66v). */
	projection: CardProjection;
	/** His rest of season at the read's clock (Lane 86), which the page's figures beside the read take;
	 * null where the run's stand. */
	rest: LiveRest | null;
	/** The every-format table's figures at the read's clock, null where the run's stand. */
	formats: LiveFormats | null;
	/** The tier box's figures at the read's clock, null where the run's stand. */
	tier: LiveTier | null;
	/** His position rank as the read places him, which the rest caption names (restTile): the
	 * page's pill takes it, null where the run's stands (Lane 128 fix round 4). */
	positionRank: number | null;
	/** The clock the card was read at, which the read's place says its words on (Lane 265). */
	at: number;
}

/** His rest-of-season points at the read's clock and the week they start from, as words. */
export interface LiveRest {
	points: number;
	from: string;
}

/** The every-format table at the read's clock: its points head, each format's figures and each
 * format's position rank from the same answer (Lane 227, B206), null for a format the order does not
 * place him in; `ranks` is null on an answer older than those ranks, where none carries one. */
export interface LiveFormats {
	head: string;
	figures: Partial<Record<BoardFormat, { points: number; vor: number | null }>>;
	ranks: Partial<Record<BoardFormat, number | null>> | null;
}

/** The tier box at the read's clock: each listed player's points, his rank as the read ranks him and
 * the weeks his points count where they are not the page's player's (Lane 162), the drop and the basis.
 * `ranks` and `spans` are null on an answer older than the fields: the run's stand. */
export interface LiveTier {
	points: Readonly<Record<string, number | null>>;
	ranks: Readonly<Record<string, number | null>> | null;
	spans: Readonly<Record<string, string | null>> | null;
	drop: number | null;
	basis: string;
}

/** What the tier box needs to word its basis. */
export interface TierAsk {
	label: string;
	season: number;
}

function formatsOf(week: PlayerWeek, now: LiveRest | null): LiveFormats | null {
	if (now === null || week.rest_of_season == null) return null;
	const figures = Object.fromEntries(
		week.rest_of_season.map((f) => [f.format, { points: f.points, vor: f.points_over_replacement }])
	);
	// The API leaves a null rank out of the answer, so a read whose figures carry none at all is read
	// as an older answer: the table then keeps the older rule (live-figures.ts lineRanksAt).
	const ranked = week.rest_of_season.some((f) => f.position_rank != null);
	const ranks = ranked
		? Object.fromEntries(week.rest_of_season.map((f) => [f.format, f.position_rank ?? null]))
		: null;
	return { head: restOfSeasonHead(now.from), figures, ranks };
}

/** The tier box at the read's clock. Its basis names the weeks his own figure counts, the span his rest
 * tile says (Lane 162, D03), and each player whose figure counts other weeks says his; the board's first
 * week only on an answer older than his. Each player's rank is the read's (the API's ranks for the
 * line, Lane 128), so the box and the card's head say one number (D02). */
function tierOf(week: PlayerWeek, now: LiveRest | null, ask: TierAsk | null): LiveTier | null {
	const tier = week.tier;
	if (now === null || ask === null || tier == null) return null;
	const his = week.rest_from_week;
	const board =
		tier.from_week === null ? playerRestWords(null) : restFromWords(tier.from_week, tier.partial);
	const ranked = tier.mates.some((m) => m.position_rank !== undefined);
	const spanned = his !== undefined && tier.mates.some((m) => m.from_week !== undefined);
	return {
		points: Object.fromEntries(tier.mates.map((m) => [m.board_id, m.points])),
		ranks: ranked
			? Object.fromEntries(tier.mates.map((m) => [m.board_id, m.position_rank ?? null]))
			: null,
		spans: spanned
			? Object.fromEntries(tier.mates.map((m) => [m.board_id, tierSpanOf(m.from_week, his)]))
			: null,
		drop: tier.drop,
		basis: tierBasisWords(ask.label, ask.season, his === undefined ? board : restSpanWords(his))
	};
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

/** The card's verb with no move on a locked row (Lane 85 fix round 2, M-D): Start him once his game
 * has kicked off at the page's clock becomes the way to the lineup, as every league screen holds it. */
export function heldVerb(
	verb: NonNullable<PlayerWeek['verb']>,
	line: GameLine,
	now: number
): NonNullable<PlayerWeek['verb']> {
	return verb.kind === 'start' && pastKickoff(line, now) ? { ...verb, kind: 'lineup' } : verb;
}

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
				label: CARD.startHim,
				href: screenHref('start', player),
				external: false,
				note: null
			};
		case 'lineup':
			return {
				kind: verb.kind,
				label: CARD.openLineup,
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
	if (isFreeAgent(week.line.player.team)) return CARD.freeAgentWeek;
	if (week.line.facts.bye) return CARD.byeWeek;
	return week.projection_read_at === null ? CARD.projNotIn : CARD.projNotHim;
}

/** The week tile names its figure as the published projection with when it was read (Lane 139, C06), so
 * it is never read as ours; its scoring is the basis's. */
function publishedWords(readAt: string | null, zone: string): string {
	return readAt === null
		? WEEK_TILE.published
		: `${WEEK_TILE.published}, read ${stampAt(readAt, zone)}`;
}

/** The figure the shown read quotes when the tile prints another (Lane 165, D10): a read that stands
 * (his game kicked off, or the move under the shown threshold) while the published projection has moved
 * a tenth or more from it. Null when the tile shows the quoted figure, the read quotes none, or the
 * read is withheld, which says its own words instead. */
function readFigureWords(week: PlayerWeek, now: number, read: ReadQuote | null): string | null {
	const value = week.line.week_projection;
	const quoted = read?.week === week.week ? read.projection : null;
	if (value === null || quoted === null || quoted === undefined) return null;
	if (printTenth(quoted) === printTenth(value)) return null;
	const scoring = week.projection_scoring.format;
	// A read the page withholds (the run's, or for the move) quotes nothing to explain (fix round 1, M2),
	// by the one test shownWeekRead uses.
	const card = {
		week: week.week,
		scoring,
		points: value,
		state: lineState(week.line, now)
	};
	if (read === null) return null;
	if (read.body === null || movedPastRead(read, card)) return null;
	return WEEK_TILE.atRead(printTenth(quoted), scoring === 'ppr' ? null : SCORING_WORDS.ppr);
}

function projTile(week: PlayerWeek, zone: string, now: number, read: ReadQuote | null): CardTile {
	const value = week.line.week_projection;
	const atRead = readFigureWords(week, now, read);
	const published =
		value === null ? noProjWords(week) : publishedWords(week.projection_read_at, zone);
	return {
		key: 'proj',
		// Beside the season's Projected, headed by the API's week, never the clock (the ruling).
		label: weekHead(week.week),
		value: value === null ? NONE : printTenth(value),
		caption: atRead === null ? published : `${published}. ${atRead}`,
		tone: 'lead'
	};
}

/** His next game after the bye as the tiles name it: "Wk 7 vs GB". */
function afterByeWhere(after: AfterBye): string {
	const { facts } = after.line;
	return `${weekHead(after.week)} ${facts.home === false ? 'at' : 'vs'} ${facts.opponent ?? NONE}`;
}

/** On his bye the opponent tile reads his next game's (Lane 100, B30): no tile of the bye week holds
 * a figure. */
function afterByeOppTile(after: AfterBye, position: string): CardTile {
	const { opp_rank: rank, facts } = after.line;
	const where = afterByeWhere(after);
	if (rank === null)
		return {
			key: 'opp',
			label: CARD.opp,
			value: NONE,
			caption: `${where}, ${CARD.notRanked}`,
			tone: null
		};
	const of = facts.allowed_to_position?.of ?? null;
	return {
		key: 'opp',
		label: CARD.opp,
		value: oppRankWord(rank),
		caption: oppCaption(where, rank, of, position),
		tone: easeOf(rank, of)
	};
}

/** On his bye the change's tile gives his next game's Proj (Lane 100, B30), or the day it is first
 * published while it is not in. */
function afterByeProjTile(
	after: AfterBye,
	scoring: Schemas['ProjectionScoring'],
	zone: string
): CardTile {
	const value = after.line.week_projection;
	const arrives = after.projection_arrives_at;
	const pending = arrives === null ? CARD.nextProjNotIn : publishedOn(weekdayName(arrives, zone));
	return {
		key: 'delta',
		label: `${weekHead(after.week)} ${CARD.proj}`,
		value: value === null ? NONE : printTenth(value),
		caption: value === null ? pending : SCORING_WORDS[scoring.format],
		tone: 'quiet'
	};
}

/** His next game after the bye, when the read is on his bye and carries one. */
function afterByeOf(week: PlayerWeek): AfterBye | null {
	return week.line.facts.bye ? (week.after_bye ?? null) : null;
}

function oppTile(week: PlayerWeek, position: string): CardTile {
	const after = afterByeOf(week);
	if (after !== null) return afterByeOppTile(after, position);
	const { opp_rank: rank, facts } = week.line;
	const opponent = facts.opponent ?? '';
	if (rank === null) {
		// A free agent has no opponent to rank (Lane 123): the Wk tile says why.
		const none = isFreeAgent(week.line.player.team) || facts.opponent === null;
		return {
			key: 'opp',
			label: CARD.opp,
			value: NONE,
			caption: facts.bye ? BOX.bye : none ? '' : `${opponent}, ${CARD.notRanked}`,
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

/** The change's caption: what it is measured from, never a stamp (Lane 139, C12: the page keeps three),
 * or why there is none. With no Proj the Proj tile says why, so the change says nothing. */
function deltaCaption(week: PlayerWeek, move: ProjectionMove): string {
	if (week.line.week_projection === null) return CARD.noProjToCompare;
	if (move.basis === 'read') return readDeltaCaption(move);
	if (week.projection_previous_read_at === null) return CARD.noEarlierRead;
	if (week.line.projection_delta === null) return CARD.notInEarlier;
	return move.crosses ? WEEK_TILE.sinceEarlier : WEEK_TILE.underShown;
}

function readDeltaCaption(move: ProjectionMove): string {
	if (move.change === null) return WEEK_TILE.notInRead;
	return move.crosses ? WEEK_TILE.sinceRead : WEEK_TILE.underShownRead;
}

/** The week's move as the change tile and the read's withhold both read it (Lane 162, D04 fix round 1):
 * from the read's quoted figure when a read was written for this week, else from the earlier snapshot. */
function moveOf(week: PlayerWeek, read: ReadQuote | null): ProjectionMove {
	const quoted = read?.week === week.week ? read.projection : undefined;
	return projectionMove(week.line.week_projection, quoted, week.line.projection_delta);
}

/** The change as the tile prints it: null for a move under SHOWN_CHANGE_FROM (Lane 139, C21). */
function shownChange(move: ProjectionMove): number | null {
	return move.crosses ? move.change : null;
}

function deltaTile(week: PlayerWeek, zone: string, now: number, read: ReadQuote | null): CardTile {
	const after = afterByeOf(week);
	if (after !== null) return afterByeProjTile(after, week.projection_scoring, zone);
	// A free agent has no game (Lane 123): no change to measure, and no kickoff to say.
	if (isFreeAgent(week.line.player.team))
		return { key: 'delta', label: CARD.delta, value: NONE, caption: '', tone: 'quiet' };
	const ahead = toPlay(week.line, now) || week.line.facts.bye;
	const move = moveOf(week, read);
	return {
		key: 'delta',
		label: CARD.delta,
		value: ahead ? deltaWord(shownChange(move)) : NONE,
		caption: ahead
			? deltaCaption(week, move)
			: lineState(week.line, now) === 'final'
				? CARD.gameFinal
				: CARD.kickedOff,
		tone: 'quiet'
	};
}

/** His rest of season at the read's clock in the tile's format (Lane 86, review H3): the read's figure
 * for that format and the week it starts from, his club's next game. Null on a preseason board and on
 * a read that carries no figure for it: the run's figure and its week stand together. */
function restNow(week: PlayerWeek, rest: RestParts | null): LiveRest | null {
	const figure = week.rest_of_season?.find((f) => f.format === rest?.board);
	if (figure === undefined) return null;
	return { points: figure.points, from: playerRestWords(week.rest_from_week ?? null) };
}

/** Rest of season with his figure a game from the API's read (the league rows' one source), only
 * when the read is in the tile's own scoring: a league in another scoring leaves it out and the
 * caption names the tile's (review N2). In that scoring the read's points replace the run's, and in
 * any its week: a game kicked off since the run is no longer counted (Lane 86). The tile as built on a
 * preseason board. */
function restTile(
	week: PlayerWeek,
	rest: RestParts | null,
	fallback: CardTile,
	position: string
): CardTile {
	if (rest === null) return fallback;
	// His rank as the read places him (the API's line, the one every league screen says), over the
	// run's once read (Lane 128 fix round 3); the run's while the read places him nowhere.
	const ranked = week.line.position_rank;
	const rank = ranked === null ? rest.rank : restRankWords(position, ranked);
	const same = week.projection_scoring.format === rest.scoring;
	const now = restNow(week, rest);
	const perGame = week.line.rest_of_season_per_game;
	const game = same && perGame !== null ? `, ${printTenth(perGame)} a game` : '';
	const scoring = same ? '' : `, in ${rest.label} scoring`;
	// The weeks follow the figure the tile prints (review H1), said as the weeks counted (Lane 139, C03).
	const span = now === null ? rest.span : restSpanWords(week.rest_from_week ?? null);
	return {
		...fallback,
		...(now === null ? {} : { value: printTenth(now.points) }),
		caption: `${span}${game}, ${rank}${scoring}`
	};
}

/** The change tile's basis line: what its move is measured from (Lane 162, D04), none on a bye. */
function changePartOf(week: PlayerWeek, read: ReadQuote | null): string | null {
	if (afterByeOf(week) !== null) return null;
	if (moveOf(week, read).basis === 'read') return WEEK_TILE.changePartRead;
	return week.projection_previous_read_at === null ? null : WEEK_TILE.changePart;
}

/** The basis lines the week's read says, once each and short (the Waivers forms): the projection's
 * with its change's, then the evidence columns' scoring, and while a game waits on its stats, when they
 * land. No stamp (Lane 139, C12): the week tile says when the projection was read, the read's caption
 * when it was written, and the Game cell labels its expected score. A "--" says why on its own tile. */
export function liveBasis(
	week: PlayerWeek,
	league: boolean,
	zone: string,
	now: number,
	listed = false,
	read: ReadQuote | null = null
): string[] {
	const scoringWords = league
		? 'your scoring'
		: `${SCORING_WORDS[week.projection_scoring.format]} scoring`;
	// A listed player's card draws no week figure (Lane 128): his basis says only what it shows.
	if (listed) return [`${CARD.listedWeek} ${avgLastPart(scoringWords)}`];
	const clock = { zone, zoned: true };
	const proj = [
		projUnstampedPart(
			{
				readAt: week.projection_read_at,
				scoring: week.projection_scoring,
				defense: false,
				league,
				head: weekHead(week.week)
			},
			clock
		),
		// On his bye the change's tile gives his next week's Proj: no change is shown to name.
		changePartOf(week, read)
	]
		.filter((said) => said !== null)
		.join(' ');
	const evidence = `${OPP_PART} ${avgLastPart(scoringWords)}`;
	const facts = kickedOffPartAt([week.line], now);
	return [proj, facts === null ? evidence : `${evidence} ${facts}`];
}

/** The card's head from the read: its week, and the game or the bye in it. */
function headOf(week: PlayerWeek, zone: string, now: number): CardHead {
	const game = gameOf(week.line, week.line.player.team, zone, now);
	const opponent =
		game === null ? NONE : game === 'bye' ? BOX.bye : game === 'no-club' ? BOX.noClub : game.where;
	return { week: week.week, opponent };
}

/** His week's game under his name and as the log's accent row: the expected score and the weather
 * only while it is still to be played (Lane 80), "Kicked off" or "Final" in place of the kickoff
 * after. */
function nextOf(
	week: PlayerWeek,
	zone: string,
	now: number,
	listed = false
): { cell: NextCell | null; next: LogNext | null } {
	const { facts } = week.line;
	const game = heldGame(gameOf(week.line, week.line.player.team, zone, now));
	if (game === null) return { cell: null, next: null };
	// A listed player's game is not his (Lane 128): its expected score, weather and Proj are not drawn.
	const ahead = toPlay(week.line, now) && !listed;
	const cell: NextCell = {
		where: game.where,
		// A kickoff still to come says its zone (Lane 139, C11); Final and Kicked off need none.
		when:
			toPlay(week.line, now) && facts.kickoff !== null ? kickoffAt(facts.kickoff, zone) : game.when,
		expected: ahead ? expectedScoreWords(facts, week.line.player.team) : null,
		weather: ahead ? weatherCell(facts) : null
	};
	const proj = listed ? null : week.line.week_projection;
	return {
		cell,
		next: {
			week: week.week,
			opponent: game.where,
			// The log's accent row says the kickoff as the cell does, with its zone (Lane 139, C11).
			when: cell.when,
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
	/** The tier box the read was asked for, null when the page shows none. */
	tier?: TierAsk | null;
	/** The in-season row under the tiles as built (Lane 100), empty preseason. */
	basisTiles?: readonly BasisTile[];
	/** Each week's last kickoff on the run's schedule, the moment its lineup can no longer be set. */
	lastKickoffs?: Readonly<Record<number, string>>;
	/** The season-long list's word ("IR") his card's pill shows, null when he is on none: his week's
	 * tiles then say the list in place of a Proj, an Opp rank or a change (Lane 128 fix round 1). */
	held?: string | null;
	/** The week's read, whose quoted projection the change tile measures from (Lane 162, D04). */
	read?: ReadQuote | null;
	screenHref: ScreenHref;
	zone?: string;
	/** The time the card is drawn at, in ms: a game kicked off by then says no facts read. */
	now: number;
}

/** The verb fits the moment (Lane 100, B64): his lineup's verbs only while the week's lineup can
 * still be set, by its last kickoff on the run's schedule (a week the schedule does not hold keeps
 * them); the others always. */
export function verbFits(
	verb: NonNullable<PlayerWeek['verb']>,
	lastKickoff: string | null,
	now: number
): boolean {
	const lineup = verb.kind === 'start' || verb.kind === 'lineup';
	return !lineup || lastKickoff === null || lineupOpen(lastKickoff, now);
}

/** His rest of season a game against his Avg once the read gives both in the tile's scoring (Lane
 * 100, B51): the gap of two printed tenths, taken in whole tenths so no new rounding shows. */
function vsAvgTile(week: PlayerWeek, rest: RestParts | null, built: BasisTile): BasisTile {
	const perGame = week.line.rest_of_season_per_game;
	const avg = week.line.season_avg;
	if (rest === null) return built;
	const same = week.projection_scoring.format === rest.scoring;
	if (!same || perGame === null || avg === null) return built;
	const tenths = Math.round(perGame * TENTHS) - Math.round(avg * TENTHS);
	return {
		...built,
		value: signed(tenths / TENTHS),
		caption: vsAvgCaption(printTenth(perGame), printTenth(avg), built.reason, built.mayMiss)
	};
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
	tier = null,
	basisTiles = [],
	lastKickoffs = {},
	held: listed = null,
	read = null,
	screenHref,
	zone = memberZone(),
	now
}: LiveInput): LiveCard {
	const restAtClock = restNow(week, rest);
	const fallback = (key: CardTile['key']): CardTile => {
		const found = tiles.find((tile) => tile.key === key);
		if (!found) throw new Error(`The card has no ${key} tile.`);
		return found;
	};
	const updated = [
		projTile(week, zone, now, read),
		restTile(week, rest, fallback('rest'), player.position),
		oppTile(week, player.position),
		avgTile(week, games, fallback('avg')),
		lastTile(week, opponents, fallback('last')),
		deltaTile(week, zone, now, read)
	].reduce<CardTile[]>((all, tile) => withTile(all, tile), [...tiles]);
	const { cell, next } = nextOf(week, zone, now, listed !== null);
	const leagueVerb = league !== null && week.verb !== null ? week.verb : null;
	const held = leagueVerb !== null && !verbFits(leagueVerb, lastKickoffs[week.week] ?? null, now);
	const verb =
		league === null || leagueVerb === null || held
			? null
			: verbOf(heldVerb(leagueVerb, week.line, now), league, player, screenHref);
	return {
		week: week.week,
		head: headOf(week, zone, now),
		tiles: listedTiles(updated, listed),
		basisTiles: basisTiles.map((tile) =>
			tile.key === 'vsAvg' ? vsAvgTile(week, rest, tile) : tile
		),
		cell,
		next,
		verb,
		// Signed out in season no lineup or league verb fits either: Compare leads, not the sheet's add
		// (Lane 100 fix round 1, M3).
		compareLeads: held || (league === null && compareLeadsWithoutVerb(rest)),
		basis: liveBasis(week, leagueVerb !== null, zone, now, listed !== null, read),
		rest: restAtClock,
		formats: formatsOf(week, restAtClock),
		tier: tierOf(week, restAtClock, tier),
		positionRank: rest === null ? null : week.line.position_rank,
		at: now,
		projection: {
			week: week.week,
			scoring: week.projection_scoring.format,
			points: week.line.week_projection,
			state: lineState(week.line, now)
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
