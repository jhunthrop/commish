// A member's league chip parts alike names by record or size: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chipLabel, chipWords } from './league-words.ts';

void test('an FFPC league carries the member record as FFPC writes it, tightened', () => {
	const league = { league_id: '1', name: 'Big Gorilla', team_name: 'Ertz', record: '2 - 3' };
	assert.equal(chipWords(league), 'Big Gorilla, 2-3');
	assert.equal(chipLabel(league), 'Big Gorilla, as Ertz, 2-3');
});

void test('a Yahoo league carries its size and, read aloud, its scoring', () => {
	const league = {
		league_id: '128934',
		name: 'The Commish Classic',
		team_name: 'Gridiron Gurus',
		record: '',
		teams: 10,
		scoring_type: 'head to head',
		attached: false
	};
	assert.equal(chipWords(league), 'The Commish Classic, 10 teams');
	assert.equal(chipLabel(league), 'The Commish Classic, as Gridiron Gurus, 10 teams, head to head');
});

void test('an ESPN league says whether it is public or private where it was checked', () => {
	const league = {
		league_id: '1081607624',
		name: 'Sunday Crew',
		team_name: 'Hunt',
		record: '',
		teams: 10
	};
	assert.equal(chipWords({ ...league, public: true }), 'Sunday Crew, 10 teams, public');
	assert.equal(chipLabel({ ...league, public: false }), 'Sunday Crew, as Hunt, 10 teams, private');
	assert.equal(chipWords(league), 'Sunday Crew, 10 teams');
});

void test('a league with nothing to part it is its name', () => {
	assert.equal(chipWords({ league_id: '1', name: 'Solo', team_name: '', record: '' }), 'Solo');
});
