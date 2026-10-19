// The Waivers screen's table, strip and drop panel words (Lane 66f): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { PlayerLine, WaiverRow, WeekFacts } from '../inseason/api.ts';
import { basisText, KICKED_OFF_PART } from './basis.ts';
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
	withDrop,
	beatsWord
} from './waivers.ts';

const ZONE = 'America/Chicago';
/** When the game facts were read, and the clock every basis here is drawn at: the read's own time,
 * before the fixture's kickoff. Never the real clock. */
const FACTS_READ = '2026-10-17T02:00:00.000Z';
const NOW = Date.parse(FACTS_READ);
/** The Game sentence the basis says at a desk while a game on screen is still to be played: the
 * expected score and weather its cells draw (review H2). */
const FACTS_SENTENCE =
	"Game is each club's expected points, his first, and weather, read Fri 9:00 pm.";

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
	assert.deepEqual(pickupSum(advice, cards), {
		figure: '96.1',
		words: 'Proj with both, 87.0 without',
		gain: '+9.1'
	});
	assert.equal(pickupSum(advice, cards.slice(0, 1))?.words, 'Proj with him, 87.0 without');
	assert.equal(pickupSum({ lineup_proj: null, pickups_proj: null }, cards), null);
	assert.equal(pickupSum(advice, []), null);
	assert.equal(
		stripDecision(cards),
		'Two pickups. Add Gainwell, drop Lemon. Add Chiefs, drop Saints.'
	);
	assert.equal(moveWords({ add: 'Gainwell', drop: null }), 'Add Gainwell');
	assert.equal(shortName('Chiefs D/ST'), 'Chiefs');
});

void test('the table tints only what the strip names: a starter he tops off the strip is not tinted', () => {
	const rows = poolRows(advice, ZONE, NOW);
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
	const rows = sortRows(poolRows(advice, ZONE, NOW), DEFAULT_SORT);
	assert.deepEqual(
		rows.map((r) => r.row.name),
		['Kenny Gainwell', 'Chiefs D/ST', 'Harrison Mevis', 'Daniel Jones', 'Kaytron Allen']
	);
	const byProj = sortRows(poolRows(advice, ZONE, NOW), { key: 'proj', down: true });
	assert.equal(byProj[0]?.row.name, 'Daniel Jones');
	assert.equal(byProj.at(-1)?.row.name, 'Kaytron Allen');
	const upProj = sortRows(poolRows(advice, ZONE, NOW), { key: 'proj', down: false });
	// Not held stays last whichever way.
	assert.equal(upProj.at(-1)?.row.name, 'Kaytron Allen');
	assert.deepEqual(nextSort(DEFAULT_SORT, 'beats'), { key: 'beats', down: false });
	assert.deepEqual(nextSort(DEFAULT_SORT, 'name'), { key: 'name', down: false });
	assert.deepEqual(nextSort(DEFAULT_SORT, 'rest'), { key: 'rest', down: true });
	const byName = sortRows(poolRows(advice, ZONE, NOW), { key: 'name', down: false });
	assert.equal(byName[0]?.row.name, 'Chiefs D/ST');
});

void test('the search keeps the names that hold it, any case', () => {
	const rows = poolRows(advice, ZONE, NOW);
	assert.deepEqual(
		findRows(rows, 'gAIN').map((r) => r.row.name),
		['Kenny Gainwell']
	);
	assert.equal(findRows(rows, '  ').length, rows.length);
	assert.equal(findRows(rows, 'zzz').length, 0);
});

void test("the drop panel lists the roster's players he could replace, the advice's drop first", () => {
	const drops = dropRows(gainwell, [vidal, lemon, saints], ZONE, NOW);
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
	const rows = poolRows(advice, ZONE, NOW);
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
		countWords(poolRows(advice, ZONE, NOW), 'espn'),
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
	const [only] = poolRows({ rows: [taylor], pickups: [taylor] }, ZONE, NOW);
	assert.deepEqual(only?.beats, { name: 'Open spot', starter: true, gain: 4.8, unit: 'week' });
	// A flex start that tops no one at his own position is no open spot.
	const flex = row(line('Theo Johnson', 'WR', 10.8), { beats: null, starts: true, week_gain: 0.3 });
	assert.equal(poolRows({ rows: [flex], pickups: [] }, ZONE, NOW)[0]?.beats, null);
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
	basis: 'A pickup starts this week on Proj and keeps Gain at zero or better.',
	season_basis:
		"Gain is your lineup's change in points over replacement a week, weeks 6 to 17. A game is our order's points a game.",
	basis_note: 'Avg and Last miss five of your rules our stats lack.',
	basis_note_link: 'Which five',
	projection_read_at: '2026-10-17T02:00:00.000Z',
	projection_previous_read_at: '2026-10-16T02:00:00.000Z',
	projection_scoring: { format: 'ppr' as const, league_own: false }
};
const RULES = '/league/1#uncounted';
const CLOCK = { zone: ZONE, zoned: false };

void test('the basis is one paragraph, the pickup rule first, each column it draws said once (Lane 66t)', () => {
	const parts = waiverBasis(
		{ ...BASIS, pickups: advice.pickups },
		[gainwell.add, saints],
		RULES,
		CLOCK,
		NOW
	);
	assert.equal(
		basisText(parts),
		`${BASIS.basis} ${WAIVERS.dropRule} ${BASIS.season_basis} Proj is this week's published projection, PPR nearest your rules, defenses on default scoring, read Fri 9:00 pm. Δ Proj is its change since Thu 9:00 pm. ${FACTS_SENTENCE} Opp rank is points allowed to his position, 1st fewest. ${BASIS.basis_note} Which five`
	);
	assert.deepEqual(
		parts.filter((p) => !p.phone).map((p) => p.text),
		[WAIVERS.dropRule, 'Δ Proj is its change since Thu 9:00 pm.', FACTS_SENTENCE]
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

void test('a narrowed read draws at its own instant: past his kickoff his game facts drop (review 77)', () => {
	// The page read the pool Friday evening; the member narrowed to his position 30 minutes after his
	// kickoff. At the page's clock his expected score would stand; at the narrowed read's it is gone.
	const total = { game_total: { points: 44.5, team_points: 23, read_at: FACTS_READ } };
	const pool = { rows: [row(line('Mason Taylor', 'TE', 4.77, 5.3, total))], pickups: [] };
	const narrowedAt = Date.parse('2026-10-18T17:30:00.000Z');
	assert.equal(poolRows(pool, ZONE, NOW)[0]?.row.expected, '23 to 21.5');
	assert.equal(poolRows(pool, ZONE, narrowedAt)[0]?.row.expected, null);
});

void test('the basis says when Final and the stats land while a row waits on them (Lane 85)', () => {
	const final = {
		...gainwell.add,
		facts: { ...gainwell.add.facts, played: true, game_state: 'final' as const }
	};
	const text = basisText(waiverBasis(BASIS, [final, saints], RULES, CLOCK, NOW));
	assert.ok(text.includes(KICKED_OFF_PART), text);
	assert.ok(!basisText(waiverBasis(BASIS, [saints], RULES, CLOCK, NOW)).includes(KICKED_OFF_PART));
});

/** The API's answer once a pickup's game has kicked off (inseason season_order.go, Lane 85 fix round
 * 3): the rows by the season Gain, the strip its first, every week figure withheld. */
const seasonOrder = (r: WaiverRow): WaiverRow => ({
	...r,
	add: { ...r.add, facts: { ...r.add.facts, played: true, game_state: 'final' } },
	week_gain: null,
	beats: r.beats && { ...r.beats, gain: null },
	drops: r.drops.map((d) => ({ ...d, week_gain: null }))
});
const SEASON_WORDS = 'Pickups go in Gain order once their week 6 games kick off.';

void test('in the API season order the web prints it: the season Gain in Beats, no week figure (M-E)', () => {
	const rows = [gainwell, chiefs, mevis, jones, allen].map(seasonOrder);
	const tuesday = { ...advice, rows, pickups: [rows[0] ?? gainwell] };
	const pool = poolRows(tuesday, ZONE, NOW);
	const top = pool[0];
	assert.ok(top?.beats);
	assert.deepEqual(top.beats, { name: 'Vidal', starter: true, gain: 1.2, unit: 'season' });
	assert.equal(beatsWord(top.beats), '+1.2 Gain');
	assert.equal(beatsWord({ gain: 6.7, unit: 'week' }), '+6.7');
	assert.deepEqual(
		sortRows(pool, DEFAULT_SORT).map((r) => r.row.name),
		['Kenny Gainwell', 'Chiefs D/ST', 'Harrison Mevis', 'Daniel Jones', 'Kaytron Allen']
	);
	const [card] = pickupCards(tuesday);
	assert.ok(card);
	assert.equal(card.weekGain, null);
	assert.equal(cardGains(card), '+1.2 Gain a week');
	assert.equal(pickupSum({ lineup_proj: null, pickups_proj: null }, pickupCards(tuesday)), null);
	assert.deepEqual(top.row.game, { where: 'vs PIT', when: 'Final' });
	// The basis is the API's order sentence; the drop's reason is not said, its sentence names none.
	const text = basisText(
		waiverBasis(
			{ ...BASIS, basis: SEASON_WORDS, pickups: tuesday.pickups },
			rows.map((r) => r.add),
			RULES,
			CLOCK,
			NOW
		)
	);
	assert.ok(text.startsWith(SEASON_WORDS), text);
	assert.ok(!text.includes(WAIVERS.dropRule), text);
	assert.doesNotMatch(SEASON_WORDS, bannedPattern());
});

void test('the web never re-orders the strip: the cards are the API pickups in its order (M-E guard)', () => {
	// The API sent Chiefs first though Gainwell has the higher season Gain: the web keeps its order.
	const cards = pickupCards({ ...advice, pickups: [chiefs, gainwell] });
	assert.deepEqual(
		cards.map((c) => c.add),
		['Chiefs', 'Gainwell']
	);
	const season = [seasonOrder(chiefs), seasonOrder(gainwell)];
	assert.deepEqual(
		pickupCards({ ...advice, rows: season, pickups: season }).map((c) => c.add),
		['Chiefs', 'Gainwell']
	);
	// Under the week's rule the drop's reason follows the pickup sentence, at a desk.
	const week = waiverBasis({ ...BASIS, pickups: [gainwell] }, [gainwell.add], RULES, CLOCK, NOW);
	assert.ok(week.some((p) => p.text === WAIVERS.dropRule && !p.phone));
	const none = waiverBasis({ ...BASIS, pickups: [] }, [gainwell.add], RULES, CLOCK, NOW);
	assert.ok(!none.some((p) => p.text === WAIVERS.dropRule));
});
