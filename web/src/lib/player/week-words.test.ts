// The player card's week in words (Lane 66h): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import { KICKED_OFF_PART } from '../league/box/basis.ts';
import type { WeekFacts } from '../league/inseason/api.ts';
import { CARD, NONE, printTenth, unreadBasis, type CardTile } from './card.ts';
import {
	compareSay,
	liveCard,
	oppCaption,
	verbOf,
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
const REST = { fromWeek: 6, rank: 'WR1 in our order', scoring: 'ppr' as const, label: 'PPR' };

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
	// A read with no state (review finding 5) says no state: the evidence line ends there.
	assert.match(after, /PPR scoring\.$/);
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
		CARD.whyTitle,
		CARD.writtenFrom,
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
