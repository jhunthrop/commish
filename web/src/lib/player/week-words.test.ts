// The player card's week in words (Lane 66h): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WeekFacts } from '../league/inseason/api.ts';
import { CARD, NONE, unreadBasis, type CardTile } from './card.ts';
import { liveCard, oppCaption, verbOf, type PlayerWeek, type ScreenHref } from './week-words.ts';

const ZONE = 'America/Chicago';
const READ = '2026-10-17T02:00:00.000Z';
const BEFORE = '2026-10-16T02:00:00.000Z';
const PLAYER = { id: '4426515', name: 'Puka Nacua', team: 'LAR', position: 'WR' };
const LEAGUE = { id: 'league-1', host: 'sleeper' as const };
const href: ScreenHref = (screen, player) => `/league/league-1/${screen}?player=${player}`;

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
		week_projection: 21.84,
		projection_delta: 0.4,
		opp_rank: 26,
		season_avg: 25.93,
		last_points: 37.7,
		held: false,
		facts: facts(),
		...line
	},
	...over
});

const BUILT: CardTile[] = [
	{ key: 'proj', label: CARD.proj, value: NONE, caption: 'Week 6', tone: 'lead' },
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

const card = (w: PlayerWeek, league: typeof LEAGUE | null = null) =>
	liveCard({
		week: w,
		player: PLAYER,
		league,
		tiles: BUILT,
		opponents: { 5: 'vs BUF' },
		games: 3,
		screenHref: href,
		zone: ZONE
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
	assert.equal(tile(tiles, 'proj').caption, 'Week 6, PPR');
	assert.equal(tile(tiles, 'opp').caption, 'ARI, among the easiest for receivers');
	assert.equal(tile(tiles, 'opp').tone, 'easy');
	assert.equal(tile(tiles, 'last').caption, 'week 5 vs BUF');
	assert.equal(tile(tiles, 'delta').caption, 'since Thu 9:00 pm');
});

void test("the opponent's rank says its direction in words", () => {
	assert.equal(oppCaption('NO', 3, 32, 'QB'), 'NO, among the toughest for quarterbacks');
	assert.equal(oppCaption('GB', 15, 32, 'WR'), 'GB, in the middle for receivers');
	assert.equal(oppCaption('ARI', 26, 32, 'TE'), 'ARI, among the easiest for tight ends');
});

void test('a figure not held is "--", and the basis says why in one clause', () => {
	const { tiles, basis } = card(
		week(
			{ projection_previous_read_at: null },
			{ week_projection: null, projection_delta: null, opp_rank: null }
		)
	);
	assert.equal(tile(tiles, 'proj').value, NONE);
	assert.equal(tile(tiles, 'opp').value, NONE);
	assert.equal(tile(tiles, 'delta').value, NONE);
	assert.ok(
		basis.some((line) => line.includes("until this week's projection has been read twice"))
	);
	assert.ok(basis.some((line) => line.includes('until the season ranks his opponent')));
	assert.match(unreadBasis(true), /could not be read just now/);
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
			{ opp_rank: null, facts: facts({ bye: true, opponent: null, home: null, kickoff: null }) }
		)
	);
	assert.equal(bye.next, null);
	assert.equal(tile(bye.tiles, 'opp').caption, 'Bye');
});

void test('with no league the basis names PPR and no league, and there is no verb', () => {
	const { verb, basis } = card(
		week({ verb: { kind: 'trade', holder: 'Nacua Matata', host_url: null, note: null } })
	);
	assert.equal(verb, null);
	assert.ok(
		basis[0]?.startsWith(
			"Proj is this week's published projection in PPR scoring, read Fri 9:00 pm Central."
		)
	);
	assert.ok(basis.every((line) => !line.includes('league')));
});

void test("with a league the verb is the league screens', the platform named", () => {
	const at = (kind: NonNullable<PlayerWeek['verb']>['kind'], host_url: string | null = null) =>
		verbOf({ kind, holder: null, host_url, note: null }, LEAGUE, PLAYER.id, href);
	assert.deepEqual(at('start'), {
		kind: 'start',
		label: 'Start him',
		href: '/league/league-1/start?player=4426515',
		external: false,
		note: null
	});
	assert.equal(at('lineup').label, 'Open your lineup');
	assert.equal(at('trade').href, '/league/league-1/trades?player=4426515');
	assert.equal(at('claim').label, 'Add on Sleeper');
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
	assert.match(basis[0] ?? '', /the closest match to this league's rules/);
	assert.match(basis[2] ?? '', /in this league's scoring/);
});

const BANNED =
	/\b(favou?red|underdogs?|odds|lines?|spreads?|bets?|betting|market|buy|sell|price|host|tip)\b|—|;/i;

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
		CARD.why,
		CARD.whyTitle,
		CARD.writtenFrom,
		unreadBasis(false),
		unreadBasis(true)
	];
	for (const line of said) assert.doesNotMatch(line, BANNED, line);
});
