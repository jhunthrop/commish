// The Waivers screen's table, strip and drop panel words (Lane 66f): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { PlayerLine, WaiverRow, WeekFacts } from '../inseason/api.ts';
import { addKey } from '../inseason/move.ts';
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
	beatsPlace,
	beatsWord,
	dropWhy,
	dropWhyWords,
	beatsName,
	beatsWeekWord,
	gainGroups,
	HEAD_BASIS,
	headBasis,
	headBasisText,
	seasonBasisWords
} from './waivers.ts';

const ZONE = 'America/Chicago';
/** The box's empty figure. */
const BOX_NONE = '--';
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
		{
			host_id: lemon.player.host_id,
			gain: 1.2,
			week_gain: 6.7,
			starts_this_week: false
		},
		{
			host_id: vidal.player.host_id,
			gain: 0.6,
			week_gain: 6.7,
			starts_this_week: true
		}
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
	drops: [
		{
			host_id: saints.player.host_id,
			gain: 0.3,
			week_gain: 2.7,
			starts_this_week: true
		}
	]
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
	pickup_order: 'week' as const,
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
	// A row with no gain over the roster names no one, whomever the API tops (Lane 98, B13).
	assert.equal(kicker.gains, false);
	assert.equal(kicker.beats.who, null);
	assert.equal(rows.find((r) => r.row.name === 'Daniel Jones')?.beats.who?.name, 'Stroud');
	assert.equal(rows.find((r) => r.row.name === 'Kaytron Allen')?.clears, 'Clears Wed');
	assert.equal(rows[0]?.rest, 11.8);
});

void test('the default sort is Beats by the season Gain, ties in the answer order (Lane 98)', () => {
	const rows = sortRows(poolRows(advice, ZONE, NOW), DEFAULT_SORT);
	assert.deepEqual(
		rows.map((r) => r.row.name),
		['Daniel Jones', 'Kenny Gainwell', 'Kaytron Allen', 'Chiefs D/ST', 'Harrison Mevis']
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
	// The count is the rows that gain, those over the divider (Lane 98, B13): Allen's Gain names no one,
	// so the rule cannot judge it and it is not counted (fix round 1, H1).
	assert.equal(countWords(rows, 'espn'), '5 free agents we rank on ESPN, 3 beat a player of yours');
	assert.equal(
		countWords(rows.slice(2, 3), 'sleeper'),
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
		basisText(waiverBasis(BASIS, [gainwell.add, saints], HOST, CLOCK, NOW)),
		headBasisText(headBasis(BASIS.projection_previous_read_at, true, CLOCK)),
		stripDecision([{ add: 'Otton', drop: 'Mason', dropWhy: WAIVERS.irBench }])
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
	const [only] = poolRows({ rows: [taylor], pickups: [taylor], roster: [] }, ZONE, NOW);
	assert.deepEqual(only?.beats, {
		who: { name: 'Open spot', starter: true, bye: false },
		gain: 1.2,
		gains: true,
		week: 4.8
	});
	// A flex start that tops no one at his own position is no open spot: he beats nobody, so the cell
	// says no one (B14).
	const flex = row(line('Theo Johnson', 'WR', 10.8), { beats: null, starts: true, week_gain: 0.3 });
	assert.equal(poolRows({ rows: [flex], pickups: [], roster: [] }, ZONE, NOW)[0]?.beats.who, null);
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
	basis_note: 'Avg and Last miss your two-point, missed kick, fumble recovery and safety rules.',
	projection_read_at: '2026-10-17T02:00:00.000Z',
	projection_previous_read_at: '2026-10-16T02:00:00.000Z',
	projection_scoring: { format: 'ppr' as const, league_own: false }
};
const HOST = 'sleeper';
const CLOCK = { zone: ZONE, zoned: false };

void test("before the addressed week's projection is read the basis says nothing of Proj: the screen draws no Proj column and says the day over the table (Lane 95)", () => {
	const ahead = {
		...BASIS,
		week: 6,
		for_week: 7,
		projection_read_at: null,
		projection_previous_read_at: null,
		projection_arrives_at: '2026-10-22T22:15:00.000Z'
	};
	const text = basisText(waiverBasis(ahead, [saints], HOST, CLOCK, NOW));
	assert.doesNotMatch(text, /projections expected/);
	assert.doesNotMatch(text, /published projection/);
	assert.doesNotMatch(text, /Δ Proj/);
});

void test("a page turned to week 7 says its Proj is week 7's, and the drop's Sunday final counts the platform's points (Lane 111, B70, B23)", () => {
	const turned = { ...BASIS, week: 6, for_week: 7 };
	// Monday night: the member's drop played Sunday, his final the platform's points until Wednesday.
	const drop: PlayerLine = {
		...gainwell.add,
		facts: {
			...gainwell.add.facts,
			week: 7,
			last_games: [{ week: 6, points: 14.2, source: 'platform' }, ...gainwell.add.facts.last_games]
		}
	};
	const text = basisText(waiverBasis(turned, [drop, saints], HOST, CLOCK, NOW));
	assert.ok(text.includes("Proj is week 7's published projection"), text);
	assert.ok(
		text.includes(
			"Avg and Last count week 6's finals from Sleeper's points, our stats by Wednesday."
		),
		text
	);
	const unturned = basisText(
		waiverBasis({ ...BASIS, week: 6, for_week: 6 }, [saints], HOST, CLOCK, NOW)
	);
	assert.ok(unturned.includes("Proj is this week's published projection"), unturned);
});

void test('the basis is one paragraph, the pickup rule first, each column it draws said once (Lane 66t)', () => {
	const parts = waiverBasis(
		{ ...BASIS, pickups: advice.pickups },
		[gainwell.add, saints],
		HOST,
		CLOCK,
		NOW
	);
	// A game's sentence and Δ Proj's are the line under the heads, so the footer says neither (B35).
	assert.equal(
		basisText(parts),
		`${BASIS.basis} ${WAIVERS.dropRule} Gain is your lineup's change in points over replacement a week, weeks 6 to 17. Proj is this week's published projection, PPR nearest your rules, defenses on default scoring, read Fri 9:00 pm. ${FACTS_SENTENCE} Opp rank is points allowed to his position, 1st fewest. ${BASIS.basis_note}`
	);
	assert.deepEqual(
		parts.filter((p) => !p.phone).map((p) => p.text),
		[WAIVERS.dropRule, FACTS_SENTENCE]
	);
	// The rules our stats lack are named, with no link to follow (Lane 111, B33).
	assert.ok(parts.every((p) => p.href === undefined));
	// Beats and Open spot say themselves in their cells, so the basis says nothing of them.
	assert.doesNotMatch(basisText(parts), /Beats|Open spot/);
	// Once the game has kicked off, the read is no longer said.
	const later = waiverBasis(
		BASIS,
		[gainwell.add, saints],
		HOST,
		CLOCK,
		Date.parse(saints.facts.kickoff ?? '')
	);
	assert.ok(!basisText(later).includes('was read'), basisText(later));
});

void test('a narrowed read draws at its own instant: past his kickoff his game facts drop (review 77)', () => {
	// The page read the pool Friday evening; the member narrowed to his position 30 minutes after his
	// kickoff. At the page's clock his expected score would stand; at the narrowed read's it is gone.
	const total = { game_total: { points: 44.5, team_points: 23, read_at: FACTS_READ } };
	const pool = {
		rows: [row(line('Mason Taylor', 'TE', 4.77, 5.3, total))],
		pickups: [],
		roster: []
	};
	const narrowedAt = Date.parse('2026-10-18T17:30:00.000Z');
	assert.equal(poolRows(pool, ZONE, NOW)[0]?.row.expected, '23 to 21.5');
	assert.equal(poolRows(pool, ZONE, narrowedAt)[0]?.row.expected, null);
});

void test('the basis says when Final and the stats land while a row waits on them (Lane 85)', () => {
	const final = {
		...gainwell.add,
		facts: { ...gainwell.add.facts, played: true, game_state: 'final' as const }
	};
	const text = basisText(waiverBasis(BASIS, [final, saints], HOST, CLOCK, NOW));
	assert.ok(text.includes(KICKED_OFF_PART), text);
	assert.ok(!basisText(waiverBasis(BASIS, [saints], HOST, CLOCK, NOW)).includes(KICKED_OFF_PART));
});

/** A row as the API sends it in the season Gain order (inseason season_order.go, Lane 85 fix round
 * 4): his game final, every week figure withheld, as the engine gives a Final add (no week gain). */
const seasonOrder = (r: WaiverRow): WaiverRow => ({
	...r,
	add: { ...r.add, facts: { ...r.add.facts, played: true, game_state: 'final' } },
	week_gain: null,
	beats: r.beats && { ...r.beats, gain: null },
	drops: r.drops.map((d) => ({ ...d, week_gain: null }))
});
const SEASON_WORDS = 'Pickups go in Gain order once their week 6 games kick off.';

void test('in the API season order the web prints it: the season Gain in Beats, no week figure (M-E)', () => {
	// The API's order: by the season Gain.
	const rows = [gainwell, chiefs, mevis, { ...jones, gain: -0.5 }, { ...allen, gain: -0.8 }].map(
		seasonOrder
	);
	const tuesday = {
		...advice,
		pickup_order: 'season_gain' as const,
		rows,
		pickups: [rows[0] ?? gainwell]
	};
	const pool = poolRows(tuesday, ZONE, NOW);
	const top = pool[0];
	assert.ok(top?.beats);
	assert.deepEqual(top.beats, {
		who: { name: 'Vidal', starter: true, bye: false },
		gain: 1.2,
		gains: true,
		week: null
	});
	assert.equal(beatsWord(top.beats), '+1.2 Gain');
	// A zero is never the loud "0.0 Gain" (B13).
	assert.equal(beatsWord({ gain: 0, gains: false }), '0.0');
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
			HOST,
			CLOCK,
			NOW
		)
	);
	assert.ok(text.startsWith(SEASON_WORDS), text);
	assert.ok(!text.includes(WAIVERS.dropRule), text);
	assert.doesNotMatch(SEASON_WORDS, bannedPattern());
});

void test('the web never re-orders the strip: the cards are the API pickups in its order (M-E guard)', () => {
	// The API's week strip sent Chiefs first: the web keeps its order.
	const cards = pickupCards({ ...advice, pickups: [chiefs, gainwell] });
	assert.deepEqual(
		cards.map((c) => c.add),
		['Chiefs', 'Gainwell']
	);
	// Under the week's rule the drop's reason follows the pickup sentence, at a desk.
	const week = waiverBasis({ ...BASIS, pickups: [gainwell] }, [gainwell.add], HOST, CLOCK, NOW);
	assert.ok(week.some((p) => p.text === WAIVERS.dropRule && !p.phone));
	const none = waiverBasis({ ...BASIS, pickups: [] }, [gainwell.add], HOST, CLOCK, NOW);
	assert.ok(!none.some((p) => p.text === WAIVERS.dropRule));
});

void test('in season order the table prints the API rows in its order, the strip its top row (M-H guard)', () => {
	// The API's season Gain order: a row topping no one first, a bench player topped above a starter.
	const rows = [
		{ ...allen, gain: 2.1 },
		{ ...jones, gain: 1.5 },
		{ ...gainwell, gain: 1.2 },
		{ ...chiefs, gain: 0.3 },
		{ ...mevis, gain: -0.3 }
	].map(seasonOrder);
	const top = rows[0] ?? allen;
	const answer = { ...advice, pickup_order: 'season_gain' as const, rows, pickups: [top] };
	const printed = sortRows(poolRows(answer, ZONE, NOW), DEFAULT_SORT);
	assert.deepEqual(
		printed.map((r) => r.key),
		rows.map(addKey)
	);
	assert.equal(printed[0]?.key, pickupCards(answer)[0]?.key);
	assert.equal(printed[0]?.named, true);
	assert.ok(printed.every((r) => r.source.week_gain === null));
	// The sorted column draws its own key on every row, one tops no one or is on a bye (review M-I);
	// a row with no gain draws it bare and quiet (B13).
	assert.deepEqual(
		printed.map((r) => beatsWord(r.beats)),
		// Allen's +2.1 names no one: no Gain the page stands behind (fix round 1, H1).
		['--', '+1.5 Gain', '+1.2 Gain', '+0.3 Gain', '−0.3']
	);
	const first = printed[0];
	assert.ok(first);
	assert.equal(first.beats.who, null);
	assert.equal(first.row.game, 'bye');
});

void test('the rows that gain sit over one divider, the rest under it, each group in the sort (B13)', () => {
	const rows = poolRows(
		{
			rows: [mevis, { ...jones, gain: 0 }, gainwell, { ...allen, gain: 0.04 }],
			pickups: [],
			roster: []
		},
		ZONE,
		NOW
	);
	const { gaining, rest } = gainGroups(rows);
	assert.deepEqual(
		gaining.map((r) => r.row.name),
		['Kenny Gainwell']
	);
	// A gain the page prints as 0.0 is no gain.
	assert.deepEqual(
		rest.map((r) => r.row.name),
		['Harrison Mevis', 'Daniel Jones', 'Kaytron Allen']
	);
	// A card of the strip is offered whatever its season Gain (a week pickup keeps Gain at zero).
	const card = { ...gainwell, gain: 0 };
	assert.equal(poolRows({ rows: [card], pickups: [card], roster: [] }, ZONE, NOW)[0]?.gains, true);
});

/** Jordan Mason on injured reserve on the member's bench, the card's drop (B34). */
const mason = {
	...line('Jordan Mason', 'RB', null, 4),
	facts: facts({
		designation: { status: 'injured_reserve', as_of: FACTS_READ, since: '2026-09-22T12:00:00.000Z' }
	})
};

void test('a card whose drop is on injured reserve on the bench says so (B34)', () => {
	const otton = row(line('Cade Otton', 'TE', 7.7, 9.1), {
		drop: mason,
		gain: 2,
		beats: {
			host_id: 'Jordan Mason',
			name: 'Jordan Mason',
			starter: false,
			gain: null,
			open_spot: false
		},
		drops: [
			{
				host_id: 'Jordan Mason',
				gain: 2,
				week_gain: null,
				starts_this_week: false
			}
		]
	});
	const [card] = pickupCards({ rows: [otton], pickups: [otton], roster: [mason, lemon] });
	assert.ok(card);
	assert.equal(card.dropWhy, 'IR, on your bench');
	assert.equal(stripDecision([card]), 'One pickup. Add Otton, drop Mason (IR, on your bench).');
	assert.equal(dropWhyWords(null), null);
	// Beats names the drop, on the bench, at the row's season Gain (B14).
	const [shown] = poolRows({ rows: [otton], pickups: [otton], roster: [] }, ZONE, NOW);
	assert.deepEqual(shown?.beats, {
		who: { name: 'Mason', starter: false, bye: false },
		gain: 2,
		gains: true,
		week: 6.7
	});
	// The platform's own IR mark counts; a drop this week's lineup starts, or one not on IR, says nothing.
	const marked = { ...lemon, player: { ...lemon.player, injured_reserve: true } };
	assert.equal(dropWhy({ drop: marked, drops: [] }), WAIVERS.irBench);
	assert.equal(
		dropWhy({
			drop: mason,
			drops: [
				{
					host_id: 'Jordan Mason',
					gain: 1,
					week_gain: null,
					starts_this_week: true
				}
			]
		}),
		null
	);
	assert.equal(dropWhy({ drop: lemon, drops: [] }), null);
	assert.equal(dropWhy({ drop: null, drops: [] }), null);
});

void test('the line under the heads says each column once, Δ Proj only while it is drawn (B35)', () => {
	assert.equal(
		headBasisText(headBasis(BASIS.projection_previous_read_at, true, CLOCK)),
		`A game ${HEAD_BASIS.rest}, Avg his season average, Δ Proj his Proj's change since Thu 9:00 pm, Beats the player he would replace in your rest-of-season lineup.`
	);
	assert.equal(
		headBasisText(headBasis(BASIS.projection_previous_read_at, false, CLOCK)),
		'A game is our rest-of-season points a game, Avg his season average, Beats the player he would replace in your rest-of-season lineup.'
	);
	assert.equal(headBasis(null, true, CLOCK).length, 3);
	assert.equal(
		seasonBasisWords(BASIS.season_basis),
		"Gain is your lineup's change in points over replacement a week, weeks 6 to 17."
	);
	assert.equal(seasonBasisWords('Gain is a week.'), 'Gain is a week.');
});

void test('a Gain that names no one sits under the divider with no Gain; a card row says its week figure (fix round 1)', () => {
	const chiefsOff = { ...chiefs, beats: null };
	const rows = poolRows(
		{ rows: [gainwell, chiefsOff], pickups: [gainwell], roster: [lemon, vidal, saints] },
		ZONE,
		NOW
	);
	const off = rows.find((r) => r.row.name === 'Chiefs D/ST');
	assert.ok(off);
	assert.equal(off.gains, false);
	assert.equal(off.beats.gain, null);
	assert.equal(beatsWord(off.beats), BOX_NONE);
	assert.deepEqual(
		gainGroups(rows).rest.map((r) => r.row.name),
		['Chiefs D/ST']
	);
	// The banner's move on its own row: "+6.7 Proj" under its season Gain (review M1).
	const card = rows.find((r) => r.named);
	assert.equal(card?.beats.week, 6.7);
	assert.equal(beatsWeekWord(6.7), '+6.7 Proj');
	assert.equal(
		countWords(rows, 'espn'),
		'2 free agents we rank on ESPN, 1 beats a player of yours'
	);
});

void test('Beats says a shared surname with its first initial (review M2)', () => {
	assert.equal(beatsName('Roschon Johnson', ['Roschon Johnson', 'Theo Johnson']), 'R. Johnson');
	assert.equal(beatsName('Roschon Johnson', ['Roschon Johnson', 'Mason Taylor']), 'Johnson');
	assert.equal(beatsName('Saints D/ST', ['Saints D/ST']), 'Saints');
	const roschon = line('Roschon Johnson', 'RB', 0.6);
	const theo = row(line('Theo Johnson', 'TE', 4.1), { gain: -0.2, pickup: false });
	const taylor = row(line('Mason Taylor', 'TE', 4.77), {
		drop: roschon,
		beats: {
			host_id: 'Roschon Johnson',
			name: 'Roschon Johnson',
			starter: false,
			gain: 4.8,
			open_spot: false
		}
	});
	const [shown] = poolRows(
		{ rows: [taylor, theo], pickups: [taylor], roster: [roschon] },
		ZONE,
		NOW
	);
	assert.equal(shown?.beats.who?.name, 'R. Johnson');
});

void test('Beats names his place in the rest-of-season lineup, a starter on bye saying so (Lane 108, B81)', () => {
	assert.equal(beatsPlace({ name: 'Vidal', starter: true, bye: false }), 'Starter');
	assert.equal(beatsPlace({ name: 'Vidal', starter: true, bye: true }), 'Starter, bye');
	assert.equal(beatsPlace({ name: 'Mason', starter: false, bye: true }), 'Bench');
	// The API's bye reaches the cell; an answer before Lane 108 sends none and reads as off it.
	const beats = {
		host_id: 'Jordan Mason',
		name: 'Jordan Mason',
		starter: true,
		gain: null,
		open_spot: false
	};
	const onBye = row(line('Cade Otton', 'TE', 7.7, 9.1), {
		gain: 2,
		beats: { ...beats, bye: true }
	});
	const [shown] = poolRows({ rows: [onBye], pickups: [], roster: [] }, ZONE, NOW);
	assert.ok(shown?.beats.who);
	assert.equal(beatsPlace(shown.beats.who), 'Starter, bye');
	const older = row(line('Cade Otton', 'TE', 7.7, 9.1), { gain: 2, beats });
	const [before] = poolRows({ rows: [older], pickups: [], roster: [] }, ZONE, NOW);
	assert.ok(before?.beats.who);
	assert.equal(beatsPlace(before.beats.who), 'Starter');
});
