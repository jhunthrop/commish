// The in-season screens' words, and the copy guard over every line they compose: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memberZone, weekdayTime, zoneLine } from '#lib/format/clock.ts';
import { readFileSync } from 'node:fs';
import { isScreen } from './screens.ts';
import {
	MOVE_LINES,
	bidLabel,
	bidProblem,
	failedStep,
	hostSaid,
	lostWords,
	moveTitle,
	openHostWords,
	readingWords,
	resultWords,
	settingWords
} from './move.ts';
import { READING_NOW, readNowWords } from '../model.ts';
import type { LineupSlot, PlayerLine, TradeRow, WaiverRow, WeekFacts } from './api.ts';
import {
	CLOSE_FOR_THEM,
	EVERY_TRADE,
	HELD,
	LINES,
	TAB_LABELS,
	addsTitle,
	lineupTitle,
	showMore,
	startingCount,
	NO_START_RULE,
	LATER_RULE,
	NO_TRADES_WITH_TEAM,
	hisPorWords,
	porFigure,
	signInTitle,
	sharedDropWords,
	designationWords,
	noTradeWith,
	dropWords,
	gainFigure,
	gameWords,
	lastGamesWords,
	lineupDecision,
	rankWords,
	satIds,
	refreshedWords,
	slotLabels,
	teamAside,
	tradeDecision,
	tradeGains,
	verbWords,
	waiverDecision
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
	headshot: null,
	slug: null,
	position_rank: rank,
	points_over_replacement: 0.7,
	held: false,
	facts: facts()
});

const slot = (
	name: LineupSlot['slot'],
	ours: string,
	host: string | null,
	changed: boolean
): LineupSlot => ({
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
	drop: null,
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
	assert.deepEqual(slotLabels(['QB', 'RB', 'RB', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPERFLEX', 'DEF']), [
		'QB',
		'RB1',
		'RB2',
		'WR',
		'TE',
		'Flex 1',
		'Flex 2',
		'Superflex',
		'DEF'
	]);
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

void test('above two changes the decision leads with the count and the first, and the rows carry the rest', () => {
	const slots = [
		slot('QB', 'Patrick Mahomes', 'Aaron Rodgers', true),
		slot('TE', 'Chig Okonkwo', 'Sam LaPorta', true),
		slot('FLEX', 'Travis Etienne', "Ja'Marr Chase", true),
		slot('DEF', 'Minnesota Vikings', 'Buffalo Bills', true)
	];
	assert.equal(
		lineupDecision({ set: false, slots }),
		'Four changes, starting with Patrick Mahomes over Aaron Rodgers at QB.'
	);
});

void test("the bench marks the starters a change sits, the host's player in each changed slot", () => {
	const slots = [
		slot('WR', 'Rome Odunze', 'Rome Odunze', false),
		slot('FLEX', 'Travis Etienne', "Ja'Marr Chase", true)
	];
	assert.deepEqual([...satIds(slots)], ["Ja'Marr Chase"]);
});

void test('the waiver decision names the add, the drop and the gain a week', () => {
	assert.equal(
		waiverDecision(waiver()),
		'Add Bhayshul Tuten, drop Jaylen Wright. Your lineup gains 1.2 points over replacement a week.'
	);
	assert.equal(
		waiverDecision(waiver({ drop: null, gain: 0, starts: false })),
		'Add Bhayshul Tuten. He would not start for you this week.'
	);
	assert.equal(waiverDecision(null), 'Nobody on waivers starts for you this week.');
	assert.equal(dropWords(waiver()), 'drop Jaylen Wright, RB14');
	assert.equal(dropWords({ drop: null }), 'into an open spot');
	assert.equal(sharedDropWords(line('Jaxson Dart', 'QB', 31)), 'Each add drops Jaxson Dart, QB31');
	assert.equal(gainFigure(1.24), '+1.2');
});

void test("a row's own points over replacement is his, and zero carries no sign", () => {
	assert.equal(hisPorWords(-0.5), 'his −0.5 over repl a week');
	assert.equal(hisPorWords(0.04), 'his 0.0 over repl a week');
	assert.equal(porFigure(0), '0.0');
	assert.equal(porFigure(-0.02), '0.0');
	assert.equal(porFigure(0.4), '+0.4');
	assert.equal(LINES.overRepl, 'over repl a week');
	assert.equal(LINES.toYourLineup, 'a week to your lineup');
});

void test('a trade says who gets whom and both gains plainly', () => {
	assert.equal(
		tradeDecision({ row: trade, team: 'Muttdogs' }),
		'Trade Kyren Williams and Jordan Mason to Muttdogs for Nico Collins. Your lineup gains 4.1 points over replacement a week, theirs 0.3.'
	);
	assert.equal(tradeDecision(null), 'No trade we found helps both lineups.');
	assert.equal(
		tradeDecision({
			row: {
				...trade,
				give: [line('Aaron Rodgers', 'QB', 12)],
				get: [line('Bhayshul Tuten'), line('Emeka Egbuka', 'WR', 20)],
				drop: line('Jaxson Dart', 'QB', 31)
			},
			team: 'Max_Jensen10'
		}),
		'Trade Aaron Rodgers to Max_Jensen10 for Bhayshul Tuten and Emeka Egbuka, and drop Jaxson Dart to make room. Your lineup gains 4.1 points over replacement a week, theirs 0.3.'
	);
	assert.equal(
		tradeGains({ my_gain: 5.93, their_gain: 0.03 }),
		'Your lineup gains 5.9 points over replacement a week, theirs under 0.1.'
	);
	assert.equal(
		teamAside({ name: 'Muttdogs', owner: 'muttdog', record: { wins: 5, losses: 0, ties: 0 } }),
		'muttdog, 5-0'
	);
	assert.equal(
		teamAside({ name: 'Muttdogs', owner: '', record: { wins: 2, losses: 2, ties: 1 } }),
		'2-2-1'
	);
	assert.equal(
		teamAside({
			name: 'Max_Jensen10',
			owner: 'Max_Jensen10',
			record: { wins: 1, losses: 4, ties: 0 }
		}),
		'1-4'
	);
	assert.equal(
		teamAside({
			name: 'Nacua Matata',
			owner: 'Rad_Thad1',
			record: { wins: 3, losses: 2, ties: 0 }
		}),
		'Rad_Thad1, 3-2'
	);
});

void test("a row's facts: the game on the member's own clock, the designation with its stamp, the last games", () => {
	const eastern = 'America/New_York';
	assert.equal(weekdayTime('2026-10-18T17:00:00.000Z', eastern), 'Sun 1:00 pm');
	assert.equal(weekdayTime('2026-10-18T17:00:00.000Z', 'America/Los_Angeles'), 'Sun 10:00 am');
	assert.equal(weekdayTime('2026-10-18T17:00:00.000Z', 'Europe/London'), 'Sun 6:00 pm');
	assert.equal(gameWords(facts(), eastern), 'at BUF Sun 1:00 pm');
	assert.equal(gameWords(facts(), 'America/Chicago'), 'at BUF Sun 12:00 pm');
	assert.equal(gameWords(facts({ home: true, kickoff: null })), 'vs BUF');
	assert.equal(gameWords(facts({ played: true })), 'at BUF, played');
	assert.equal(gameWords(facts({ bye: true, opponent: null })), 'Bye this week');
	assert.equal(
		designationWords({ status: 'questionable', as_of: '2026-10-15T20:10:00.000Z' }, eastern),
		'Questionable as of Thu 4:10 pm'
	);
	// The zone is named once on the screen, and only when it is not Eastern.
	assert.equal(zoneLine(eastern), null);
	assert.equal(zoneLine('America/Detroit'), null);
	assert.equal(zoneLine('America/Chicago'), 'Times are in Central Time.');
	assert.equal(zoneLine('America/Los_Angeles'), 'Times are in Pacific Time.');
	assert.equal(typeof memberZone(), 'string');
	assert.equal(noTradeWith('Josh Downs'), 'No trade we found includes Josh Downs.');
	assert.equal(
		lastGamesWords([
			{ week: 3, points: 18.4 },
			{ week: 4, points: 11.24 },
			{ week: 5, points: 9 }
		]),
		'Last 3: 18.4, 11.2, 9.0'
	);
	assert.equal(lastGamesWords([{ week: 5, points: 18.4 }]), 'Last game: 18.4');
	assert.equal(lastGamesWords([]), null);
	assert.equal(rankWords(line('Rachaad White')), 'RB14');
	assert.equal(rankWords(line('Rachaad White', 'RB', null)), null);
});

void test('the signed-out panel names the screen it is for', () => {
	assert.equal(signInTitle('start'), 'Sign in to see start and sit for your league');
	assert.equal(signInTitle('trades'), 'Sign in to see trades for your league');
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
		teamAside({ name: 'Muttdogs', owner: 'muttdog', record: { wins: 5, losses: 0, ties: 0 } }),
		NO_START_RULE,
		LATER_RULE,
		hisPorWords(-0.5),
		sharedDropWords(line('Jaxson Dart', 'QB', 31)),
		signInTitle('start'),
		signInTitle('waivers'),
		signInTitle('trades'),
		lineupDecision({
			set: false,
			slots: [
				slot('QB', 'Patrick Mahomes', 'Aaron Rodgers', true),
				slot('TE', 'Chig Okonkwo', 'Sam LaPorta', true),
				slot('FLEX', 'Travis Etienne', "Ja'Marr Chase", true)
			]
		}),
		tradeDecision({ row: { ...trade, drop: line('Jaxson Dart', 'QB', 31) }, team: 'Muttdogs' }),
		HELD,
		refreshedWords('rest_of_season', '2026-10-14T19:05:37.917Z'),
		refreshedWords('preseason', '2026-09-09T02:20:29.697Z'),
		gameWords(facts()),
		gameWords(facts({ bye: true, opponent: null })),
		designationWords({ status: 'pup', as_of: '2026-10-15T20:10:00.000Z' }),
		lastGamesWords([{ week: 5, points: 18.4 }]),
		hisPorWords(0.4),
		lineupTitle(6),
		addsTitle(6),
		startingCount(0),
		startingCount(2),
		showMore(2),
		...Object.values(TAB_LABELS),
		...Object.values(LINES),
		verbWords('start', 'espn'),
		settingWords('espn'),
		openHostWords('espn'),
		readingWords('espn'),
		lostWords('espn'),
		(failedStep(new TypeError('x'), 'espn', 'plan', '') as { sentence: string }).sentence,
		hostSaid('espn', 'Lineup transaction could not be completed, Alexander Mattison is locked'),
		...Object.values(MOVE_LINES),
		zoneLine('America/Chicago') ?? '',
		noTradeWith('Josh Downs'),
		verbWords('waivers', 'espn'),
		settingWords('espn', 'claim'),
		readingWords('espn', 'claim'),
		lostWords('espn', 'claim'),
		moveTitle('claim'),
		bidLabel({ amount: 0, min: 0, max: 87, left_known: true }),
		bidLabel({ amount: 0, min: 0, max: 500, left_known: false }),
		bidProblem('espn', '88', { amount: 0, min: 0, max: 87, left_known: true }) ?? '',
		resultWords(
			'espn',
			{
				outcome: 'pending',
				sentence: 'Claim submitted.',
				host_words: null,
				host_url: '',
				move_id: null,
				processes_at: '2026-10-21T07:00:00.000Z'
			},
			'America/Chicago'
		),
		readNowWords('sleeper'),
		READING_NOW
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

/** Every basis and sentence in an answer, however deep. */
function sentencesIn(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap(sentencesIn);
	if (typeof value !== 'object' || value === null) return [];
	return Object.entries(value).flatMap(([key, field]) =>
		(key === 'basis' ||
			key === 'basis_note' ||
			key === 'sentence' ||
			key === 'note' ||
			key === 'host_note') &&
		typeof field === 'string'
			? [field]
			: sentencesIn(field)
	);
}

void test("copy guard: the API's honesty lines and row sentences, as the fixture carries them, pass the same rules", () => {
	for (const name of ['lineup', 'waivers', 'trades']) {
		const url = new URL(`../../../../scripts/inseason-fixture/data/${name}.json`, import.meta.url);
		const said = sentencesIn(JSON.parse(readFileSync(url, 'utf8')) as unknown);
		assert.ok(said.length > 0, name);
		for (const text of said) {
			assert.doesNotMatch(text, BANNED, text);
			assert.doesNotMatch(text, DASH, text);
			assert.doesNotMatch(text, /;/, text);
			assert.doesNotMatch(text, DOUBLED_WORD, text);
		}
	}
});
