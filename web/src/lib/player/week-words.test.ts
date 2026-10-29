// The player card's week in words (Lane 66h): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import { KICKED_OFF_PART } from '../league/box/basis.ts';
import type { WeekFacts } from '../league/inseason/api.ts';
import {
	CARD,
	NONE,
	publishedOn,
	unreadBasis,
	compareLeadsWithoutVerb,
	type BasisTile,
	type CardTile
} from './card.ts';
import { printTenth } from '#lib/league/box/box.ts';
import { BASIS_WORDS, vsAvgCaption, vsAvgReason } from './basis-words.ts';
import type { Designations, WeekRead } from '../run/schema.ts';
import { newestWeekRead, noReadWords, shownWeekRead } from './week-read.ts';
import { readAtStatus } from './status-held.ts';
import { STATUS_HELD_WORDS, isStatusCaption } from './status-words.ts';
import {
	compareSay,
	liveCard,
	oppCaption,
	verbOf,
	verbFits,
	heldVerb,
	WEEK_TILE,
	type PlayerWeek,
	type ScreenHref
} from './week-words.ts';

const ZONE = 'America/Chicago';
const READ = '2026-10-17T02:00:00.000Z';
const BEFORE = '2026-10-16T02:00:00.000Z';
/** The clock the card is drawn at: the read's own time, before the fixture's kickoff. Never the real
 * clock, so the week's sentences stay what they were whatever day the tests run. */
const NOW = Date.parse(READ);
const PLAYER = { id: '4426515', name: 'Puka Nacua', team: 'LAR', position: 'WR' };
const LEAGUE = { id: 'league-1', host: 'sleeper' as const };
const href: ScreenHref = (screen, query) =>
	`/league/league-1/${screen}?${new URLSearchParams(query).toString()}`;
const REST = {
	from: 'from week 6',
	span: 'weeks 6 to 17',
	rank: 'WR1 in our order',
	scoring: 'ppr' as const,
	label: 'PPR',
	board: 'ppr' as const
};

const facts = (over: Partial<WeekFacts> = {}): WeekFacts => ({
	week: 6,
	opponent: 'ARI',
	home: true,
	kickoff: '2026-10-18T20:05:00.000Z',
	bye: false,
	designation: null,
	played: false,
	points_this_week: null,
	last_games: [{ week: 5, points: 37.7 }],
	allowed_to_position: { points_a_game: 37, rank: 26, of: 32, position: 'WR' },
	game_total: { points: 52.5, team_points: 32.5, read_at: READ },
	spread: null,
	roof: { kind: 'dome', abroad: false },
	weather: null,
	...over
});

const week = (
	over: Partial<PlayerWeek> = {},
	line: Partial<PlayerWeek['line']> = {}
): PlayerWeek => ({
	week: 6,
	projection_scoring: { format: 'ppr', league_own: false },
	projection_read_at: READ,
	projection_previous_read_at: BEFORE,
	verb: null,
	line: {
		player: {
			host_id: '',
			board_id: PLAYER.id,
			name: '',
			position: 'WR',
			team: 'LAR',
			injured_reserve: false
		},
		headshot: null,
		slug: 'puka-nacua',
		position_rank: 1,
		points_over_replacement: null,
		rest_of_season_per_game: null,
		week_projection: 21.8,
		projection_delta: 0.4,
		opp_rank: 26,
		season_avg: 25.9,
		last_points: 37.7,
		held: false,
		facts: facts(),
		...line
	},
	...over
});

const BUILT: CardTile[] = [
	{ key: 'proj', label: 'Wk 6', value: NONE, caption: CARD.readOnOpen, tone: 'lead' },
	{
		key: 'rest',
		label: CARD.rest,
		value: '182.2',
		caption: 'weeks 6 to 17, WR1 in our order',
		tone: null
	},
	{ key: 'opp', label: CARD.opp, value: NONE, caption: 'vs ARI', tone: null },
	{ key: 'avg', label: CARD.avg, value: '25.9', caption: 'a game in 3 games', tone: null },
	{ key: 'last', label: CARD.last, value: '37.7', caption: 'week 5 vs BUF', tone: null },
	{ key: 'delta', label: CARD.delta, value: NONE, caption: '', tone: 'quiet' }
];

const card = (w: PlayerWeek, league: typeof LEAGUE | null = null, now = NOW) =>
	liveCard({
		week: w,
		player: PLAYER,
		league,
		tiles: BUILT,
		opponents: { 5: 'vs BUF' },
		games: 3,
		rest: REST,
		screenHref: href,
		zone: ZONE,
		now
	});

const tile = (tiles: readonly CardTile[], key: CardTile['key']): CardTile => {
	const found = tiles.find((t) => t.key === key);
	assert.ok(found, key);
	return found;
};

void test('the read fills the week tiles and keeps the rest of season as built', () => {
	const { tiles } = card(week());
	assert.deepEqual(
		tiles.map((t) => [t.key, t.value]),
		[
			['proj', '21.8'],
			['rest', '182.2'],
			['opp', '26th'],
			['avg', '25.9'],
			['last', '37.7'],
			// A move under half a point is not drawn (Lane 139, C21).
			['delta', NONE]
		]
	);
	// Beside the season's Projected the week's projection is headed by the API's week (the ruling), and
	// named as the published projection with its read, so it is never read as ours (Lane 139, C06).
	assert.equal(tile(tiles, 'proj').label, 'Wk 6');
	assert.equal(tile(tiles, 'proj').caption, 'published projection, read Fri Oct 16, 9:00 pm CT');
	assert.equal(tile(tiles, 'opp').caption, 'ARI, among the easiest for receivers');
	assert.equal(tile(tiles, 'opp').tone, 'easy');
	assert.equal(tile(tiles, 'last').caption, 'week 5 vs BUF');
	assert.equal(tile(tiles, 'delta').caption, 'Moved under 0.5 since the earlier read');
	assert.equal(tile(tiles, 'delta').label, 'Proj change');
	assert.equal(tile(tiles, 'rest').caption, 'weeks 6 to 17, WR1 in our order');
	// A move of half a point or more is drawn, its caption without a stamp (C12).
	const moved = card(week({}, { projection_delta: 0.5 })).tiles;
	assert.deepEqual(
		[tile(moved, 'delta').value, tile(moved, 'delta').caption],
		['+0.5', 'since the earlier read']
	);
	assert.equal(tile(card(week({}, { projection_delta: -1.2 })).tiles, 'delta').value, '\u22121.2');
});

void test("rest of season's figure a game is the API's, one source with the league's rows", () => {
	const { tiles } = card(week({}, { rest_of_season_per_game: 23.1 }));
	assert.equal(tile(tiles, 'rest').caption, 'weeks 6 to 17, 23.1 a game, WR1 in our order');
	assert.equal(tile(tiles, 'rest').value, '182.2');
});

void test("the rest tile stays in one scoring: the read's figure a game only when it is the tile's", () => {
	// A half-PPR league's read on a PPR tile: no figure a game, and the tile says its scoring.
	const half = card(
		week(
			{ projection_scoring: { format: 'half_ppr', league_own: true } },
			{ rest_of_season_per_game: 19.4 }
		),
		LEAGUE
	);
	assert.equal(tile(half.tiles, 'rest').caption, 'weeks 6 to 17, WR1 in our order, in PPR scoring');
	assert.equal(tile(half.tiles, 'rest').value, '182.2');
});

/** The read's rest of season in every run format, Sunday evening: his game is played, so 167.5 from
 * week 7 in PPR (review H3). */
const RUN_FORMATS_LIVE = [
	{ format: 'ppr', points: 167.5, points_over_replacement: 88.2 },
	{ format: 'half_ppr', points: 150.1, points_over_replacement: 80.4 },
	{ format: 'standard', points: 132.7, points_over_replacement: 71.9 },
	{ format: 'superflex', points: 167.5, points_over_replacement: 60.3 }
] as const;
const LIVE_TIER: NonNullable<PlayerWeek['tier']> = {
	format: 'ppr',
	mates: [
		{ board_id: 'ja-marr-chase', points: 171.0 },
		{ board_id: PLAYER.id, points: 167.5 }
	],
	drop: 9.4,
	from_week: 6,
	partial: true
};
const TIER_ASK = { label: 'PPR', season: 2026 };

void test("on Sunday evening the read's rest of season replaces the run's: his game is played, so he counts from week 7 (Lane 86)", () => {
	const live = card(
		week(
			{ rest_of_season: [...RUN_FORMATS_LIVE], rest_from_week: 7 },
			{ rest_of_season_per_game: 16.8 }
		)
	);
	assert.equal(tile(live.tiles, 'rest').value, '167.5');
	assert.equal(tile(live.tiles, 'rest').caption, 'weeks 7 to 17, 16.8 a game, WR1 in our order');
	assert.deepEqual(live.rest, { points: 167.5, from: 'from week 7' });
	// A read older than the fields keeps the run's figure and the run's week.
	const older = card(week());
	assert.equal(older.rest, null);
	assert.equal(tile(older.tiles, 'rest').caption, 'weeks 6 to 17, WR1 in our order');
});

void test("review H1: in another scoring the tile's week follows the figure it prints", () => {
	// A half-PPR league's read carries the PPR figure at its clock: the tile prints it with its week.
	const half = card(
		week(
			{
				projection_scoring: { format: 'half_ppr', league_own: true },
				rest_of_season: [...RUN_FORMATS_LIVE],
				rest_from_week: 7
			},
			{ rest_of_season_per_game: 15 }
		),
		LEAGUE
	);
	assert.equal(tile(half.tiles, 'rest').value, '167.5');
	assert.equal(tile(half.tiles, 'rest').caption, 'weeks 7 to 17, WR1 in our order, in PPR scoring');
	// A read with no figure for the tile's format leaves the run's figure under the run's week.
	const without = card(
		week(
			{
				projection_scoring: { format: 'half_ppr', league_own: true },
				rest_of_season: [RUN_FORMATS_LIVE[1]],
				rest_from_week: 7
			},
			{ rest_of_season_per_game: 15 }
		),
		LEAGUE
	);
	assert.equal(tile(without.tiles, 'rest').value, '182.2');
	assert.equal(
		tile(without.tiles, 'rest').caption,
		'weeks 6 to 17, WR1 in our order, in PPR scoring'
	);
	assert.equal(without.rest, null);
});

void test('review H3: the tile, the read, the every-format table and the tier box take one figure after a kickoff', () => {
	const live = liveCard({
		week: week({ rest_of_season: [...RUN_FORMATS_LIVE], rest_from_week: 7, tier: LIVE_TIER }),
		player: PLAYER,
		league: null,
		tiles: BUILT,
		opponents: { 5: 'vs BUF' },
		games: 3,
		rest: REST,
		tier: TIER_ASK,
		screenHref: href,
		zone: ZONE,
		now: NOW
	});
	const figure = '167.5';
	assert.equal(tile(live.tiles, 'rest').value, figure);
	assert.ok(live.rest && live.formats && live.tier);
	assert.equal(live.rest.points.toFixed(1), figure);
	assert.equal(live.formats.figures.ppr?.points.toFixed(1), figure);
	assert.equal(live.tier.points[PLAYER.id]?.toFixed(1), figure);
	// Each names the week it counts from.
	assert.equal(live.formats.head, 'Rest of season from week 7');
	assert.equal(live.formats.figures.superflex?.vor, 60.3);
	assert.equal(live.tier.drop, 9.4);
	// The box's basis names the weeks his own figure counts, as his tile does (Lane 162, D03), never the
	// board's partly played week beside a total that no longer counts it.
	assert.equal(live.tier.basis, 'Projected PPR points for the rest of 2026, weeks 7 to 17');
	// An answer older than the ranks keeps the run's (Lane 162).
	assert.equal(live.tier.ranks, null);
	assert.equal(live.tier.spans, null);
	// Review M3: with only him in the box, the basis words his own weeks, as his tile does.
	const alone = liveCard({
		week: week({
			rest_of_season: [...RUN_FORMATS_LIVE],
			rest_from_week: 7,
			tier: { ...LIVE_TIER, mates: LIVE_TIER.mates.slice(1) }
		}),
		player: PLAYER,
		league: null,
		tiles: BUILT,
		opponents: {},
		games: 3,
		rest: REST,
		tier: TIER_ASK,
		screenHref: href,
		zone: ZONE,
		now: NOW
	});
	assert.equal(alone.tier?.basis, 'Projected PPR points for the rest of 2026, weeks 7 to 17');
	assert.equal(card(week()).formats, null);
	// An answer older than the per-format ranks carries none: the table keeps the older rule.
	assert.equal(live.formats.ranks, null);
	// With them (Lane 227, B206), each format's rank from the same answer; a null one is left out of
	// the API's answer and reads as none.
	const ranked = liveCard({
		week: week({
			rest_of_season: RUN_FORMATS_LIVE.map((f, i) =>
				i === 0 ? { ...f, position_rank: 3, overall_rank: 9 } : f
			),
			rest_from_week: 7
		}),
		player: PLAYER,
		league: null,
		tiles: BUILT,
		opponents: {},
		games: 3,
		rest: REST,
		tier: null,
		screenHref: href,
		zone: ZONE,
		now: NOW
	});
	assert.ok(ranked.formats?.ranks);
	assert.deepEqual(ranked.formats.ranks, {
		ppr: 3,
		half_ppr: null,
		standard: null,
		superflex: null
	});
	assert.equal(card(week()).tier, null);
});

void test("the API's tenths print as given: formatting only, never rounded again (Lane 66k)", () => {
	assert.equal(printTenth(9.5), '9.5');
	assert.equal(printTenth(23), '23.0');
	assert.equal(printTenth(0), '0.0');
	assert.equal(printTenth(37.7), '37.7');
	// A per-game figure of 20 prints its tenth.
	const { tiles } = card(week({}, { season_avg: 20, last_points: 37.7 }));
	assert.equal(tile(tiles, 'avg').value, '20.0');
});

void test("the opponent's rank says its direction in words", () => {
	assert.equal(oppCaption('NO', 3, 32, 'QB'), 'NO, among the toughest for quarterbacks');
	assert.equal(oppCaption('GB', 15, 32, 'WR'), 'GB, in the middle for receivers');
	assert.equal(oppCaption('ARI', 26, 32, 'TE'), 'ARI, among the easiest for tight ends');
});

void test('a figure not held is "--", and its tile says why', () => {
	// The snapshot is stored, his row is not in it.
	const missing = card(week({}, { week_projection: null, projection_delta: null, opp_rank: null }));
	assert.equal(tile(missing.tiles, 'delta').caption, 'No projection to compare');
	assert.deepEqual(
		[tile(missing.tiles, 'proj').value, tile(missing.tiles, 'proj').caption],
		[NONE, "Not in this week's published projection"]
	);
	assert.equal(tile(missing.tiles, 'opp').caption, 'ARI, not ranked yet');

	// No snapshot stored for the week.
	const unread = card(
		week(
			{ projection_read_at: null, projection_previous_read_at: null },
			{ week_projection: null, projection_delta: null }
		)
	);
	assert.equal(tile(unread.tiles, 'proj').caption, "This week's projection is not in yet");
	// One read this week: no change to show.
	const once = card(week({ projection_previous_read_at: null }, { projection_delta: null }));
	assert.deepEqual(
		[tile(once.tiles, 'delta').value, tile(once.tiles, 'delta').caption],
		[NONE, 'No earlier read this week']
	);
	// Two reads, his row only in the newest.
	const newer = card(week({}, { projection_delta: null }));
	assert.equal(tile(newer.tiles, 'delta').caption, 'Not in the earlier read');
	assert.match(unreadBasis(true, 'Wk 6'), /could not be read just now/);
});

void test('the week ahead is the box row and the cell under his name', () => {
	const { cell, next } = card(week());
	// The kickoff says its zone, the expected score its label and both clubs (Lane 139, C07, C11).
	assert.deepEqual(cell, {
		where: 'vs ARI',
		when: 'Sun 3:05 pm CT',
		expected: 'Expected score LAR 32.5, ARI 20',
		weather: { glyph: 'indoors', words: 'Indoors' }
	});
	assert.equal(next?.proj, '21.8');
	assert.equal(next.when, 'Sun 3:05 pm CT');
	const bye = card(
		week(
			{},
			{
				opp_rank: null,
				week_projection: null,
				projection_delta: null,
				facts: facts({ bye: true, opponent: null, home: null, kickoff: null })
			}
		)
	);
	assert.equal(bye.next, null);
	assert.equal(tile(bye.tiles, 'opp').caption, 'Bye');
	assert.equal(tile(bye.tiles, 'proj').caption, 'Bye this week');
});

void test('the Monday after his Sunday game: kicked off, no expected score, weather or change (Lane 80)', () => {
	const monday = card(week({}, { facts: facts({ game_state: 'kicked_off' }) }));
	assert.deepEqual(monday.cell, {
		where: 'vs ARI',
		when: 'Kicked off',
		expected: null,
		weather: null
	});
	const { next } = monday;
	assert.ok(next);
	assert.equal(next.when, 'Kicked off');
	assert.equal(next.expected, null);
	assert.equal(next.weather, null);
	assert.deepEqual(tile(monday.tiles, 'delta'), {
		key: 'delta',
		label: CARD.delta,
		value: NONE,
		caption: CARD.kickedOff,
		tone: 'quiet'
	});
	assert.equal(monday.basis[1]?.endsWith(KICKED_OFF_PART), true, monday.basis[1]);
	const final = card(week({}, { facts: facts({ game_state: 'final', played: true }) }));
	const { cell } = final;
	assert.ok(cell);
	assert.equal(cell.when, 'Final');
	assert.equal(tile(final.tiles, 'delta').caption, CARD.gameFinal);
	assert.equal(cell.expected, null);
	// Final the hour after, his stats not in yet: the basis says they follow.
	assert.ok((final.basis[1] ?? '').includes(KICKED_OFF_PART));
	// His week's stats in: nothing more to say.
	const counted = card(
		week(
			{},
			{
				facts: facts({
					game_state: 'final',
					played: true,
					last_games: [{ week: 6, points: 21 }]
				})
			}
		)
	);
	assert.ok(!(counted.basis[1] ?? '').includes(KICKED_OFF_PART));
});

void test("the card's head is the API's week, the bye said in it, so one card shows one week (the sweep M6)", () => {
	assert.deepEqual(card(week()).head, { week: 6, opponent: 'vs ARI' });
	const away = card(week({ week: 7 }, { facts: facts({ week: 7, opponent: 'NYJ', home: false }) }));
	assert.deepEqual(away.head, { week: 7, opponent: 'at NYJ' });
	assert.equal(tile(away.tiles, 'proj').label, 'Wk 7');
	const bye = card(
		week(
			{},
			{
				opp_rank: null,
				week_projection: null,
				facts: facts({ bye: true, opponent: null, home: null, kickoff: null })
			}
		)
	);
	assert.deepEqual(bye.head, { week: 6, opponent: 'Bye' });
	// A week the API names no game for heads with its own week and the empty figure, never the
	// build's week ahead (review 81 finding 4).
	const none = card(
		week({ week: 7 }, { facts: facts({ week: 7, opponent: null, home: null, kickoff: null }) })
	);
	assert.deepEqual(none.head, { week: 7, opponent: NONE });
	assert.equal(tile(bye.tiles, 'proj').label, 'Wk 6');
});

void test("a free agent's card heads No club, and its week tiles say why with no kickoff (Lane 123)", () => {
	// The API's answer for a player the daily list names with no club: "FA", no game, no Proj.
	const free = card(
		week(
			{ projection_previous_read_at: BEFORE },
			{
				player: { ...week().line.player, team: 'FA' },
				opp_rank: null,
				week_projection: null,
				projection_delta: null,
				facts: facts({ opponent: null, home: null, kickoff: null })
			}
		)
	);
	assert.deepEqual(free.head, { week: 6, opponent: 'No club' });
	assert.equal(free.cell, null);
	assert.deepEqual(
		[tile(free.tiles, 'proj').value, tile(free.tiles, 'proj').caption],
		[NONE, 'A free agent, no game this week']
	);
	assert.deepEqual([tile(free.tiles, 'opp').value, tile(free.tiles, 'opp').caption], [NONE, '']);
	assert.deepEqual(
		[tile(free.tiles, 'delta').value, tile(free.tiles, 'delta').caption],
		[NONE, '']
	);
	for (const t of free.tiles) assert.doesNotMatch(t.caption, /kicked off|no team/i);
});

void test('with no league the basis names PPR and no league, and there is no verb', () => {
	const { verb, basis } = card(
		week({ verb: { kind: 'trade', holder: 'Nacua Matata', host_url: null, note: null } })
	);
	assert.equal(verb, null);
	// No stamp in the basis (Lane 139, C12): the week tile says when the projection was read.
	assert.equal(
		basis[0],
		"Wk 6 is this week's published projection in PPR. Proj change is its move since the earlier read, shown from 0.5."
	);
	assert.match(basis[1] ?? '', /PPR scoring\.$/);
	assert.equal(basis.length, 2);
	assert.ok(basis.every((line) => !line.includes('league') && !line.includes('your')));
});

void test('the basis stamps no game facts read, and from his kickoff says when the stats land', () => {
	const kickoff = Date.parse(facts().kickoff ?? '');
	const before = card(week(), null, kickoff - 1).basis[1] ?? '';
	const after = card(week(), null, kickoff).basis[1] ?? '';
	// The Game cell labels its expected score (Lane 139, C07): no read stamp beside it (C12).
	assert.ok(!before.includes('read'), before);
	assert.ok(!before.includes(KICKED_OFF_PART), before);
	// At his kickoff the one rule reads his game kicked off (kickoff.ts lineState, Lane 85 fix round 2),
	// so the card says when Final and the stats land, as the boards and the league screens do.
	assert.ok(after.endsWith(KICKED_OFF_PART), after);
});

void test('the card draws no move on a locked row: Start him becomes the way to the lineup (M-D)', () => {
	const kickoff = Date.parse(facts().kickoff ?? '');
	const start = { kind: 'start' as const, holder: null, host_url: null, note: null };
	assert.equal(heldVerb(start, { facts: facts() }, kickoff - 1).kind, 'start');
	assert.equal(heldVerb(start, { facts: facts() }, kickoff).kind, 'lineup');
	const trade = { ...start, kind: 'trade' as const };
	assert.equal(heldVerb(trade, { facts: facts() }, kickoff).kind, 'trade');
});

void test("with a league the verb is the league screens', the platform named", () => {
	const at = (kind: NonNullable<PlayerWeek['verb']>['kind'], host_url: string | null = null) =>
		verbOf({ kind, holder: null, host_url, note: null }, LEAGUE, PLAYER, href);
	assert.deepEqual(at('start'), {
		kind: 'start',
		label: 'Start him',
		href: '/league/league-1/start?player=4426515',
		external: false,
		note: null
	});
	assert.equal(at('lineup').label, 'Open your lineup');
	assert.equal(at('trade').href, '/league/league-1/trades?player=4426515');
	assert.deepEqual(
		[at('claim').label, at('claim').href, at('claim').external],
		['Add on Sleeper', '/league/league-1/waivers?player=4426515&position=WR', false]
	);
	// No page of the platform's known: our Waivers screen, landing on him, named as ours.
	assert.deepEqual(
		[at('waivers').label, at('waivers').href, at('waivers').external],
		['Find him on Waivers', '/league/league-1/waivers?player=4426515&position=WR', false]
	);
	const waivers = at('waivers', 'https://sleeper.com/leagues/1/players');
	assert.equal(waivers.label, 'Open Sleeper waivers');
	assert.ok(waivers.external);
	assert.equal(
		waivers.note,
		"Claims are not sent to Sleeper from here, so this copies his name and opens Sleeper's waiver page."
	);
	const { basis } = card(
		week({ verb: { kind: 'start', holder: null, host_url: null, note: null } }),
		LEAGUE
	);
	assert.match(basis[0] ?? '', /, PPR nearest your rules\. /);
	assert.match(basis[1] ?? '', /your scoring/);
});

/** Week 6's last kickoff on the run's schedule, the Monday night game. */
const LAST_KICKOFF = '2026-10-20T00:15:00.000Z';
const ON_BYE = facts({
	opponent: null,
	home: null,
	kickoff: null,
	bye: true,
	allowed_to_position: null
});
const NEXT_GAME = facts({
	week: 7,
	opponent: 'GB',
	home: true,
	kickoff: '2026-10-25T17:00:00.000Z',
	allowed_to_position: { points_a_game: 24.1, rank: 12, of: 32, position: 'RB' }
});
const byeWeek = (projection: number | null, arrives: string | null): PlayerWeek =>
	week(
		{
			projection_read_at: null,
			projection_previous_read_at: null,
			after_bye: {
				week: 7,
				line: { ...week().line, week_projection: projection, opp_rank: 12, facts: NEXT_GAME },
				projection_read_at: projection === null ? null : READ,
				projection_arrives_at: arrives
			}
		},
		{ week_projection: null, projection_delta: null, opp_rank: null, facts: ON_BYE }
	);
const RB = { ...PLAYER, name: 'Jahmyr Gibbs', team: 'DET', position: 'RB' };

void test('on his bye the Opp rank and change tiles read his next game (Lane 100, B30)', () => {
	const at = (w: PlayerWeek) =>
		liveCard({
			week: w,
			player: RB,
			league: null,
			tiles: BUILT,
			opponents: {},
			games: 5,
			rest: REST,
			screenHref: href,
			zone: ZONE,
			now: NOW
		});
	const pending = at(byeWeek(null, '2026-10-22T22:15:00.000Z')).tiles;
	assert.deepEqual(
		[tile(pending, 'opp').value, tile(pending, 'opp').caption],
		['12th', 'Wk 7 vs GB, in the middle for running backs']
	);
	assert.deepEqual(
		[tile(pending, 'delta').label, tile(pending, 'delta').value, tile(pending, 'delta').caption],
		['Wk 7 Proj', NONE, publishedOn('Thursday')]
	);
	assert.equal(tile(pending, 'proj').caption, CARD.byeWeek);
	// Its capture time passed with none read: the tile's own words, never this week's (fix round 1, LOW-1).
	assert.equal(tile(at(byeWeek(null, null)).tiles, 'delta').caption, CARD.nextProjNotIn);
	const read = at(byeWeek(18.4, null)).tiles;
	assert.deepEqual([tile(read, 'delta').value, tile(read, 'delta').caption], ['18.4', 'PPR']);
	// A bye with no game read after it keeps the bye week's words.
	const none = at(
		week({}, { week_projection: null, projection_delta: null, opp_rank: null, facts: ON_BYE })
	).tiles;
	assert.deepEqual([tile(none, 'opp').value, tile(none, 'opp').caption], [NONE, 'Bye']);
	assert.equal(tile(none, 'delta').label, CARD.delta);
});

void test("the lineup verb fits the moment: once the week's last game kicks off, Compare leads (Lane 100, B64)", () => {
	const lineup = { kind: 'lineup' as const, holder: null, host_url: null, note: null };
	const kickoff = Date.parse(LAST_KICKOFF);
	assert.ok(verbFits(lineup, LAST_KICKOFF, kickoff - 1));
	assert.ok(!verbFits(lineup, LAST_KICKOFF, kickoff));
	assert.ok(!verbFits({ ...lineup, kind: 'start' }, LAST_KICKOFF, kickoff));
	assert.ok(verbFits({ ...lineup, kind: 'trade' }, LAST_KICKOFF, kickoff));
	assert.ok(verbFits(lineup, null, kickoff));
	const at = (now: number) =>
		liveCard({
			week: week({ verb: lineup }),
			player: PLAYER,
			league: LEAGUE,
			tiles: BUILT,
			opponents: {},
			games: 3,
			rest: REST,
			screenHref: href,
			zone: ZONE,
			now,
			lastKickoffs: { 6: LAST_KICKOFF }
		});
	const open = at(NOW);
	assert.deepEqual([open.verb?.label, open.compareLeads], [CARD.openLineup, false]);
	const past = at(kickoff + 60_000);
	assert.deepEqual([past.verb, past.compareLeads], [null, true]);
	// The basis still names the league's scoring: the read is the league's.
	assert.match(past.basis[1] ?? '', /your scoring/);
});

void test('signed out in season Compare leads, and preseason the sheet add stays (fix round 1, M3)', () => {
	assert.equal(card(week()).compareLeads, true);
	const preseason = liveCard({
		week: week(),
		player: PLAYER,
		league: null,
		tiles: BUILT,
		opponents: {},
		games: 3,
		rest: null,
		screenHref: href,
		zone: ZONE,
		now: NOW
	});
	assert.equal(preseason.compareLeads, false);
});

void test('our rate vs his Avg is the rest of season a game less his Avg, from the two printed tenths (Lane 100, B51)', () => {
	const built: BasisTile[] = [
		{
			key: 'pace',
			label: BASIS_WORDS.pace,
			value: '16.7',
			caption: BASIS_WORDS.paceCaption,
			reason: null,
			mayMiss: false
		},
		{
			key: 'vsAvg',
			label: BASIS_WORDS.vsAvg,
			value: NONE,
			caption: BASIS_WORDS.vsAvgCaption,
			reason: vsAvgReason({ games: 5, blended: 27.1, share: 29, rate: 24.1 }),
			mayMiss: true
		}
	];
	const at = (perGame: number | null, format: 'ppr' | 'half_ppr' = 'ppr', tiles = built) =>
		liveCard({
			week: week(
				{ projection_scoring: { format, league_own: false } },
				{ rest_of_season_per_game: perGame, season_avg: 30.7 }
			),
			player: PLAYER,
			league: null,
			tiles: BUILT,
			opponents: {},
			games: 5,
			rest: REST,
			screenHref: href,
			zone: ZONE,
			now: NOW,
			basisTiles: tiles
		}).basisTiles;
	const filled = at(22.0);
	assert.equal(filled.find((t) => t.key === 'vsAvg')?.value, '\u22128.7');
	assert.equal(
		filled.find((t) => t.key === 'vsAvg')?.caption,
		'30.7 Avg in 5 games, 27.1 blended with his usage, 24.1 weighted 29% to his preseason pace, 22.0 a game after the games he may miss'
	);
	// A player the run expects to play every game left says no games he may miss (Lane 165, D17): the
	// caption stops at the rate it blended to.
	const healthy = built.map((t) => ({ ...t, mayMiss: false }));
	const healthyCaption = at(24.1, 'ppr', healthy).find((t) => t.key === 'vsAvg')?.caption ?? '';
	assert.equal(
		healthyCaption,
		'30.7 Avg in 5 games, 27.1 blended with his usage, 24.1 weighted 29% to his preseason pace'
	);
	assert.doesNotMatch(healthyCaption, /may miss/u);
	// "--" stands with the plain caption: no reason beside a figure not drawn (fix round 1, M4).
	assert.equal(at(null).find((t) => t.key === 'vsAvg')?.caption, BASIS_WORDS.vsAvgCaption);
	assert.equal(filled.find((t) => t.key === 'pace')?.value, '16.7');
	assert.equal(at(null).find((t) => t.key === 'vsAvg')?.value, NONE);
	// In another scoring than the tile's the figure a game is not the tile's: no gap is drawn.
	assert.equal(at(22.0, 'half_ppr').find((t) => t.key === 'vsAvg')?.value, NONE);
});

void test('our rate vs his Avg names both figures, the pace and its share, as its tile beside it does (Lane 139, C08)', () => {
	// Its phone lines are the shot script's to count (player-bye-shots.ts), never a character proxy.
	const caption = vsAvgCaption(
		'22.0',
		'30.7',
		vsAvgReason({ games: 5, blended: 27.1, share: 29, rate: 24.1 }),
		true
	);
	// Each step in order, from his Avg to our rate, each figure the run's (Lane 139 fix round 1).
	assert.equal(
		caption,
		'30.7 Avg in 5 games, 27.1 blended with his usage, 24.1 weighted 29% to his preseason pace, 22.0 a game after the games he may miss'
	);
	assert.doesNotMatch(caption, /\bless\b/u);
	assert.equal(vsAvgCaption('22.0', '30.7', null, false), '22.0 a game vs his 30.7 Avg');
	assert.match(caption, new RegExp(BASIS_WORDS.pace.toLowerCase()));
	assert.match(BASIS_WORDS.vsAvg, /^Our rate/u);
});

void test('in season with no league verb Compare leads before the read answers, preseason the sheet (Lane 117, B80)', () => {
	assert.equal(compareLeadsWithoutVerb(REST), true);
	assert.equal(compareLeadsWithoutVerb(null), false);
	// The read with no league agrees with the card before it.
	const live = liveCard({
		week: week(),
		player: PLAYER,
		league: null,
		tiles: BUILT,
		opponents: {},
		games: 5,
		rest: REST,
		screenHref: href,
		zone: ZONE,
		now: NOW
	});
	assert.equal(live.compareLeads, compareLeadsWithoutVerb(REST));
});

/** The site's copy guard, with the card's own words: "tip" (the copy rules' no-tips ruling). */
const BANNED = bannedPattern(/\btips?\b/);

void test('copy guard: no card word uses a betting or trading word, the word host, a dash or a semicolon', () => {
	const live = card(
		week({ verb: { kind: 'waivers', holder: null, host_url: 'https://x', note: null } }),
		LEAGUE
	);
	const said = [
		...live.tiles.flatMap((t) => [t.label, t.caption]),
		...live.basis,
		live.verb?.label ?? '',
		live.verb?.note ?? '',
		CARD.tier,
		CARD.readNotYet,
		...Object.values(BASIS_WORDS),
		// Every week tile word, the read's change part included (Lane 192: it held a semicolon).
		...Object.values(WEEK_TILE).filter((said) => typeof said === 'string'),
		vsAvgReason({ games: 5, blended: 27.1, share: 29, rate: 24.1 }),
		publishedOn('Thursday'),
		CARD.writtenFrom,
		CARD.startHim,
		CARD.openLineup,
		unreadBasis(false, 'Wk 6'),
		unreadBasis(true, 'Wk 6')
	];
	for (const line of said) assert.doesNotMatch(line, BANNED, line);
});

const row = (name: string, values: Partial<Record<CardTile['key'], string>>) => ({
	name,
	tiles: BUILT.map((t) => ({ ...t, value: values[t.key] ?? NONE }))
});

void test('Compare answers the start or sit question from the figures both rows hold', () => {
	assert.equal(
		compareSay(
			row('Puka Nacua', { proj: '23.0', avg: '25.9' }),
			row("Ja'Marr Chase", { proj: '16.3', avg: '16.7' })
		),
		'Puka Nacua by 6.7 projected points this week'
	);
	assert.equal(
		compareSay(
			row('Puka Nacua', { proj: '23.0', avg: '25.9' }),
			row("Ja'Marr Chase", { avg: '16.7' })
		),
		"No projection for Ja'Marr Chase this week. Puka Nacua by 9.2 a game this season"
	);
	assert.equal(
		compareSay(row('Puka Nacua', { rest: '344.1' }), row("Ja'Marr Chase", { rest: '333.2' })),
		'Puka Nacua by 10.9 points rest of season'
	);
	assert.equal(compareSay(row('A', {}), row('B', {})), null);
});

void test("a listed player's week is not his: Proj, Opp rank and the change say On IR (Lane 128)", () => {
	const listed = (w: PlayerWeek) =>
		liveCard({
			week: w,
			player: RB,
			league: null,
			tiles: BUILT,
			opponents: {},
			games: 5,
			rest: REST,
			held: 'IR',
			screenHref: href,
			zone: ZONE,
			now: NOW
		}).tiles;
	for (const tiles of [listed(week()), listed(byeWeek(18.4, null))]) {
		for (const key of ['proj', 'opp', 'delta'] as const) {
			assert.deepEqual([tile(tiles, key).value, tile(tiles, key).caption], [NONE, 'On IR'], key);
		}
		assert.equal(tile(tiles, 'opp').tone, null, 'no ease is drawn for a game that is not his');
		// His season stands: Avg and Last are his.
		assert.notEqual(tile(tiles, 'avg').value, NONE);
	}
	// The bye week's change tile keeps its head (his next game's Proj), "--" with the list.
	assert.equal(tile(listed(byeWeek(18.4, null)), 'delta').label, 'Wk 7 Proj');
	// No list: the week's own figures.
	assert.equal(
		tile(card(week()).tiles, 'proj').caption,
		'published projection, read Fri Oct 16, 9:00 pm CT'
	);
	// His basis says only what the card shows: one sentence for the On IR tiles, then Avg and Last
	// (fix round 2); his game's expected score, weather and Proj are not drawn.
	const whole = liveCard({
		week: week(),
		player: RB,
		league: null,
		tiles: BUILT,
		opponents: {},
		games: 5,
		rest: REST,
		held: 'IR',
		screenHref: href,
		zone: ZONE,
		now: NOW
	});
	assert.equal(whole.basis.length, 1);
	assert.ok(whole.basis[0]?.startsWith(CARD.listedWeek), whole.basis[0]);
	assert.doesNotMatch(whole.basis.join(' '), /published projection|Opp rank is|expected points/u);
	assert.deepEqual(
		[whole.cell?.expected, whole.cell?.weather, whole.next?.proj],
		[null, null, NONE]
	);
	assert.equal(unreadBasis(false, 'Wk 6', 'IR'), CARD.listedWeek);
	assert.notEqual(unreadBasis(false, 'Wk 6', null), CARD.listedWeek);
});

void test("the page's rest caption takes the read's rank once read (Lane 128 fix round 3)", () => {
	const rb = (line: Partial<PlayerWeek['line']>) =>
		liveCard({
			week: week({}, line),
			player: RB,
			league: null,
			tiles: BUILT,
			opponents: {},
			games: 5,
			rest: { ...REST, rank: 'RB2 in our order' },
			screenHref: href,
			zone: ZONE,
			now: NOW
		}).tiles;
	// The run ranks him RB 2 (a listed back above him); the read, playing first, RB 1.
	assert.match(tile(rb({ position_rank: 1 }), 'rest').caption, /RB1 in our order$/u);
	// The read places him nowhere: the run's rank stands.
	assert.match(tile(rb({ position_rank: null }), 'rest').caption, /RB2 in our order$/u);
});

void test("the page's pill and rest caption name one rank, before the read and after (Lane 128 fix round 4)", () => {
	const RUN_RANK = 2;
	const rest = { ...REST, rank: `RB${String(RUN_RANK)} in our order` };
	const read = (line: Partial<PlayerWeek['line']>) =>
		liveCard({
			week: week({}, line),
			player: RB,
			league: null,
			tiles: BUILT,
			opponents: {},
			games: 5,
			rest,
			screenHref: href,
			zone: ZONE,
			now: NOW
		});
	// What the page passes its pill (players/[slug]/+page.svelte): the read's, else the run's.
	const pillRank = (card: ReturnType<typeof read> | null): number => card?.positionRank ?? RUN_RANK;
	const captionRank = (caption: string): number =>
		Number(/RB(\d+) in our order/u.exec(caption)?.[1]);
	// Before the read: the run's rank on both.
	assert.equal(pillRank(null), captionRank(rest.rank));
	// After it: the read's on both, and the run's where the read places him nowhere.
	for (const line of [{ position_rank: 1 }, { position_rank: null }]) {
		const card = read(line);
		assert.equal(
			pillRank(card),
			captionRank(tile(card.tiles, 'rest').caption),
			JSON.stringify(line)
		);
	}
});

// Lane 158: the week read beside the card, through the engine at fixed clocks. The read quotes 21.8,
// the week's published projection the card prints; his game kicks off Sun Oct 18, 3:05 pm Central.
const KICKED_OFF = Date.parse('2026-10-18T21:00:00.000Z');
const FINAL = Date.parse('2026-10-19T03:00:00.000Z');
const WEEK_READ: WeekRead = {
	week: 6,
	body: 'Puka Nacua gets the Cardinals at home, and the published projection has him at 21.8 points.',
	caption: 'Written Sat Oct 17, 1:12 pm CT, for week 6',
	status: null,
	call: 'start',
	writtenAt: READ,
	factsAt: READ,
	projection: 21.8,
	movedCaption: 'The published projection moved since this read was written.'
};
const shownAt = (w: PlayerWeek, now: number) =>
	shownWeekRead(WEEK_READ, card(w, null, now).projection);
const SHOWN = { withheld: false, body: WEEK_READ.body, caption: WEEK_READ.caption };

void test('before kickoff the read stands while the published projection is the one it quotes', () => {
	assert.equal(card(week(), null, NOW).projection.state, 'upcoming');
	assert.deepEqual(shownAt(week(), NOW), SHOWN);
});

// Lane 162 (D04), Lane 274: the Proj change tile reads the card figure against the read's from 0.5, and
// the read stands through any move. The read quotes 21.8.
void test('a move under the tile\'s 0.5 shows the read beside "Moved under 0.5"; 0.6, 2.0 and 6.0 print the move beside the read', () => {
	const under = week({}, { week_projection: 22.2, projection_delta: 0.4 });
	assert.equal(tile(card(under, null, NOW).tiles, 'delta').caption, WEEK_TILE.underShown);
	assert.deepEqual(shownAt(under, NOW), SHOWN);
	assert.deepEqual(
		shownAt(week({}, { week_projection: 21.4, projection_delta: -0.4 }), NOW),
		SHOWN
	);
	const past = week({}, { week_projection: 22.4, projection_delta: 0.6 });
	assert.equal(tile(card(past, null, NOW).tiles, 'delta').value, '+0.6');
	assert.deepEqual(shownAt(past, NOW), SHOWN);
	for (const points of [22.3, 23.8, 19.8, 27.8, 15.8]) {
		const shown = shownAt(week({}, { week_projection: points }), NOW);
		assert.deepEqual(shown, SHOWN, String(points));
		assert.ok(!JSON.stringify(shown).includes('not written'), String(points));
	}
});

// Lane 162 fix round 1 (D04): with a read written for the week the Proj change tile is measured from the
// figure the read quotes; with no read, from the earlier snapshot. The read quotes 21.8; the earlier snapshot says something else.
const withRead = (w: PlayerWeek, read: WeekRead | null) =>
	liveCard({ ...liveInputOf(w), read, now: NOW });
const liveInputOf = (w: PlayerWeek) => ({
	week: w,
	player: PLAYER,
	league: null,
	tiles: BUILT,
	opponents: { 5: 'vs BUF' },
	games: 3,
	rest: REST,
	screenHref: href,
	zone: ZONE
});

void test('the change tile reads the move since the read was written, at 0.4, 0.6, 2.0 and 6.0, and the read stands', () => {
	// The snapshot says 0.8 but the read's own quote is 0.4 away: the tile says under 0.5, the read shows.
	const under = week({}, { week_projection: 22.2, projection_delta: 0.8 });
	const shownCard = withRead(under, WEEK_READ);
	assert.equal(tile(shownCard.tiles, 'delta').value, NONE);
	assert.equal(tile(shownCard.tiles, 'delta').caption, WEEK_TILE.underShownRead);
	assert.deepEqual(shownWeekRead(WEEK_READ, shownCard.projection), SHOWN);
	// The snapshot says 0.3 but the quote is 0.6 away: the tile prints +0.6 and the read still shows.
	const past = week({}, { week_projection: 22.4, projection_delta: 0.3 });
	for (const [points, printed] of [
		[22.4, '+0.6'],
		[23.8, '+2.0'],
		[27.8, '+6.0']
	] as const) {
		const moved = withRead(week({}, { week_projection: points, projection_delta: 0.3 }), WEEK_READ);
		assert.equal(tile(moved.tiles, 'delta').value, printed);
		assert.equal(tile(moved.tiles, 'delta').caption, WEEK_TILE.sinceRead);
		assert.deepEqual(shownWeekRead(WEEK_READ, moved.projection), SHOWN, printed);
	}
	const pastCard = withRead(past, WEEK_READ);
	assert.equal(
		WEEK_TILE.changePartRead,
		'Proj change is its move since our read was written, shown from 0.5.'
	);
	assert.ok(pastCard.basis.join(' ').includes(WEEK_TILE.changePartRead));
	// With no read the tile keeps the earlier snapshot, and says so.
	const none = withRead(week({}, { week_projection: 22.4, projection_delta: 0.4 }), null);
	assert.equal(tile(none.tiles, 'delta').caption, WEEK_TILE.underShown);
	assert.equal(withRead(past, null).tiles.find((t) => t.key === 'delta')?.value, NONE);
	assert.equal(
		tile(withRead(week({}, { week_projection: 22.4, projection_delta: 0.6 }), null).tiles, 'delta')
			.value,
		'+0.6'
	);
});

void test('once his game has kicked off the read stands whatever the card now prints', () => {
	const live = week({}, { week_projection: 23.4, facts: facts({ points_this_week: 4.6 }) });
	assert.equal(card(live, null, KICKED_OFF).projection.state, 'kicked_off');
	assert.deepEqual(shownAt(live, KICKED_OFF), SHOWN);
});

void test('once his game is final the read stands', () => {
	const final = week(
		{},
		{
			week_projection: 23.4,
			facts: facts({ played: true, game_state: 'final', points_this_week: 18.2 })
		}
	);
	assert.equal(card(final, null, FINAL).projection.state, 'final');
	assert.deepEqual(shownAt(final, FINAL), SHOWN);
});

void test('with no read at all the place says it is not written, "next" only for a game to come', () => {
	assert.equal(noReadWords(card(week(), null, NOW).projection.state, null, NOW), CARD.readNotYet);
	for (const now of [KICKED_OFF, FINAL]) {
		const words = noReadWords(card(week(), null, now).projection.state, null, now);
		assert.equal(words, CARD.readNotWritten);
		assert.ok(!/\bnext\b/u.test(words), words);
	}
	for (const words of [CARD.readNotYet, CARD.readNotWritten, CARD.readsDue(8, 'Tuesday')])
		assert.equal(BANNED.exec(words), null, words);
});

// Lane 160 (B140): a read the run withheld for a status change, through the engine on a fixed Sunday
// clock. Before kickoff its due time stands; from kickoff through final the due time has passed and the
// place says no read was written for this game.
void test('a status-withheld read keeps its due time before kickoff, says not written from kickoff through final', () => {
	const due =
		'His status changed since this read was written. A new read is due by Sat Oct 17, 9:00 am CT.';
	const withheld: WeekRead = {
		...WEEK_READ,
		body: null,
		caption: due,
		status: 'Questionable',
		call: null
	};
	const at = (w: PlayerWeek, now: number) => shownWeekRead(withheld, card(w, null, now).projection);
	assert.deepEqual(at(week(), NOW), { withheld: true, words: due });
	const live = week({}, { facts: facts({ points_this_week: 4.6 }) });
	assert.equal(card(live, null, KICKED_OFF).projection.state, 'kicked_off');
	assert.deepEqual(at(live, KICKED_OFF), { withheld: true, words: CARD.readNotWritten });
	const final = week(
		{},
		{ facts: facts({ played: true, game_state: 'final', points_this_week: 18.2 }) }
	);
	assert.equal(card(final, null, FINAL).projection.state, 'final');
	assert.deepEqual(at(final, FINAL), { withheld: true, words: CARD.readNotWritten });
	assert.ok(!JSON.stringify(at(final, FINAL)).includes('due by'));
});

/** Lane 162 (D02, D03): Friday morning of week 7, his Thursday game played. His head reads the line's
 * rank (QB 21) and the box reads each player's rank from the same answer, so the two never differ; his
 * figure counts weeks 8 to 17, which the box's basis names, and the players whose games are still to come
 * say their own weeks. */
const THURSDAY_TIER: NonNullable<PlayerWeek['tier']> = {
	format: 'ppr',
	mates: [
		{ board_id: 'kirk-cousins', points: 138.1, position_rank: 15, from_week: 7 },
		{ board_id: PLAYER.id, points: 123.1, position_rank: 21, from_week: 8 },
		{ board_id: 'justin-herbert', points: 133.1, position_rank: 16, from_week: 7 }
	],
	drop: 24.4,
	from_week: 7,
	partial: true
};

void test('the card head and the tier box read one rank, and the box names his weeks (Lane 162, D02, D03)', () => {
	const live = liveCard({
		week: week(
			{ rest_of_season: [...RUN_FORMATS_LIVE], rest_from_week: 8, tier: THURSDAY_TIER },
			{ position_rank: 21 }
		),
		player: PLAYER,
		league: null,
		tiles: BUILT,
		opponents: {},
		games: 3,
		rest: REST,
		tier: TIER_ASK,
		screenHref: href,
		zone: ZONE,
		now: NOW
	});
	assert.ok(live.tier?.ranks && live.tier.spans);
	assert.equal(live.positionRank, 21);
	assert.equal(live.tier.ranks[PLAYER.id], live.positionRank);
	assert.equal(tile(live.tiles, 'rest').caption.endsWith(`WR21 in our order`), true);
	assert.equal(live.tier.basis, 'Projected PPR points for the rest of 2026, weeks 8 to 17');
	assert.deepEqual(live.tier.spans, {
		'kirk-cousins': 'weeks 7 to 17',
		[PLAYER.id]: null,
		'justin-herbert': 'weeks 7 to 17'
	});
	// A player on a season-long list: no rank in the head, none in the box.
	const listed = liveCard({
		week: week(
			{
				rest_of_season: [...RUN_FORMATS_LIVE],
				rest_from_week: 8,
				tier: {
					...THURSDAY_TIER,
					mates: THURSDAY_TIER.mates.map((m) =>
						m.board_id === PLAYER.id ? { ...m, position_rank: null } : m
					)
				}
			},
			{ position_rank: null }
		),
		player: PLAYER,
		league: null,
		tiles: BUILT,
		opponents: {},
		games: 3,
		rest: REST,
		tier: TIER_ASK,
		screenHref: href,
		zone: ZONE,
		now: NOW
	});
	assert.equal(listed.positionRank, null);
	assert.equal(listed.tier?.ranks?.[PLAYER.id], null);
});

// Lane 165 (D10): a read that stands never quotes a figure the Proj tile does not show.
void test('a standing read quoting another figure than the Wk tile shows is named in the tile caption', () => {
	const moved = week({}, { week_projection: 23.4, facts: facts({ points_this_week: 4.6 }) });
	const live = liveCard({ ...liveInputOf(moved), read: WEEK_READ, now: KICKED_OFF });
	assert.ok(tile(live.tiles, 'proj').caption.endsWith('. Proj at the read 21.8'));
	// The tile showing the quoted figure says nothing more.
	const same = liveCard({ ...liveInputOf(week()), read: WEEK_READ, now: KICKED_OFF });
	assert.ok(!tile(same.tiles, 'proj').caption.includes('at the read'));
	// Before kickoff the read stands through any move (Lane 274), so the tile names the read's own figure
	// beside the change it prints.
	for (const [points, printed] of [
		[23.4, '+1.6'],
		[23.8, '+2.0'],
		[27.8, '+6.0']
	] as const) {
		const ahead = liveCard({
			...liveInputOf(week({}, { week_projection: points })),
			read: WEEK_READ,
			now: NOW
		});
		assert.ok(tile(ahead.tiles, 'proj').caption.endsWith('Proj at the read 21.8'), printed);
		assert.equal(tile(ahead.tiles, 'delta').value, printed);
	}
	// Under the threshold the read shows beside a tile that prints another tenth: the tile names the quote.
	const under = week({}, { week_projection: 22.2 });
	const near = liveCard({ ...liveInputOf(under), read: WEEK_READ, now: NOW });
	assert.ok(tile(near.tiles, 'proj').caption.endsWith('Proj at the read 21.8'));
	// A read that quoted none leaves the caption alone.
	const quiet = liveCard({
		...liveInputOf(moved),
		read: { ...WEEK_READ, projection: null },
		now: KICKED_OFF
	});
	assert.ok(!tile(quiet.tiles, 'proj').caption.includes('at the read'));
});

void test('"Proj at the read" is never shown for a read the run withheld (fix round 1, M2)', () => {
	const moved = week({}, { week_projection: 23.8, facts: facts({ points_this_week: 4.6 }) });
	const caption = (read: WeekRead, now: number) =>
		tile(liveCard({ ...liveInputOf(moved), read, now }).tiles, 'proj').caption;
	// The run withheld the read (a status change): the page shows its caption, the tile adds nothing.
	for (const now of [NOW, KICKED_OFF])
		assert.ok(!caption({ ...WEEK_READ, body: null }, now).includes('at the read'));
	// A standing read moved from, before kickoff, a read from before the moved caption alike.
	assert.ok(caption(WEEK_READ, NOW).endsWith('Proj at the read 21.8'));
	assert.ok(
		caption({ ...WEEK_READ, movedCaption: undefined }, NOW).endsWith('Proj at the read 21.8')
	);
	assert.deepEqual(shownWeekRead({ ...WEEK_READ, body: null }, card(moved, null, NOW).projection), {
		withheld: true,
		words: WEEK_READ.caption
	});
});

// MARK: the live read (Lane 284, B277)

/** The hourly pass's rewrite after his status changed, written Saturday 10:00 am Central. */
const REWRITTEN_AT = '2026-10-17T15:00:00.000Z';
const LIVE_READ: NonNullable<PlayerWeek['weekRead']> = {
	week: 6,
	body: 'Puka Nacua is questionable and gets the Cardinals at home. Start him if he is active.',
	caption: 'Written Sat Oct 17, 10:00 am CT, for week 6',
	status: 'questionable',
	call: 'start',
	writtenAt: REWRITTEN_AT,
	factsAt: '2026-10-17T14:40:00.000Z',
	projection: 19.4,
	source: 'llm'
};
/** The capture the 9:45 am build read: questionable since 9:30, after the night's read. */
const CAPTURE: Designations = {
	readAt: '2026-10-17T14:30:00.000Z',
	checkedAt: '2026-10-17T14:30:00.000Z',
	source: 'tank01_injuries_by_date',
	players: { [PLAYER.id]: { status: 'questionable', seasonLong: false, since: null } }
};
const BUILT_STATUS = { capture: CAPTURE, listed: CAPTURE.players[PLAYER.id] };
const BUILD_AT = Date.parse('2026-10-17T14:45:00.000Z');

void test('a status rewrite landed at 10:00 shows at 10:01 with the live read, the run caption replaced', () => {
	// The 9:45 build served the night's read under the status caption, the rewrite due by 10:00.
	const served = readAtStatus(WEEK_READ, CAPTURE, PLAYER.id, BUILD_AT);
	assert.ok(isStatusCaption(served.caption), served.caption);
	assert.ok(served.caption.endsWith('Sat Oct 17, 10:00 am CT.'), served.caption);
	const at = Date.parse('2026-10-17T15:01:00.000Z');
	const live = liveCard({
		...liveInputOf(week({ weekRead: LIVE_READ })),
		read: served,
		built: BUILT_STATUS,
		now: at
	});
	assert.deepEqual(shownWeekRead(nonNull(live.read), live.projection), {
		withheld: false,
		body: LIVE_READ.body,
		caption: LIVE_READ.caption
	});
	// The answer before the field, or with no read stored: the run's read and caption stand.
	const before = liveCard({ ...liveInputOf(week()), read: served, built: BUILT_STATUS, now: at });
	assert.equal(before.read, served);
});

void test('the Proj change tile keeps the figure of the read that is shown (Lane 284 ruling 3)', () => {
	const moved = week({ weekRead: LIVE_READ }, { week_projection: 21.8 });
	const live = liveCard({ ...liveInputOf(moved), read: WEEK_READ, now: NOW });
	const asRun = liveCard({
		...liveInputOf(week({}, { week_projection: 21.8 })),
		read: LIVE_READ,
		now: NOW
	});
	assert.deepEqual(live.tiles, asRun.tiles);
	assert.ok(tile(live.tiles, 'proj').caption.endsWith('Proj at the read 19.4'));
	// A live read older than the run's leaves the run's figure on the tiles.
	const older = { ...LIVE_READ, writtenAt: BEFORE };
	const run = liveCard({ ...liveInputOf(week({ weekRead: older })), read: WEEK_READ, now: NOW });
	assert.equal(run.read, WEEK_READ);
	assert.ok(!tile(run.tiles, 'proj').caption.includes('at the read'));
});

void test('the newer read is shown: live newer, run newer, live absent, live failed', () => {
	assert.equal(newestWeekRead(WEEK_READ, LIVE_READ, null), LIVE_READ, 'live newer');
	const older = { ...LIVE_READ, writtenAt: BEFORE };
	assert.equal(newestWeekRead(WEEK_READ, older, null), WEEK_READ, 'run newer');
	const same = { ...LIVE_READ, writtenAt: WEEK_READ.writtenAt };
	assert.equal(newestWeekRead(WEEK_READ, same, null), WEEK_READ, 'the same write: the run');
	// A failed live read answers without the field, as an answer with none stored does.
	assert.equal(newestWeekRead(WEEK_READ, undefined, null), WEEK_READ, 'live absent');
	assert.equal(newestWeekRead(null, undefined, null), null);
	assert.equal(newestWeekRead(null, LIVE_READ, null), LIVE_READ, 'no run read');
});

void test('a live read his status moved past on the build capture keeps its body under the status caption', () => {
	// The capture read after the rewrite lists him out: the build's caption over the run's read, said
	// over the live one.
	const later: Designations = {
		...CAPTURE,
		readAt: '2026-10-17T16:30:00.000Z',
		checkedAt: '2026-10-17T16:30:00.000Z',
		players: { [PLAYER.id]: { status: 'out', seasonLong: false, since: null } }
	};
	const built = { capture: later, listed: later.players[PLAYER.id] };
	const served = readAtStatus(WEEK_READ, later, PLAYER.id, Date.parse('2026-10-17T16:45:00.000Z'));
	const shown = nonNull(newestWeekRead(served, LIVE_READ, built));
	assert.equal(shown.body, LIVE_READ.body);
	assert.equal(shown.caption, served.caption);
	// With a run caption that is not the status one, the lead alone.
	assert.equal(newestWeekRead(WEEK_READ, LIVE_READ, built)?.caption, STATUS_HELD_WORDS.changedLead);
	// His status unchanged since the rewrite: the live caption.
	assert.equal(newestWeekRead(served, LIVE_READ, BUILT_STATUS)?.caption, LIVE_READ.caption);
});

function nonNull<T>(value: T | null): T {
	assert.ok(value !== null);
	return value;
}
