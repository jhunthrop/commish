// The in-season screens' words, and the copy guard over every line they compose: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LineupSlot, PlayerLine, TradeRow, WaiverRow, WeekFacts } from './types.ts';
import {
	CLOSE_FOR_THEM,
	EVERY_TRADE,
	NO_START_RULE,
	NO_TRADES_WITH_TEAM,
	POINTS_OVER_REPLACEMENT,
	designationWords,
	dropWords,
	gainFigure,
	gameWords,
	isScreen,
	lastGamesWords,
	lineupDecision,
	moveWords,
	rankWords,
	satIds,
	slotChanges,
	refreshedWords,
	slotLabels,
	teamAside,
	tradeDecision,
	tradeGains,
	verbWords,
	waiverDecision,
	weekdayTime
} from './words.ts';

const facts = (over: Partial<WeekFacts> = {}): WeekFacts => ({
	week: 6,
	opponent: 'BUF',
	home: false,
	kickoff: '2026-10-18T17:00:00.000Z',
	bye: false,
	designation: null,
	played: false,
	points_this_week: null,
	last_games: [],
	allowed_to_position: null,
	...over
});

const line = (name: string, position = 'RB', rank: number | null = 14): PlayerLine => ({
	player: {
		host_id: name,
		board_id: name,
		name,
		position,
		team: 'TB',
		injured_reserve: false
	},
	position_rank: rank,
	points_over_replacement: 12.5,
	facts: facts()
});

const slot = (name: string, ours: string, host: string | null, changed: boolean): LineupSlot => ({
	slot: name,
	ours: line(ours),
	host: host === null ? null : line(host),
	changed,
	sentence: null
});

const waiver = (over: Partial<WaiverRow> = {}): WaiverRow => ({
	add: line('Bhayshul Tuten'),
	drop: line('Jaylen Wright'),
	gain: 1.24,
	starts: true,
	sentence: 'He would start at RB2 over Jaylen Wright.',
	...over
});

const trade: TradeRow = {
	give: [line('Kyren Williams'), line('Jordan Mason')],
	get: [line('Nico Collins', 'WR', 9)],
	my_gain: 4.06,
	their_gain: 0.31,
	close_for_them: true
};

void test('only the three screens are pages under a league', () => {
	assert.ok(isScreen('start') && isScreen('waivers') && isScreen('trades'));
	assert.equal(isScreen('pool'), false);
});

void test('the verb names the host as the place it happens', () => {
	assert.equal(verbWords('start', 'sleeper'), 'Set it on Sleeper');
	assert.equal(verbWords('waivers', 'mfl'), 'Claim on MyFantasyLeague');
	assert.equal(verbWords('trades', 'ffpc'), 'Propose on FFPC');
});

void test('slots alike are numbered, a lone slot is not, and a flex reads as a word', () => {
	assert.deepEqual(
		slotLabels(['QB', 'RB', 'RB', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX', 'DEF']),
		['QB', 'RB1', 'RB2', 'WR', 'TE', 'Flex 1', 'Flex 2', 'Superflex', 'DEF']
	);
});

void test('the lineup decision names each change and its slot, or says the lineup is set', () => {
	const slots = [
		slot('RB', 'Bijan Robinson', 'Bijan Robinson', false),
		slot('RB', 'Rachaad White', 'Tank Bigsby', true),
		slot('FLEX', 'Jauan Jennings', 'Josh Downs', true)
	];
	assert.equal(
		lineupDecision({ set: false, slots }),
		'Two changes: start Rachaad White over Tank Bigsby at RB2, start Jauan Jennings over Josh Downs in the flex.'
	);
	assert.equal(
		lineupDecision({ set: false, slots: [slot('TE', 'Trey McBride', null, true)] }),
		'One change: start Trey McBride at TE.'
	);
	assert.equal(lineupDecision({ set: true, slots: [] }), 'Your lineup is set.');
});

void test('a starter moved to make room is not a change, and the start sits the player at the end of the chain', () => {
	const slots = [
		slot('WR', 'Jakobi Meyers', "Ja'Marr Chase", true),
		slot('WR', 'Rome Odunze', 'Rome Odunze', false),
		slot('FLEX', 'Travis Etienne', 'Jakobi Meyers', true)
	];
	assert.deepEqual(
		slotChanges(slots).map((c) => (c?.kind === 'start' ? c.sit?.player.name : c?.kind)),
		['move', undefined, "Ja'Marr Chase"]
	);
	assert.equal(
		lineupDecision({ set: false, slots }),
		"One change: start Travis Etienne over Ja'Marr Chase in the flex."
	);
	assert.deepEqual([...satIds(slots)], ["Ja'Marr Chase"]);
	assert.equal(moveWords('Flex 1'), 'Moves from the flex');
	assert.equal(moveWords('WR2'), 'Moves from WR2');
});

void test('the waiver decision names the add, the drop and the gain a week', () => {
	assert.equal(
		waiverDecision(waiver()),
		'Add Bhayshul Tuten for Jaylen Wright. Your lineup gains 1.2 points over replacement a week.'
	);
	assert.equal(
		waiverDecision(waiver({ drop: null, gain: 0, starts: false })),
		'Add Bhayshul Tuten. He would not start for you this week.'
	);
	assert.equal(waiverDecision(null), 'Nobody on waivers starts for you this week.');
	assert.equal(dropWords(waiver()), 'for Jaylen Wright, RB14');
	assert.equal(dropWords({ drop: null }), 'into an open spot');
	assert.equal(gainFigure(1.24), '+1.2');
});

void test('a trade says who gets whom and both gains plainly', () => {
	assert.equal(
		tradeDecision({ row: trade, team: 'Muttdogs' }),
		'Trade Kyren Williams and Jordan Mason to Muttdogs for Nico Collins. Your lineup gains 4.1 points over replacement a week, theirs 0.3.'
	);
	assert.equal(tradeDecision(null), 'No trade we found helps both lineups.');
	assert.equal(
		tradeGains({ my_gain: 5.93, their_gain: 0.03 }),
		'Your lineup gains 5.9 points over replacement a week, theirs under 0.1.'
	);
	assert.equal(
		teamAside({ owner: 'muttdog', record: { wins: 5, losses: 0, ties: 0 } }),
		'muttdog, 5-0'
	);
	assert.equal(teamAside({ owner: '', record: { wins: 2, losses: 2, ties: 1 } }), '2-2-1');
});

void test("a row's facts: the game on the Eastern clock, the designation with its stamp, the last games", () => {
	assert.equal(weekdayTime('2026-10-18T17:00:00.000Z'), 'Sun 1:00 pm ET');
	assert.equal(gameWords(facts()), 'at BUF Sun 1:00 pm ET');
	assert.equal(gameWords(facts({ home: true, kickoff: null })), 'vs BUF');
	assert.equal(gameWords(facts({ played: true })), 'at BUF, played');
	assert.equal(gameWords(facts({ bye: true, opponent: null })), 'Bye this week');
	assert.equal(
		designationWords({ status: 'questionable', as_of: '2026-10-15T20:10:00.000Z' }),
		'Questionable as of Thu 4:10 pm ET'
	);
	assert.equal(
		lastGamesWords([
			{ week: 3, points: 18.4 },
			{ week: 4, points: 11.24 },
			{ week: 5, points: 9 }
		]),
		'18.4, 11.2 and 9.0 in his last three'
	);
	assert.equal(lastGamesWords([{ week: 5, points: 18.4 }]), '18.4 in his last game');
	assert.equal(lastGamesWords([]), null);
	assert.equal(rankWords(line('Rachaad White')), 'RB14');
	assert.equal(rankWords(line('Rachaad White', 'RB', null)), null);
});

void test('the refreshed stamp names the order and its day', () => {
	assert.equal(
		refreshedWords('rest_of_season', '2026-10-14T19:05:37.917Z'),
		'Our rest-of-season order, refreshed October 14.'
	);
	assert.equal(
		refreshedWords('preseason', '2026-09-09T02:20:29.697Z'),
		'Our preseason number, refreshed September 8.'
	);
});

/** The words a fantasy screen never uses: the trading register (founder ruling 2026-09-07) and
 * verdict theatre (spec §2). Matched whole, with their plain inflections. */
const BANNED =
	/\b(market|prices?|priced|buy|buys|buying|sell|sells|selling|stock|assets?|value|values|valued|smash|robbery|fleece|fleeced)\b/i;
/** A dash between clauses (em or en), a semicolon, or a doubled word ("the the"). */
const DASH = /[–—]/;
const DOUBLED_WORD = /\b([a-z]+)\s+\1\b/i;

void test('copy guard: every in-season line is fantasy words, with no dash, semicolon, doubled word or tip', () => {
	const lines = [
		verbWords('start', 'sleeper'),
		verbWords('waivers', 'sleeper'),
		verbWords('trades', 'sleeper'),
		lineupDecision({
			set: false,
			slots: [
				slot('RB', 'Rachaad White', 'Tank Bigsby', true),
				slot('FLEX', 'Jauan Jennings', 'Josh Downs', true)
			]
		}),
		lineupDecision({ set: true, slots: [] }),
		waiverDecision(waiver()),
		waiverDecision(waiver({ drop: null, gain: 0, starts: false })),
		waiverDecision(null),
		dropWords(waiver()),
		dropWords({ drop: null }),
		tradeDecision({ row: trade, team: 'Muttdogs' }),
		tradeDecision(null),
		tradeGains(trade),
		tradeGains({ my_gain: 5.93, their_gain: 0.03 }),
		NO_TRADES_WITH_TEAM,
		CLOSE_FOR_THEM,
		EVERY_TRADE,
		teamAside({ owner: 'muttdog', record: { wins: 5, losses: 0, ties: 0 } }),
		NO_START_RULE,
		POINTS_OVER_REPLACEMENT,
		moveWords('Flex 1'),
		refreshedWords('rest_of_season', '2026-10-14T19:05:37.917Z'),
		refreshedWords('preseason', '2026-09-09T02:20:29.697Z'),
		gameWords(facts()),
		gameWords(facts({ bye: true, opponent: null })),
		designationWords({ status: 'pup', as_of: '2026-10-15T20:10:00.000Z' }),
		lastGamesWords([{ week: 5, points: 18.4 }])
	];
	for (const text of lines) {
		assert.ok(text, 'every composed line is said');
		assert.doesNotMatch(text, BANNED, text);
		assert.doesNotMatch(text, DASH, text);
		assert.doesNotMatch(text, /;/, text);
		assert.doesNotMatch(text, DOUBLED_WORD, text);
	}
	assert.match('a steal at his price', BANNED);
	assert.match('a clause — another', DASH);
});
