// Every surface that places a player by our rank, his position rank or his tier, beside the injury
// capture (Lane 63, round 3): run with `npm test`. Each surface's words for a held player carry no
// "rank N", "RB N" or "Tier N".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verdict, type Contender } from '#lib/site/verdict.ts';
import { withStatuses } from './board-status.ts';
import {
	availableTierOf,
	heldWord,
	leadOf,
	pillRank,
	positionRankShown,
	rankShown
} from './held-places.ts';
import type { BoardRow, Designations } from './schema.ts';
import { BUILT_ZONE, boardStatusWords } from './status-view.ts';

const PLACED = /rank \d|\b(QB|RB|WR|TE) \d|Tier \d/u;

function row(id: string, ourRank: number, positionRank: number, tier: number): BoardRow {
	return {
		id,
		slug: id,
		name: `Player ${id}`,
		position: 'RB',
		positionRank,
		team: 'MIA',
		headshot: 'https://example.com/a.png',
		ourRank,
		vorRound: 1,
		adp: 10,
		projected: 300 - ourRank,
		vor: 100 - ourRank,
		expectedGames: 15,
		floor: null,
		median: null,
		ceiling: null,
		tier
	};
}

const capture: Designations = {
	readAt: '2026-10-16T14:05:00.000Z',
	checkedAt: null,
	source: 'tank01_injuries_by_date',
	players: { held: { status: 'injured_reserve', seasonLong: true, since: null } }
};

const rows = withStatuses(
	[row('held', 3, 1, 1), row('next', 5, 2, 1), row('third', 9, 3, 2)],
	capture
);
const held = rows.find((r) => r.id === 'held');

void test('the players index prints the word for a held player’s ranks', () => {
	assert.ok(held);
	assert.equal(heldWord(held), 'IR');
	const line = `${held.position} ${String(positionRankShown(held))}, our rank ${rankShown(held)}`;
	assert.doesNotMatch(line, PLACED, line);
	assert.equal(rankShown(rows[0] ?? held), '5');
});

void test('a club’s lead is its first available player', () => {
	assert.equal(leadOf(rows)?.id, 'next');
	assert.equal(leadOf(rows.filter((r) => r.id === 'held')), null);
});

void test('tier mates leave a held player out, and he has no tier of his own', () => {
	const next = rows.find((r) => r.id === 'next');
	assert.ok(next && held);
	const group = availableTierOf(rows, next);
	assert.deepEqual(
		group?.rows.map((r) => r.id),
		['next']
	);
	assert.equal(availableTierOf(rows, held), null);
});

void test('the compare verdict never sets a held player’s places against another’s', () => {
	const ir: Contender = {
		id: 'a',
		name: 'De’Von Achane',
		ourRank: 8,
		vor: 97,
		held: 'injured_reserve'
	};
	const free: Contender = { id: 'b', name: 'Josh Jacobs', ourRank: 30, vor: 40, held: null };
	const one = verdict(ir, free, 'PPR');
	assert.equal(one.kind, 'call');
	assert.equal(one.leader.id, 'b');
	assert.equal(one.call, 'We would take Jacobs');
	assert.equal(
		one.evidence,
		'Achane is on injured reserve, so he sits below the available players on our PPR board.'
	);
	assert.doesNotMatch(one.evidence, /place/u);
	const both = verdict(ir, { ...free, held: 'pup' }, 'PPR');
	if (both.kind === 'call') {
		assert.match(both.evidence, /^Both are on season-long lists/u);
		assert.doesNotMatch(both.evidence, /places? higher/u);
	}
	const neither = verdict({ ...ir, held: null }, free, 'PPR');
	if (neither.kind === 'call')
		assert.match(
			neither.evidence,
			/^Achane is 8th on our PPR board and Jacobs 30th, with \+97\.0 over replacement against \+40\.0\.$/u
		);
});

void test('a club page, the ADP page and the offline board draw a held row by the word', () => {
	const words = boardStatusWords(rows, {
		capture: { readAt: capture.readAt, checkedAt: null },
		restOfSeason: false,
		zone: BUILT_ZONE,
		now: Date.parse(capture.readAt)
	});
	// The row's rank cell, its pill and the ADP cell's "Our rank" all print this word.
	assert.equal(words.rows.held?.rank, 'IR');
	assert.equal(words.rows.next, undefined);
	assert.ok(held);
	const offline = `${rankShown(held)} ${held.position} ${String(positionRankShown(held))}`;
	assert.doesNotMatch(offline, PLACED, offline);
});

void test('a league row and the matchup panel draw a held starter’s pill by the word', () => {
	const pill = (rank: number | string): string => `RB ${String(rank)}`;
	assert.equal(pill(pillRank({ rank: 'IR' }, 7)), 'RB IR');
	assert.doesNotMatch(pill(pillRank({ rank: 'IR' }, 7)), PLACED);
	assert.equal(pill(pillRank({ rank: null }, 7)), 'RB 7');
	assert.equal(pill(pillRank(null, 7)), 'RB 7');
});
