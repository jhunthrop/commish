// The Waivers screen's table, strip and drop panel words (Lane 66f): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlayerLine, WaiverRow, WeekFacts } from '../inseason/api.ts';
import {
	BEATS_BASIS,
	cardGains,
	clearsWords,
	copiedWords,
	countWords,
	DEFAULT_SORT,
	dropLead,
	dropRows,
	dropTitle,
	findRows,
	moveWords,
	nextSort,
	openWaiversWords,
	addOnWords,
	pickupCards,
	pickupsTitle,
	pickupSum,
	poolRows,
	sameWeekGain,
	shortName,
	sortRows,
	stripDecision,
	WAIVERS,
	withDrop
} from './waivers.ts';

const ZONE = 'America/Chicago';

const facts = (over: Partial<WeekFacts> = {}): WeekFacts => ({
	week: 6,
	opponent: 'PIT',
	home: true,
	kickoff: '2026-10-18T17:00:00.000Z',
	bye: false,
	designation: null,
	played: false,
	points_this_week: null,
	last_games: [],
	allowed_to_position: null,
	game_total: null,
	spread: null,
	roof: null,
	weather: null,
	...over
});

const line = (
	name: string,
	position: string,
	proj: number | null,
	rest: number | null = null,
	over: Partial<WeekFacts> = {}
): PlayerLine => ({
	player: { host_id: name, board_id: name, name, position, team: 'TB', injured_reserve: false },
	headshot: null,
	slug: null,
	position_rank: null,
	points_over_replacement: null,
	rest_of_season_per_game: rest,
	week_projection: proj,
	projection_delta: null,
	opp_rank: null,
	season_avg: null,
	last_points: null,
	held: false,
	facts: facts(over)
});

const lemon = line('Makai Lemon', 'WR', 6.9, 6.2);
const vidal = line('Kimani Vidal', 'RB', 2.8, 6.4);
const saints = line('Saints D/ST', 'DEF', 6.9, 6.1);

const row = (add: PlayerLine, over: Partial<WaiverRow> = {}): WaiverRow => ({
	add,
	drop: lemon,
	gain: 1.2,
	week_gain: 6.7,
	starts: true,
	pickup: true,
	beats: { host_id: vidal.player.host_id, name: vidal.player.name, starter: true, gain: 6.7 },
	drops: [
		{ host_id: lemon.player.host_id, gain: 1.2, week_gain: 6.7 },
		{ host_id: vidal.player.host_id, gain: 0.6, week_gain: 6.7 }
	],
	clears: null,
	sentence: '',
	...over
});

const gainwell = row(line('Kenny Gainwell', 'RB', 9.48, 8.4));
const chiefs = row(line('Chiefs D/ST', 'DEF', 9.6, 7), {
	drop: saints,
	gain: 0.3,
	week_gain: 2.7,
	beats: { host_id: saints.player.host_id, name: saints.player.name, starter: true, gain: 2.7 },
	drops: [{ host_id: saints.player.host_id, gain: 0.3, week_gain: 2.7 }]
});
const mevis = row(line('Harrison Mevis', 'K', 6.7, 7.6), {
	gain: -0.3,
	week_gain: 0.2,
	pickup: false,
	beats: { host_id: 'Fairbairn', name: "Ka'imi Fairbairn", starter: true, gain: 0.2 }
});
const jones = row(line('Daniel Jones', 'QB', 17.86, 11.8), {
	week_gain: 0,
	starts: false,
	pickup: false,
	beats: { host_id: 'Stroud', name: 'C.J. Stroud', starter: false, gain: 1.1 }
});
const allen = row(line('Kaytron Allen', 'RB', null, 9.6, { bye: true, opponent: null }), {
	week_gain: 0,
	starts: false,
	pickup: false,
	beats: null,
	clears: '2026-10-21'
});
const advice = {
	rows: [jones, gainwell, mevis, allen, chiefs],
	pickups: [gainwell, chiefs]
};

void test('the strip names each pickup as a card: the move, both gains, the sum on the Lineup', () => {
	const cards = pickupCards(advice);
	assert.deepEqual(cards.map(moveWords), ['Add Gainwell, drop Lemon', 'Add Chiefs, drop Saints']);
	assert.equal(
		cardGains(cards[0] ?? { weekGain: 0, gain: 0 }),
		'+6.7 Proj this week, +1.2 a week rest of season'
	);
	assert.equal(cards[1]?.slot, 'D/ST');
	assert.equal(pickupsTitle(2), 'Two pickups');
	assert.equal(pickupsTitle(1), 'One pickup');
	assert.equal(pickupsTitle(0), WAIVERS.noPickup);
	assert.deepEqual(pickupSum(87, cards), {
		figure: '96.4',
		words: 'Proj with both, 87.0 without',
		gain: '+9.4'
	});
	assert.equal(pickupSum(87, cards.slice(0, 1))?.words, 'Proj with him, 87.0 without');
	assert.equal(pickupSum(null, cards), null);
	assert.equal(pickupSum(87, []), null);
	assert.equal(
		stripDecision(cards),
		'Two pickups. Add Gainwell, drop Lemon. Add Chiefs, drop Saints.'
	);
	assert.equal(moveWords({ add: 'Gainwell', drop: null }), 'Add Gainwell');
	assert.equal(shortName('Chiefs D/ST'), 'Chiefs');
});

void test('the table tints only what the strip names: a starter he tops off the strip is not tinted', () => {
	const rows = poolRows(advice, ZONE);
	const tinted = rows.filter((r) => r.named).map((r) => r.row.name);
	assert.deepEqual(tinted, ['Kenny Gainwell', 'Chiefs D/ST']);
	const kicker = rows.find((r) => r.row.name === 'Harrison Mevis');
	assert.equal(kicker?.named, false);
	assert.ok(kicker.beats);
	assert.equal(kicker.beats.starter, true);
	assert.equal(rows.find((r) => r.row.name === 'Daniel Jones')?.beats?.name, 'Stroud');
	assert.equal(rows.find((r) => r.row.name === 'Kaytron Allen')?.clears, 'Clears Wed');
	assert.equal(rows[0]?.rest, 11.8);
});

void test('the default sort is Beats: a starter topped first by the gain, then the bench, no one last', () => {
	const rows = sortRows(poolRows(advice, ZONE), DEFAULT_SORT);
	assert.deepEqual(
		rows.map((r) => r.row.name),
		['Kenny Gainwell', 'Chiefs D/ST', 'Harrison Mevis', 'Daniel Jones', 'Kaytron Allen']
	);
	const byProj = sortRows(poolRows(advice, ZONE), { key: 'proj', down: true });
	assert.equal(byProj[0]?.row.name, 'Daniel Jones');
	assert.equal(byProj.at(-1)?.row.name, 'Kaytron Allen');
	const upProj = sortRows(poolRows(advice, ZONE), { key: 'proj', down: false });
	// Not held stays last whichever way.
	assert.equal(upProj.at(-1)?.row.name, 'Kaytron Allen');
	assert.deepEqual(nextSort(DEFAULT_SORT, 'beats'), { key: 'beats', down: false });
	assert.deepEqual(nextSort(DEFAULT_SORT, 'name'), { key: 'name', down: false });
	assert.deepEqual(nextSort(DEFAULT_SORT, 'rest'), { key: 'rest', down: true });
	const byName = sortRows(poolRows(advice, ZONE), { key: 'name', down: false });
	assert.equal(byName[0]?.row.name, 'Chiefs D/ST');
});

void test('the search keeps the names that hold it, any case', () => {
	const rows = poolRows(advice, ZONE);
	assert.deepEqual(
		findRows(rows, 'gAIN').map((r) => r.row.name),
		['Kenny Gainwell']
	);
	assert.equal(findRows(rows, '  ').length, rows.length);
	assert.equal(findRows(rows, 'zzz').length, 0);
});

void test("the drop panel lists the roster's players he could replace, the advice's drop first", () => {
	const drops = dropRows(gainwell, [vidal, lemon, saints], ZONE);
	assert.deepEqual(
		drops.map((d) => d.row.name),
		['Makai Lemon', 'Kimani Vidal']
	);
	assert.equal(sameWeekGain(drops), 6.7);
	assert.equal(
		dropLead(6.7),
		'+6.7 Proj this week with any of them. The one you lose least by comes first.'
	);
	assert.equal(dropLead(null), 'The one you lose least by comes first.');
	assert.equal(sameWeekGain([{ weekGain: 1 }, { weekGain: 2 }]), null);
	assert.equal(dropTitle('Kenny Gainwell'), 'Drop one for Kenny Gainwell');
	const chosen = withDrop(gainwell, drops[1] ?? null);
	assert.equal(chosen.drop?.player.name, 'Kimani Vidal');
	assert.equal(chosen.gain, 0.6);
	assert.equal(withDrop(gainwell, null), gainwell);
});

void test("the verbs name the member's platform, and the copy says where he goes", () => {
	assert.equal(openWaiversWords('espn'), 'Open ESPN waivers');
	assert.equal(addOnWords('espn'), 'Add on ESPN');
	assert.deepEqual(copiedWords('espn', 'Gainwell', true), {
		said: 'Copied Gainwell. Add him on',
		page: "ESPN's waiver page"
	});
	assert.equal(copiedWords('sleeper', 'Gainwell', false).page, "Sleeper's waiver page");
	assert.equal(countWords(60, 'espn'), '60 free agents on ESPN');
	assert.equal(countWords(1, 'espn'), '1 free agent on ESPN');
	assert.equal(clearsWords(null), null);
	assert.equal(clearsWords('not a day'), null);
});

void test('copy guard: every Waivers line is fantasy words, with no dash, semicolon or the word host', () => {
	const cards = pickupCards(advice);
	const lines = [
		...Object.values(WAIVERS),
		BEATS_BASIS,
		stripDecision(cards),
		...cards.map(cardGains),
		dropLead(6.7),
		openWaiversWords('espn'),
		addOnWords('yahoo'),
		copiedWords('espn', 'Gainwell', true).said,
		copiedWords('espn', 'Gainwell', false).said,
		countWords(60, 'espn')
	];
	const forbidden =
		/\b(odds|line|spread|favou?red|underdog|bet|market|buy|sell|price|host|tip)\b|—|–|;/i;
	for (const said of lines) assert.doesNotMatch(said, forbidden, said);
});

void test('an add who fills a spot no one of yours can play beats the open spot by his week gain', () => {
	const taylor = row(line('Mason Taylor', 'TE', 4.77, 5.3), { beats: null, week_gain: 4.8 });
	const [only] = poolRows({ rows: [taylor], pickups: [taylor] }, ZONE);
	assert.deepEqual(only?.beats, { name: 'Open spot', starter: true, gain: 4.8 });
	const benched = row(line('Theo Johnson', 'TE', 4.1), {
		beats: null,
		starts: false,
		week_gain: 0
	});
	assert.equal(poolRows({ rows: [benched], pickups: [] }, ZONE)[0]?.beats, null);
});
