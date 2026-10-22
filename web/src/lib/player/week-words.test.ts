// The player card's week in words (Lane 66h): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import { KICKED_OFF_PART } from '../league/box/basis.ts';
import type { WeekFacts } from '../league/inseason/api.ts';
import {
	CARD,
	NONE,
	printTenth,
	publishedOn,
	unreadBasis,
	vsAvgReason,
	vsAvgCaption,
	compareLeadsWithoutVerb,
	type BasisTile,
	type CardTile
} from './card.ts';
import {
	compareSay,
	liveCard,
	oppCaption,
	verbOf,
	verbFits,
	heldVerb,
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
		caption: 'from week 6, WR1 in our order',
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
			['delta', '+0.4']
		]
	);
	// Beside the season's Projected the week's projection is headed by the API's week (the ruling).
	assert.equal(tile(tiles, 'proj').label, 'Wk 6');
	assert.equal(tile(tiles, 'proj').caption, 'PPR');
	assert.equal(tile(tiles, 'opp').caption, 'ARI, among the easiest for receivers');
	assert.equal(tile(tiles, 'opp').tone, 'easy');
	assert.equal(tile(tiles, 'last').caption, 'week 5 vs BUF');
	assert.equal(tile(tiles, 'delta').caption, 'since Thu 9:00 pm');
	assert.equal(tile(tiles, 'rest').caption, 'from week 6, WR1 in our order');
});

void test("rest of season's figure a game is the API's, one source with the league's rows", () => {
	const { tiles } = card(week({}, { rest_of_season_per_game: 23.1 }));
	assert.equal(tile(tiles, 'rest').caption, 'from week 6, 23.1 a game, WR1 in our order');
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
	assert.equal(tile(half.tiles, 'rest').caption, 'from week 6, WR1 in our order, in PPR scoring');
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
const TIER_ASK = { label: 'PPR', season: 2026, single: false };

void test("on Sunday evening the read's rest of season replaces the run's: his game is played, so he counts from week 7 (Lane 86)", () => {
	const live = card(
		week(
			{ rest_of_season: [...RUN_FORMATS_LIVE], rest_from_week: 7 },
			{ rest_of_season_per_game: 16.8 }
		)
	);
	assert.equal(tile(live.tiles, 'rest').value, '167.5');
	assert.equal(tile(live.tiles, 'rest').caption, 'from week 7, 16.8 a game, WR1 in our order');
	assert.deepEqual(live.rest, { points: 167.5, from: 'from week 7' });
	// A read older than the fields keeps the run's figure and the run's week.
	const older = card(week());
	assert.equal(older.rest, null);
	assert.equal(tile(older.tiles, 'rest').caption, 'from week 6, WR1 in our order');
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
	assert.equal(tile(half.tiles, 'rest').caption, 'from week 7, WR1 in our order, in PPR scoring');
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
		'from week 6, WR1 in our order, in PPR scoring'
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
	assert.equal(
		live.tier.basis,
		"Projected PPR points for the rest of 2026 from week 6's games left"
	);
	// Review M3: with only him in the box, the basis words his own week, as his tile does.
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
		tier: { ...TIER_ASK, single: true },
		screenHref: href,
		zone: ZONE,
		now: NOW
	});
	assert.equal(alone.tier?.basis, 'Projected PPR points for the rest of 2026 from week 7');
	assert.equal(card(week()).formats, null);
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
	assert.deepEqual(cell, {
		where: 'vs ARI',
		when: 'Sun 3:05 pm',
		expected: '32.5 to 20',
		weather: { glyph: 'indoors', words: 'Indoors' }
	});
	assert.equal(next?.proj, '21.8');
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
	assert.equal(
		basis[0],
		"Proj is this week's published projection in PPR, read Fri 9:00 pm Central. Δ Proj is its change since Thu 9:00 pm Central."
	);
	assert.match(
		basis[1] ?? '',
		/PPR scoring\. His next game's expected points and weather were read Fri 9:00 pm Central\.$/
	);
	assert.equal(basis.length, 2);
	assert.ok(basis.every((line) => !line.includes('league') && !line.includes('your')));
});

void test("the game facts' read is said only while his game is still to be played", () => {
	const kickoff = Date.parse(facts().kickoff ?? '');
	const before = card(week(), null, kickoff - 1).basis[1] ?? '';
	const after = card(week(), null, kickoff).basis[1] ?? '';
	assert.match(before, /weather were read Fri 9:00 pm Central\.$/);
	assert.ok(!after.includes('were read'), after);
	// At his kickoff the one rule reads his game kicked off (kickoff.ts lineState, Lane 85 fix round 2),
	// so the card says when Final and the stats land, as the boards and the league screens do.
	assert.ok(after.endsWith(KICKED_OFF_PART), after);
});

void test('the card draws no move on a locked row: Start him becomes the way to the lineup (M-D)', () => {
	const kickoff = Date.parse(facts().kickoff ?? '');
	const start = { kind: 'start' as const, holder: null, host_url: null, note: null };
	assert.equal(heldVerb(start, facts(), kickoff - 1).kind, 'start');
	assert.equal(heldVerb(start, facts(), kickoff).kind, 'lineup');
	const trade = { ...start, kind: 'trade' as const };
	assert.equal(heldVerb(trade, facts(), kickoff).kind, 'trade');
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
	assert.match(basis[0] ?? '', /, PPR nearest your rules, /);
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

void test('vs Avg is his rest of season a game less his Avg, from the two printed tenths (Lane 100, B51)', () => {
	const built: BasisTile[] = [
		{
			key: 'preseason',
			label: CARD.preseason,
			value: '262.1',
			caption: 'PPR points for 2026, the full season',
			reason: null
		},
		{
			key: 'vsAvg',
			label: CARD.vsAvg,
			value: NONE,
			caption: CARD.vsAvgCaption,
			reason: vsAvgReason(5)
		}
	];
	const at = (perGame: number | null, format: 'ppr' | 'half_ppr' = 'ppr') =>
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
			basisTiles: built
		}).basisTiles;
	const filled = at(22.0);
	assert.equal(filled.find((t) => t.key === 'vsAvg')?.value, '\u22128.7');
	assert.equal(
		filled.find((t) => t.key === 'vsAvg')?.caption,
		'22.0 a game vs his 30.7 Avg: 5 games weighed with his preseason pace'
	);
	// "--" stands with the plain caption: no reason beside a figure not drawn (fix round 1, M4).
	assert.equal(at(null).find((t) => t.key === 'vsAvg')?.caption, CARD.vsAvgCaption);
	assert.equal(filled.find((t) => t.key === 'preseason')?.value, '262.1');
	assert.equal(at(null).find((t) => t.key === 'vsAvg')?.value, NONE);
	// In another scoring than the tile's the figure a game is not the tile's: no gap is drawn.
	assert.equal(at(22.0, 'half_ppr').find((t) => t.key === 'vsAvg')?.value, NONE);
});

void test('vs Avg names both figures and the preseason pace, as its tile beside it does (Lane 117)', () => {
	// Its four phone lines are the shot script's to count (player-bye-shots.ts), never a character proxy.
	const caption = vsAvgCaption('22.0', '30.7', vsAvgReason(5));
	assert.equal(caption, '22.0 a game vs his 30.7 Avg: 5 games weighed with his preseason pace');
	assert.match(caption, new RegExp(CARD.preseasonPace.toLowerCase()));
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
		CARD.whyRest,
		CARD.readNotYet,
		CARD.preseason,
		CARD.preseasonPace,
		CARD.vsAvg,
		CARD.paceCaption,
		CARD.vsAvgCaption,
		vsAvgReason(5),
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
	assert.equal(tile(card(week()).tiles, 'proj').caption, 'PPR');
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
