// The context's words: the switch, a league's line, the basis line and the held mark. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextNote, heldMark, switchLabel, type ContextLeague, type Held } from './words.ts';
import { leagueLine } from './menu-words.ts';

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

void test("a league's line is its host and scoring, and superflex when it reads on that board", () => {
	assert.equal(leagueLine(league({ scoring: 'te_premium' })), 'FFPC, TE premium');
	assert.equal(
		leagueLine(league({ host: 'sleeper', scoring: 'half_ppr', format: 'superflex' })),
		'Sleeper, half PPR, superflex'
	);
});

void test('a TE premium league on the PPR board reads the founding line verbatim', () => {
	assert.equal(
		contextNote(league({ scoring: 'te_premium' }), 'ppr'),
		'Your league scores TE premium. This board is PPR until exact rules arrive with the Draft Pass.'
	);
	assert.equal(
		contextNote(league({ scoring: 'te_premium' }), 'ppr', 'These figures are'),
		'Your league scores TE premium. These figures are PPR until exact rules arrive with the Draft Pass.'
	);
});

void test('a format the run does not carry says so and names what the page is in', () => {
	assert.equal(
		contextNote(league({ scoring: 'half_ppr', format: 'half_ppr' }), 'ppr'),
		'Your league scores half PPR. This run has no half PPR board, so this board is PPR.'
	);
});

void test('a matching league says its scoring, and no league says nothing', () => {
	assert.equal(contextNote(league(), 'ppr'), 'Your league scores PPR.');
	assert.equal(
		contextNote(league({ format: 'superflex' }), 'superflex'),
		'Your league scores PPR and starts a superflex.'
	);
	assert.equal(contextNote(null, 'ppr'), null);
});

void test('the held mark names your roster, the team, or a roster when the name is unread', () => {
	const held: Held = {
		me: 4,
		teams: { 4: 'Ertz Hurts', 7: 'Gmoneyman', 9: '' },
		by: { a: 4, b: 7, c: 9 }
	};
	assert.deepEqual(heldMark(held, 'a'), { words: 'On your roster', mine: true });
	assert.deepEqual(heldMark(held, 'b'), { words: 'Rostered by Gmoneyman', mine: false });
	assert.deepEqual(heldMark(held, 'c'), { words: 'On a roster in your league', mine: false });
	assert.equal(heldMark(held, 'free'), null);
	assert.equal(heldMark(null, 'a'), null);
});
