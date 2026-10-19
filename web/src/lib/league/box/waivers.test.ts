// The Waivers screen's table, strip and drop panel words (Lane 66f): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { PlayerLine, WaiverRow, WeekFacts } from '../inseason/api.ts';
import { basisText } from './basis.ts';
import {
	cardGains,
	cardName,
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
	waiverBasis,
	withDrop
} from './waivers.ts';

const ZONE = 'America/Chicago';
/** When the game facts were read, and the clock every basis here is drawn at: the read's own time,
 * before the fixture's kickoff. Never the real clock. */
const FACTS_READ = '2026-10-17T02:00:00.000Z';
const NOW = Date.parse(FACTS_READ);
/** The facts-read sentence the basis ends on while a game on screen is still to be played. */
const FACTS_SENTENCE = 'Game was read Fri 9:00 pm.';

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
const saints = line('Saints D/ST', 'DEF', 6.9, 6.1, {
	game_total: { points: 42.5, team_points: 20, read_at: FACTS_READ }
});

const row = (add: PlayerLine, over: Partial<WaiverRow> = {}): WaiverRow => ({
	add,
	drop: lemon,
	gain: 1.2,
	week_gain: 6.7,
	starts: true,
	pickup: true,
	beats: {
		host_id: vidal.player.host_id,
		name: vidal.player.name,
		starter: true,
		gain: 6.7,
		open_spot: false
	},
	drops: [
		{ host_id: lemon.player.host_id, gain: 1.2, week_gain: 6.7, starts_this_week: false },
		{ host_id: vidal.player.host_id, gain: 0.6, week_gain: 6.7, starts_this_week: true }
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
	beats: {
		host_id: saints.player.host_id,
		name: saints.player.name,
		starter: true,
		gain: 2.7,
		open_spot: false
	},
	drops: [{ host_id: saints.player.host_id, gain: 0.3, week_gain: 2.7, starts_this_week: true }]
});
const mevis = row(line('Harrison Mevis', 'K', 6.7, 7.6), {
	gain: -0.3,
	week_gain: 0.2,
	pickup: false,
	beats: {
		host_id: 'Fairbairn',
		name: "Ka'imi Fairbairn",
		starter: true,
		gain: 0.2,
		open_spot: false
	}
});
const jones = row(line('Daniel Jones', 'QB', 17.86, 11.8), {
	week_gain: 0,
	starts: false,
	pickup: false,
	beats: { host_id: 'Stroud', name: 'C.J. Stroud', starter: false, gain: 1.1, open_spot: false }
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
	pickups: [gainwell, chiefs],
	roster: [lemon, vidal, saints],
	lineup_proj: 87,
	// The set's Proj from the API (review 66f H1): never the cards' gains summed here.
	pickups_proj: 96.1
};

void test('the strip names each pickup as a card: the move, both gains, the sum on the Lineup', () => {
	const cards = pickupCards(advice);
	assert.deepEqual(cards.map(moveWords), ['Add Gainwell, drop Lemon', 'Add Chiefs, drop Saints']);
	assert.equal(
		cardGains(cards[0] ?? { weekGain: 0, gain: 0 }),
		'+6.7 Proj this week, +1.2 Gain a week'
	);
	assert.equal(cards[1]?.slot, 'D/ST');
	assert.equal(pickupsTitle(2), 'Two pickups');
	assert.equal(pickupsTitle(1), 'One pickup');
	assert.equal(pickupsTitle(0), WAIVERS.noPickup);
	assert.deepEqual(pickupSum(advice, cards.length), {
		figure: '96.1',
		words: 'Proj with both, 87.0 without',
		gain: '+9.1'
	});
	assert.equal(pickupSum(advice, 1)?.words, 'Proj with him, 87.0 without');
	assert.equal(pickupSum({ lineup_proj: null, pickups_proj: null }, 2), null);
	assert.equal(pickupSum(advice, 0), null);
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
	// Every player he could replace is listed, this week's starters marked with the shared status chip
	// (review 66u, finding 1).
	assert.equal(drops[0]?.starter, null);
	assert.deepEqual(drops[1]?.starter, { rank: null, mark: 'Starter', sits: false, line: null });
	assert.equal(
		dropLead(6.7),
		'+6.7 Proj this week with any of them. The one you lose least by comes first.'
	);
	assert.equal(dropLead(null), 'The one you lose least by comes first.');
	assert.equal(sameWeekGain([{ weekGain: 1 }, { weekGain: 2 }]), null);
	assert.equal(dropTitle('Kenny Gainwell'), 'Drop one for Kenny Gainwell');
	const chosen = withDrop(gainwell, drops.at(1) ?? null);
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
	const rows = poolRows(advice, ZONE);
	assert.equal(countWords(rows, 'espn'), '5 free agents we rank on ESPN, 4 beat a player of yours');
	assert.equal(
		countWords(rows.slice(3, 4), 'sleeper'),
		'1 free agent we rank on Sleeper, 0 beat a player of yours'
	);
	assert.equal(clearsWords(null), null);
	assert.equal(clearsWords('not a day'), null);
});

void test('copy guard: every Waivers line is fantasy words, with no dash, semicolon or the word host', () => {
	const cards = pickupCards(advice);
	const lines = [
		...Object.values(WAIVERS),
		stripDecision(cards),
		...cards.map(cardGains),
		dropLead(6.7),
		openWaiversWords('espn'),
		addOnWords('yahoo'),
		copiedWords('espn', 'Gainwell', true).said,
		copiedWords('espn', 'Gainwell', false).said,
		countWords(poolRows(advice, ZONE), 'espn'),
		basisText(waiverBasis(BASIS, [gainwell.add, saints], RULES, CLOCK, NOW))
	];
	// The guard reads the facts-read sentence too.
	assert.ok(lines.some((said) => said.includes(FACTS_SENTENCE)));
	const forbidden = bannedPattern(/\btips?\b/);
	for (const said of lines) assert.doesNotMatch(said, forbidden, said);
});

void test('Beats prints the open spot only when the API says it: an empty Beats is never guessed', () => {
	const taylor = row(line('Mason Taylor', 'TE', 4.77, 5.3), {
		beats: { host_id: '', name: '', starter: true, gain: 4.8, open_spot: true },
		week_gain: 4.8
	});
	const [only] = poolRows({ rows: [taylor], pickups: [taylor] }, ZONE);
	assert.deepEqual(only?.beats, { name: 'Open spot', starter: true, gain: 4.8 });
	// A flex start that tops no one at his own position is no open spot.
	const flex = row(line('Theo Johnson', 'WR', 10.8), { beats: null, starts: true, week_gain: 0.3 });
	assert.equal(poolRows({ rows: [flex], pickups: [] }, ZONE)[0]?.beats, null);
});

void test('a card says a last name in full when another player on screen shares it', () => {
	const roschon = line('Roschon Johnson', 'RB', 0.6);
	const taylor = row(line('Mason Taylor', 'TE', 4.77), { drop: roschon });
	const theo = row(line('Theo Johnson', 'TE', 4.1));
	const [card] = pickupCards({ rows: [taylor, theo], pickups: [taylor], roster: [roschon] });
	assert.equal(card ? moveWords(card) : '', 'Add Taylor, drop Roschon Johnson');
	assert.equal(cardName('Roschon Johnson', ['Roschon Johnson']), 'Johnson');
});

const BASIS = {
	basis:
		'A pickup starts for you this week on Proj and keeps your Gain at zero or better. Its drop costs you least.',
	season_basis:
		"Gain is the change in your lineup's points over replacement, a week, averaged over the 12 weeks left on our rest-of-season order. A game is his rest-of-season points over the games his club has left.",
	basis_note: 'Avg and Last leave out five of your scoring rules our stats lack.',
	basis_note_link: 'Which five',
	projection_read_at: '2026-10-17T02:00:00.000Z',
	projection_previous_read_at: '2026-10-16T02:00:00.000Z',
	projection_scoring: { format: 'ppr' as const, league_own: false }
};
const RULES = '/league/1#uncounted';
const CLOCK = { zone: ZONE, zoned: false };

void test('the basis is one paragraph, the pickup rule first, each column it draws said once (Lane 66t)', () => {
	const parts = waiverBasis(BASIS, [gainwell.add, saints], RULES, CLOCK, NOW);
	assert.equal(
		basisText(parts),
		`${BASIS.basis} ${BASIS.season_basis} Proj is this week's published projection, PPR nearest your rules, defenses on its default scoring, read Fri 9:00 pm. Δ Proj is its change since Thu 9:00 pm. ${FACTS_SENTENCE} Opp rank is points allowed to his position, 1st the fewest. ${BASIS.basis_note} Which five`
	);
	assert.deepEqual(
		parts.filter((p) => !p.phone).map((p) => p.text),
		['Δ Proj is its change since Thu 9:00 pm.']
	);
	assert.equal(parts.at(-1)?.href, RULES);
	// Beats and Open spot say themselves in their cells, so the basis says nothing of them.
	assert.doesNotMatch(basisText(parts), /Beats|Open spot/);
	// Once the game has kicked off, the read is no longer said.
	const later = waiverBasis(
		BASIS,
		[gainwell.add, saints],
		RULES,
		CLOCK,
		Date.parse(saints.facts.kickoff ?? '')
	);
	assert.ok(!basisText(later).includes('was read'), basisText(later));
});
