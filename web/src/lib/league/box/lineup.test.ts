// The Lineup screen's table, strip and verb words (Lane 66e): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LineupSlot, PlayerLine, WeekFacts } from '../inseason/api.ts';
import { boxRow } from './box.ts';
import {
	changesTitle,
	copiedLine,
	idleWords,
	rankWords,
	setOnWords,
	LINEUP,
	lineupBox,
	lineupText,
	stripSum,
	whyLine
} from './lineup.ts';

const ZONE = 'America/Chicago';
const READ = '2026-10-17T02:00:00.000Z';

const facts = (over: Partial<WeekFacts> = {}): WeekFacts => ({
	week: 6,
	opponent: 'ATL',
	home: false,
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
	over: Partial<WeekFacts> = {},
	oppRank: number | null = null
): PlayerLine => ({
	player: { host_id: name, board_id: name, name, position, team: 'CHI', injured_reserve: false },
	headshot: null,
	slug: null,
	position_rank: 7,
	points_over_replacement: null,
	rest_of_season_per_game: null,
	week_projection: proj,
	projection_delta: null,
	opp_rank: oppRank,
	season_avg: null,
	last_points: null,
	held: false,
	facts: facts(over)
});

const QUESTIONABLE = { designation: { status: 'questionable' as const, as_of: READ } };
const williams = line('Caleb Williams', 'QB', 18.5, QUESTIONABLE, 24);
const stroud = line('C.J. Stroud', 'QB', 16.8, { opponent: 'JAX' }, 9);
const irving = line('Bucky Irving', 'RB', 12.8);
const vidal = line('Kimani Vidal', 'RB', 2.8, { opponent: 'KC' });
const gibbs = line('Jahmyr Gibbs', 'RB', null, { bye: true, opponent: null });
const brown = line('A.J. Brown', 'WR', null);

const slot = (
	s: LineupSlot['slot'],
	ours: PlayerLine,
	host: PlayerLine | null,
	changed: boolean
): LineupSlot => ({ slot: s, ours, host, changed, no_one_can_play: false, sentence: null });

const advice = {
	slots: [
		slot('QB', williams, stroud, true),
		slot('RB', irving, irving, false),
		slot('RB', vidal, gibbs, true)
	],
	bench: [stroud, gibbs],
	reserve: [brown],
	empty_slots: [] as LineupSlot['slot'][],
	player_points: false,
	team_points: null,
	projection_read_at: READ,
	week: 6
};

void test('the swap opens to one evidence line built from its columns', () => {
	const box = lineupBox(advice, ZONE);
	assert.equal(
		box.starters[0]?.why,
		"18.5 Proj against Stroud's 16.8, Questionable, at ATL, 24th, among the easiest for quarterbacks."
	);
	assert.equal(box.starters[1]?.why, null);
	assert.equal(box.starters[2]?.why, 'Gibbs is on bye. Vidal is the next RB with a Proj, 2.8.');
});

void test('a starter a designation sits is named first, a lowercase word in the sentence', () => {
	const out = line('Kyle Pitts Sr.', 'TE', 11.4, {
		designation: { status: 'doubtful', as_of: READ }
	});
	const into = line('Dalton Kincaid', 'TE', 9.4);
	assert.equal(
		whyLine(boxRow(into, 'TE', ZONE, false), boxRow(out, 'Sit', ZONE, false), 'TE'),
		'Pitts is listed doubtful. Kincaid is the next TE with a Proj, 9.4.'
	);
	assert.equal(
		whyLine(boxRow(into, 'TE', ZONE, false), null, 'TE'),
		'Your TE spot is empty, so Kincaid starts.'
	);
	const noProj = line('Dalton Kincaid', 'TE', null);
	assert.equal(
		whyLine(boxRow(noProj, 'TE', ZONE, false), boxRow(out, 'Sit', ZONE, false), 'TE'),
		'Pitts is listed doubtful. Kincaid is next in our order, with no Proj this week.'
	);
});

void test('moves are marked: in on the lineup, Sit on the bench, the reserve apart', () => {
	const box = lineupBox(advice, ZONE);
	assert.deepEqual(
		box.starters.map((s) => s.move),
		['in', null, 'in']
	);
	assert.deepEqual(
		box.bench.map((b) => [b.row.slot, b.move]),
		[
			['Sit', 'out'],
			['Sit', 'out']
		]
	);
	assert.ok(box.bench.every((b) => b.row.slot !== 'Out'));
	assert.deepEqual(
		box.reserve.map((r) => r.name),
		['A.J. Brown']
	);
	assert.deepEqual(
		box.swaps.map((s) => [s.slot, s.in, s.out]),
		[
			['QB', 'Williams', 'Stroud'],
			['RB', 'Vidal', 'Gibbs']
		]
	);
});

void test('the gain compares the advice with the lineup as the platform has it set now', () => {
	const box = lineupBox(advice, ZONE);
	assert.equal(box.totals.proj, 34.1);
	// Stroud 16.8, Irving 12.8, Gibbs on bye with none.
	assert.equal(box.asSet, 29.6);
	assert.equal(box.gain, 4.5);
	assert.deepEqual(stripSum(box), {
		figure: '34.1',
		words: 'Proj with them, 29.6 as set',
		gain: '+4.5'
	});
	assert.equal(changesTitle(box.swaps.length), 'Two changes');
	assert.equal(changesTitle(1), 'One change');
	assert.equal(changesTitle(0), 'Your lineup is set');
	const set = lineupBox({ ...advice, slots: [slot('RB', irving, irving, false)] }, ZONE);
	assert.deepEqual(stripSum(set), { figure: '12.8', words: 'Proj as set', gain: null });
	assert.equal(stripSum(lineupBox({ ...advice, projection_read_at: null, slots: [] }, ZONE)), null);
});

void test('the copy verb puts the lineup on the clipboard and says to set it on the platform page', () => {
	assert.equal(
		lineupText(lineupBox(advice, ZONE), 6),
		'Week 6 lineup\nQB Caleb Williams\nRB Bucky Irving\nRB Kimani Vidal'
	);
	assert.deepEqual(copiedLine('sleeper', true), {
		said: 'Copied.',
		page: "Sleeper's lineup page"
	});
	assert.deepEqual(copiedLine('yahoo', false), {
		said: 'This browser would not copy it.',
		page: "Yahoo's lineup page"
	});
	assert.equal(setOnWords('espn'), 'Lineup set on ESPN');
});

void test("the opponent's rank says its direction, one rule for both ends", () => {
	assert.equal(rankWords(3, 32, 'quarterbacks'), '3rd toughest against quarterbacks');
	assert.equal(rankWords(31, 32, 'receivers'), '31st, among the easiest for receivers');
	assert.equal(rankWords(12, 32, 'receivers'), '12th of 32 against receivers');
	assert.equal(rankWords(12, null, 'tight ends'), '12th of 32 against tight ends');
	const hard = line('Jaxson Dart', 'QB', 20.6, { opponent: 'NO', home: true }, 3);
	const rodgers = line('Aaron Rodgers', 'QB', 15.8);
	assert.equal(
		whyLine(boxRow(hard, 'QB', ZONE, false), boxRow(rodgers, 'Sit', ZONE, false), 'QB'),
		"20.6 Proj against Rodgers's 15.8, vs NO, 3rd toughest against quarterbacks."
	);
	const defense = line('Saints D/ST', 'DEF', 6.9, { opponent: 'NYG' });
	const vikings = line('Vikings D/ST', 'DEF', 5.1);
	assert.equal(
		whyLine(boxRow(defense, 'D/ST', ZONE, false), boxRow(vikings, 'Sit', ZONE, false), 'D/ST'),
		"6.9 Proj against Vikings's 5.1, at NYG.",
		'a defense has no rank, so the line says nothing of one'
	);
	const pup = line('Kyle Pitts Sr.', 'TE', 11.4, { designation: { status: 'pup', as_of: READ } });
	assert.match(
		whyLine(
			boxRow(line('Dalton Kincaid', 'TE', 9.4), 'TE', ZONE, false),
			boxRow(pup, 'Sit', ZONE, false),
			'TE'
		),
		/^Pitts is on a season-long list, PUP as of Oct \d+\. /
	);
});

void test('a spot no one who can play fills keeps his player, counts 0 and says so in the strip', () => {
	const pitts = line('Kyle Pitts Sr.', 'TE', 11.4, { bye: true, opponent: null });
	const idle: LineupSlot = { ...slot('TE', pitts, pitts, false), no_one_can_play: true };
	const box = lineupBox({ ...advice, slots: [...advice.slots, idle] }, ZONE);
	assert.equal(box.starters.at(-1)?.idle, true);
	assert.deepEqual(box.idle, ['TE: no one on your roster can play this week']);
	assert.equal(idleWords('TE'), 'TE: no one on your roster can play this week');
	assert.equal(box.totals.proj, 34.1, 'the spot counts 0 in the advice');
	assert.equal(box.asSet, 29.6, 'and 0 as set');
	assert.equal(box.gain, 4.5);
});

const BANNED =
	/\b(market|prices?|buy|sell|stock|odds|lines?|spreads?|favou?red|underdog|bets?|betting|vegas|host)\b/i;

void test('copy guard: every Lineup word is fantasy words, names the platform, no dash or semicolon', () => {
	const box = lineupBox(advice, ZONE);
	const said = [
		...Object.values(LINEUP),
		...box.starters.flatMap((s) => (s.why ? [s.why] : [])),
		copiedLine('espn', true).said,
		copiedLine('espn', false).said,
		copiedLine('espn', true).page,
		setOnWords('espn'),
		idleWords('TE'),
		rankWords(3, 32, 'quarterbacks'),
		rankWords(31, 32, 'receivers'),
		lineupText(box, 6),
		stripSum(box)?.words ?? ''
	];
	for (const text of said) {
		assert.doesNotMatch(text, /\bpaste\b/i, text);
		assert.doesNotMatch(text, BANNED, text);
		assert.doesNotMatch(text, /[–—;]/, text);
	}
});

void test('a spot empty on the platform that no one can play is a row with no player and a chip (review N2)', () => {
	const box = lineupBox({ ...advice, empty_slots: ['TE'] }, ZONE);
	assert.deepEqual(box.empty, ['TE']);
	assert.deepEqual(box.idle, ['TE: no one on your roster can play this week']);
	assert.equal(box.totals.proj, 34.1, 'the empty spot counts 0');
	assert.equal(LINEUP.noOneHere, 'No one on your roster can play here this week');
});
