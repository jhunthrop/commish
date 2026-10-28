// The Lineup screen's table, strip and verb words (Lane 66e): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIXTURE_WEEK_CLOCK } from '../../../../scripts/inseason-fixture/clock.ts';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { LineupSlot, PlayerLine, WeekFacts } from '../inseason/api.ts';
import { WEEK_DONE } from '../../../../scripts/inseason-fixture/sunday.ts';
import { BOX, boxRow } from './box.ts';
import {
	changesTitle,
	copiedLine,
	idleWords,
	rankWords,
	setOnWords,
	LINEUP,
	lineupBox,
	lineupSum,
	lineupText,
	stripSum,
	whyLine,
	heldLineup
} from './lineup.ts';

const ZONE = 'America/Chicago';
/** The fixture week's clock, Saturday noon Central: every Sunday game is still to be played. */
const NOW = Date.parse(FIXTURE_WEEK_CLOCK);
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
	const box = lineupBox(advice, ZONE, NOW);
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
		whyLine(boxRow(into, 'TE', ZONE, false, NOW), boxRow(out, 'Sit', ZONE, false, NOW), 'TE'),
		'Pitts is listed doubtful. Kincaid is the next TE with a Proj, 9.4.'
	);
	assert.equal(
		whyLine(boxRow(into, 'TE', ZONE, false, NOW), null, 'TE'),
		'Your TE spot is empty, so Kincaid starts.'
	);
	const noProj = line('Dalton Kincaid', 'TE', null);
	assert.equal(
		whyLine(boxRow(noProj, 'TE', ZONE, false, NOW), boxRow(out, 'Sit', ZONE, false, NOW), 'TE'),
		'Pitts is listed doubtful. Kincaid is next in our order, with no Proj this week.'
	);
});

void test('moves are marked: in on the lineup, Sit on the bench, the reserve apart', () => {
	const box = lineupBox(advice, ZONE, NOW);
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

void test('the Lineup strip names whose lineup its figure is, and once played gives its points (Lane 99, B11)', () => {
	const box = lineupBox(advice, ZONE, NOW);
	assert.deepEqual(lineupSum(box, 'espn', null), {
		figure: '34.1',
		words: 'Proj with them, 29.6 as set on ESPN',
		gain: '+4.5'
	});
	const set = lineupBox({ ...advice, slots: [slot('RB', irving, irving, false)] }, ZONE, NOW);
	assert.equal(lineupSum(set, 'espn', null)?.words, 'Proj as set on ESPN');
	const played = { ...box, totals: { ...box.totals, pts: 76.8 } };
	// Every starter final: the Pts with no Proj final beside them (Lane 118, B88).
	assert.deepEqual(lineupSum(played, 'espn', WEEK_DONE), {
		figure: '76.8',
		words: 'Pts as set on ESPN',
		gain: null,
		final: null
	});
	const playing = { ...played, playing: true, totals: { ...played.totals, final: 112.4 } };
	assert.equal(lineupSum(playing, 'espn', WEEK_DONE)?.final, 'Proj final 112.4');
	assert.equal(lineupSum(box, 'espn', WEEK_DONE), null, 'no points read, no figure');
	assert.equal(LINEUP.pastWeeks, 'Past weeks of our order');
});

void test("the Lineup's rows carry our rank in their chip, as the Matchup's do (Lane 99, B24)", () => {
	const box = lineupBox(advice, ZONE, NOW);
	for (const row of [...box.starters.map((s) => s.row), ...box.bench.map((b) => b.row)]) {
		if (row.pill !== null) assert.equal(row.pill.rank, 7, row.name);
	}
});

void test('the gain compares the advice with the lineup as the platform has it set now', () => {
	const box = lineupBox(advice, ZONE, NOW);
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
	const set = lineupBox({ ...advice, slots: [slot('RB', irving, irving, false)] }, ZONE, NOW);
	assert.deepEqual(stripSum(set), { figure: '12.8', words: 'Proj as set', gain: null });
	assert.equal(
		stripSum(lineupBox({ ...advice, projection_read_at: null, slots: [] }, ZONE, NOW)),
		null
	);
});

void test('the copy verb puts the lineup on the clipboard and says to set it on the platform page', () => {
	assert.equal(
		lineupText(lineupBox(advice, ZONE, NOW), 6),
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
		whyLine(boxRow(hard, 'QB', ZONE, false, NOW), boxRow(rodgers, 'Sit', ZONE, false, NOW), 'QB'),
		"20.6 Proj against Rodgers's 15.8, vs NO, 3rd toughest against quarterbacks."
	);
	const defense = line('Saints D/ST', 'DEF', 6.9, { opponent: 'NYG' });
	const vikings = line('Vikings D/ST', 'DEF', 5.1);
	assert.equal(
		whyLine(
			boxRow(defense, 'D/ST', ZONE, false, NOW),
			boxRow(vikings, 'Sit', ZONE, false, NOW),
			'D/ST'
		),
		"6.9 Proj against Vikings's 5.1, at NYG.",
		'a defense has no rank, so the line says nothing of one'
	);
	const pup = line('Kyle Pitts Sr.', 'TE', 11.4, { designation: { status: 'pup', as_of: READ } });
	assert.match(
		whyLine(
			boxRow(line('Dalton Kincaid', 'TE', 9.4), 'TE', ZONE, false, NOW),
			boxRow(pup, 'Sit', ZONE, false, NOW),
			'TE'
		),
		/^Pitts is on a season-long list, PUP\. /
	);
});

void test('a spot no one who can play fills keeps his player, counts 0 and says so in the strip', () => {
	const pitts = line('Kyle Pitts Sr.', 'TE', 11.4, { bye: true, opponent: null });
	const idle: LineupSlot = { ...slot('TE', pitts, pitts, false), no_one_can_play: true };
	const box = lineupBox({ ...advice, slots: [...advice.slots, idle] }, ZONE, NOW);
	assert.equal(box.starters.at(-1)?.idle, true);
	assert.deepEqual(box.idle, ['TE: no one on your roster can play this week']);
	assert.equal(idleWords('TE'), 'TE: no one on your roster can play this week');
	assert.equal(box.totals.proj, 34.1, 'the spot counts 0 in the advice');
	assert.equal(box.asSet, 29.6, 'and 0 as set');
	assert.equal(box.gain, 4.5);
});

/** The site's copy guard. */
const BANNED = bannedPattern();

void test('copy guard: every Lineup word is fantasy words, names the platform, no dash or semicolon', () => {
	const box = lineupBox(advice, ZONE, NOW);
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
	}
});

void test('a spot empty on the platform that no one can play is a row with no player and a chip (review N2)', () => {
	const box = lineupBox({ ...advice, empty_slots: ['TE'] }, ZONE, NOW);
	assert.deepEqual(box.empty, ['TE']);
	assert.deepEqual(box.idle, ['TE: no one on your roster can play this week']);
	assert.equal(box.totals.proj, 34.1, 'the empty spot counts 0');
	assert.equal(LINEUP.noOneHere, 'No one on your roster can play here this week');
});

void test('the lineup is drawn at the clock it is handed: past the kickoff it says no game facts (Lane 77)', () => {
	const total = { game_total: { points: 49.5, team_points: 26.5, read_at: READ } };
	const sunday = line('Caleb Williams', 'QB', 18.5, total);
	const lined = { ...advice, slots: [slot('QB', sunday, sunday, false)], bench: [], reserve: [] };
	assert.equal(lineupBox(lined, ZONE, NOW).starters[0]?.row.expected, '26.5 to 23');
	const kicked = Date.parse('2026-10-18T17:00:00.000Z');
	assert.equal(lineupBox(lined, ZONE, kicked).starters[0]?.row.expected, null);
});

void test('no move is drawn on a row whose game has kicked off or is final (Lane 85)', () => {
	const kicked = { ...williams, facts: { ...williams.facts, game_state: 'kicked_off' as const } };
	const monday = {
		...advice,
		set: false,
		slots: [
			slot('QB', kicked, stroud, true),
			slot('RB', irving, irving, false),
			slot('RB', vidal, gibbs, true)
		]
	};
	const held = heldLineup(monday, NOW);
	assert.deepEqual(
		held.slots.map((s) => [s.slot, s.ours.player.name, s.changed]),
		[
			['QB', 'C.J. Stroud', false],
			['RB', 'Bucky Irving', false],
			['RB', 'Kimani Vidal', true]
		]
	);
	assert.equal(held.slots[0]?.sentence, null);
	// The advised starter goes back to the bench, the platform's starter stays where it has him.
	assert.deepEqual(
		held.bench.map((l) => l.player.name),
		['Jahmyr Gibbs', 'Caleb Williams']
	);
	assert.equal(held.set, false);
	const box = lineupBox(held, ZONE, NOW);
	assert.deepEqual(
		box.swaps.map((s) => s.in),
		['Vidal']
	);
	assert.deepEqual(
		box.starters.map((s) => s.move),
		[null, null, 'in']
	);
	// A platform starter sat by a change whose game is final holds his spot too.
	const final = (l: PlayerLine): PlayerLine => ({
		...l,
		facts: { ...l.facts, played: true, game_state: 'final' }
	});
	const tuesday = heldLineup(
		{ ...advice, set: false, slots: [slot('QB', final(williams), final(stroud), true)] },
		NOW
	);
	assert.equal(tuesday.set, true);
	assert.equal(tuesday.slots[0]?.ours.player.name, 'C.J. Stroud');
	assert.equal(lineupBox(tuesday, ZONE, NOW).swaps.length, 0);
	// A change into an empty spot whose player has kicked off leaves the spot empty, and says so: never
	// that no one could play there (review L2).
	const empty = heldLineup({ ...advice, set: false, slots: [slot('QB', kicked, null, true)] }, NOW);
	assert.deepEqual(empty.slots, []);
	assert.deepEqual(empty.empty_slots, []);
	assert.deepEqual(empty.held_empty, [{ slot: 'QB', name: 'Williams' }]);
	const emptyBox = lineupBox(empty, ZONE, NOW);
	assert.deepEqual(emptyBox.idle, ['QB: Williams has kicked off, the spot stays empty']);
	assert.deepEqual(emptyBox.empty, ['QB']);
	// A flex chain undone places each player once (review L1): Williams moved from QB to the
	// superflex and Stroud into QB, both games kicked off.
	const stroudKicked = { ...stroud, facts: { ...stroud.facts, game_state: 'kicked_off' as const } };
	const chain = heldLineup(
		{
			...advice,
			set: false,
			slots: [slot('QB', stroudKicked, kicked, true), slot('SUPERFLEX', kicked, irving, true)],
			bench: [irving]
		},
		NOW
	);
	const ids = [
		...chain.slots.map((s) => s.ours.player.name),
		...chain.bench.map((l) => l.player.name)
	];
	assert.deepEqual(ids.toSorted(), [...new Set(ids)].toSorted());
	assert.deepEqual(
		chain.slots.map((s) => s.ours.player.name),
		['Caleb Williams', 'Bucky Irving']
	);
	assert.deepEqual(
		chain.bench.map((l) => l.player.name),
		['C.J. Stroud']
	);
	// Nothing locked: the answer as it came.
	const untouched = { ...advice, set: false };
	assert.deepEqual(heldLineup(untouched, NOW), { ...untouched, held_empty: [] });
});

void test('every starter played takes the strip: no sum, the API sentence', () => {
	const done = WEEK_DONE;
	// The API's sentence (words.go WeekDoneWords) passes the one copy guard.
	assert.doesNotMatch(done, BANNED, done);
	const box = lineupBox(advice, ZONE, NOW);
	assert.equal(stripSum(box, done), null);
	assert.notEqual(stripSum(box, null), null);
	assert.equal(changesTitle(0, null), LINEUP.set);
});

void test('Locked while the matchup still plays, Final once it is, Final from the previous API (Lane 91)', () => {
	assert.equal(changesTitle(0, WEEK_DONE, 'locked'), BOX.locked);
	assert.equal(changesTitle(0, WEEK_DONE, 'final'), BOX.final);
	// An answer with the sentence and no state, from the API before Lane 91, says Final as it did.
	assert.equal(changesTitle(0, WEEK_DONE, null), BOX.final);
	assert.equal(changesTitle(0, WEEK_DONE), BOX.final);
	// No sentence, no state word: the changes as before.
	assert.equal(changesTitle(2, null, null), 'Two changes');
	assert.equal(BOX.locked, 'Locked');
});

void test('a partly locked chain places each player once (review L-A)', () => {
	// QB: Williams in for Stroud, Williams kicked off, so undone; SFlex: Stroud in for Irving, still to
	// play. Undoing QB hands Stroud back to QB, so the SFlex change goes too.
	const kicked = { ...williams, facts: { ...williams.facts, game_state: 'kicked_off' as const } };
	const held = heldLineup(
		{
			...advice,
			set: false,
			slots: [slot('QB', kicked, stroud, true), slot('SUPERFLEX', stroud, irving, true)],
			bench: [kicked]
		},
		NOW
	);
	const placed = [
		...held.slots.map((s) => s.ours.player.name),
		...held.bench.map((l) => l.player.name)
	];
	assert.equal(placed.length, new Set(placed).size, placed.join(', '));
	assert.deepEqual(
		held.slots.map((s) => [s.slot, s.ours.player.name, s.changed]),
		[
			['QB', 'C.J. Stroud', false],
			['SUPERFLEX', 'Bucky Irving', false]
		]
	);
});
