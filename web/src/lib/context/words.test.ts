// The context's words: the switch, a league's line, the basis line and the held mark. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { labelEnds, switchLabel, type ContextLeague } from './words.ts';
import { heldMark, holderWords } from './held-marks.ts';
import type { Held } from './held-words.ts';
import { contextNote } from './note-words.ts';
import { leagueLine } from './menu-words.ts';
import { clubCaption, clubsLead, scheduleLead } from '#lib/run/strength-words.ts';

/** The copy guard's doubled word: "the the", "is is". */
const DOUBLED_WORD = /\b(\w+)\s+\1\b/i;

const league = (over: Partial<ContextLeague> = {}): ContextLeague => ({
	id: '3f0c1a52-0000-4000-8000-000000000001',
	name: 'My Ball Zach Ertz',
	host: 'ffpc',
	team_name: 'Ertz Hurts',
	standing: null,
	scoring: 'ppr',
	format: 'ppr',
	settings_league_id: null,
	...over
});

void test('the switch names the league, else the format, else the default board', () => {
	assert.equal(switchLabel(league(), 'ppr'), 'My Ball Zach Ertz');
	assert.equal(switchLabel(league({ name: '' }), 'ppr'), 'Your FFPC league');
	assert.equal(switchLabel(null, 'half_ppr'), 'Half PPR');
	assert.equal(switchLabel(null, null), 'PPR');
});

void test("the switch keeps a league name's last word whole and cuts the head", () => {
	assert.deepEqual(labelEnds('Big Gorilla Tourney (Aug 15) #104870'), [
		'Big Gorilla Tourney (Aug 15)',
		' #104870'
	]);
	assert.deepEqual(labelEnds('PPR'), ['PPR', '']);
	assert.deepEqual(labelEnds('Severely Underappreciated'), ['Severely Underappreciated', '']);
});

void test("a league's line is its host and scoring, and superflex when it reads on that board", () => {
	assert.equal(leagueLine(league({ scoring: 'te_premium' })), 'FFPC, TE premium');
	assert.equal(
		leagueLine(league({ host: 'sleeper', scoring: 'half_ppr', format: 'superflex' })),
		'Sleeper, half PPR, superflex'
	);
});

void test('a TE premium league on the PPR board says it in plain words, and where exact rules rank it', () => {
	const te = league({ scoring: 'te_premium' });
	assert.equal(
		contextNote(te, 'ppr', false),
		"Your league gives tight ends extra points per catch. This board is plain PPR. The Draft Pass ranks it by your league's exact rules."
	);
	assert.equal(
		contextNote(te, 'ppr', false, 'These figures are'),
		"Your league gives tight ends extra points per catch. These figures are plain PPR. The Draft Pass ranks it by your league's exact rules."
	);
	assert.equal(
		contextNote({ ...te, settings_league_id: '3f0c1a52-0000-4000-8000-000000000009' }, 'ppr', true),
		"Your league gives tight ends extra points per catch. This board is plain PPR. Your league's exact board is in its mock draft."
	);
	assert.equal(
		contextNote(te, 'ppr', true),
		'Your league gives tight ends extra points per catch. This board is plain PPR.'
	);
});

void test('a format the run does not carry says so and names what the page is in', () => {
	assert.equal(
		contextNote(league({ scoring: 'half_ppr', format: 'half_ppr' }), 'ppr', false),
		'Your league scores half PPR. This run has no half PPR board, so this board is PPR.'
	);
});

void test('a link to another board the run carries says what this board is', () => {
	assert.equal(
		contextNote(league(), 'half_ppr', false, 'This board is', true),
		'Your league scores PPR. This board is half PPR.'
	);
});

void test('a matching league says its scoring, and no league says nothing', () => {
	assert.equal(contextNote(league(), 'ppr', false), 'Your league scores PPR.');
	assert.equal(
		contextNote(league({ format: 'superflex' }), 'superflex', false),
		'Your league scores PPR and starts a superflex.'
	);
	assert.equal(contextNote(null, 'ppr', false), null);
});

void test('a row marks your own players by your team and the free agents, never the taken', () => {
	const held: Held = {
		me: 4,
		teams: { 4: 'Ertz Hurts', 7: 'Gmoneyman', 9: '' },
		by: { a: 4, b: 7, c: 9 }
	};
	assert.deepEqual(heldMark(held, 'a'), { words: 'On Ertz Hurts', kind: 'mine' });
	assert.deepEqual(heldMark({ ...held, teams: { 4: '' } }, 'a'), {
		words: 'On your roster',
		kind: 'mine'
	});
	assert.equal(heldMark(held, 'b'), null);
	assert.deepEqual(heldMark(held, 'free'), { words: 'Free agent in your league', kind: 'free' });
});

void test('his page names whose roster he is on, or that he is a free agent', () => {
	const held: Held = {
		me: 4,
		teams: { 4: 'Ertz Hurts', 7: 'Gmoneyman', 9: '' },
		by: { a: 4, b: 7, c: 9 }
	};
	assert.equal(holderWords(held, 'a'), 'On your roster');
	assert.equal(holderWords(held, 'b'), 'Rostered by Gmoneyman');
	assert.equal(holderWords(held, 'c'), 'On a roster in your league');
	assert.equal(holderWords(held, 'free'), 'Free agent in your league');
});

void test("copy guard: no line doubles a word, the run's strength method included", () => {
	// The real run's method carries its own article; the pages once added a second ("the the").
	const slate = {
		method: "the average of its opponents' expected wins for the season, one per game",
		window: { from: '2026-09-07T12:00:00.000Z', to: '2026-09-07T12:00:00.000Z' },
		rank: 32
	};
	const lines = [
		scheduleLead(slate, 'Expected wins, set before the season', { count: 9, atLeast: '10.5' }, 5),
		clubsLead('PPR', slate),
		clubCaption(slate, 32),
		contextNote(league({ scoring: 'te_premium' }), 'ppr', false),
		contextNote(league({ scoring: 'half_ppr', format: 'half_ppr' }), 'ppr', false),
		leagueLine(league({ host: 'sleeper', scoring: 'half_ppr', format: 'superflex' }))
	];
	for (const line of lines) assert.doesNotMatch(line ?? '', DOUBLED_WORD, line ?? '');
	assert.match('Strength is the the average', DOUBLED_WORD);
});
