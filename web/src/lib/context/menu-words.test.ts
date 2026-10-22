// The switch's menu names each league's phase beside it only when the account's leagues differ
// (spec 2026-10-16 §2). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FOLLOW_ANOTHER, menuLast, phaseWords } from './menu-words.ts';
import type { ContextLeague } from './words.ts';

const EASTERN = 'America/New_York';
const NOW = new Date('2026-10-15T16:00:00.000Z');

const league = (id: string, over: Partial<ContextLeague>): ContextLeague => ({
	id,
	name: id,
	host: 'sleeper',
	team_name: '',
	standing: null,
	scoring: 'ppr',
	format: 'ppr',
	settings_league_id: null,
	phase: 'in_season',
	phase_basis: '',
	draft_at: null,
	playoff_start_week: 15,
	waivers_open: true,
	...over
});

void test('leagues in one phase say nothing beside their names', () => {
	const words = phaseWords([league('a', {}), league('b', {})], NOW, EASTERN);
	assert.equal(words.size, 0);
	assert.equal(phaseWords([league('a', {})], NOW, EASTERN).size, 0);
});

void test('leagues in different phases each say theirs', () => {
	const words = phaseWords(
		[
			league('a', {}),
			league('b', { phase: 'draft_day', draft_at: '2026-10-15T23:00:00.000Z' }),
			league('c', { phase: 'playoffs' })
		],
		NOW,
		EASTERN
	);
	assert.equal(words.get('a'), 'Drafted');
	assert.equal(words.get('b'), 'Draft today 7:00 pm');
	assert.equal(words.get('c'), 'Playoffs');
});

void test("the menu's last row follows another league only for an account that may", () => {
	assert.equal(FOLLOW_ANOTHER, 'Follow another league');
	assert.equal(menuLast(0, false), 'follow-first');
	assert.equal(menuLast(2, true), 'follow-another');
	// An account that may follow no more gets no row, and nothing says what more leagues come with.
	assert.equal(menuLast(1, false), null);
});
