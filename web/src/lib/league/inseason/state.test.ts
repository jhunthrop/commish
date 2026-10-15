// The in-season screens' behaviour: the flag's gate, what each failed read shows, the page's view
// while its reads land, the narrowing that keeps only the latest answer, and a marked trade across
// a re-read. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '#lib/api/client.ts';
import type { PlayerLine, TradeRow, TradeTeam } from './api.ts';
import { screenOf } from './screens.ts';
import { Narrowing, markedTrade, readFailure, screenView, tradeKey } from './state.ts';
import { LINES } from './words.ts';

const ON = { in_season_tools: true };
const OFF = { in_season_tools: false };

const api = (status: number, message: string): ApiError =>
	new ApiError(status, { code: 'x', message });

void test('the three screens are pages only while the flag is on, and nothing else is', () => {
	assert.equal(screenOf('start', ON), 'start');
	assert.equal(screenOf('waivers', ON), 'waivers');
	assert.equal(screenOf('trades', ON), 'trades');
	assert.equal(screenOf('pool', ON), null);
	assert.equal(screenOf('start', OFF), null);
	assert.equal(screenOf('trades', OFF), null);
});

void test("a failed read with no answer yet prints the API's own sentence, whatever its status", () => {
	const noTeam = "We could not find your team in this league's last read.";
	assert.deepEqual(readFailure(api(404, noTeam), false), { kind: 'refused', sentence: noTeam });
	for (const status of [400, 409, 422, 502]) {
		assert.deepEqual(readFailure(api(status, `Sentence ${String(status)}.`), false), {
			kind: 'refused',
			sentence: `Sentence ${String(status)}.`
		});
	}
	assert.deepEqual(readFailure(new Error('boom'), false), {
		kind: 'refused',
		sentence: LINES.unreadable
	});
});

void test('a signed-out read asks for the sign-in, and a later failure keeps the last answer', () => {
	assert.deepEqual(readFailure(api(401, 'Sign in.'), false), { kind: 'signed-out' });
	assert.deepEqual(readFailure(api(401, 'Sign in.'), true), { kind: 'signed-out' });
	assert.deepEqual(readFailure(api(502, 'Sleeper is not answering.'), true), {
		kind: 'stale',
		sentence: LINES.lastRead
	});
});

void test('the page holds its rows while reads land and says which of its own reads failed', () => {
	const base = { leagues: 'done', known: true, board: 'done', answered: true } as const;
	assert.equal(screenView(base), 'ready');
	assert.equal(screenView({ ...base, answered: false }), 'loading');
	assert.equal(screenView({ ...base, board: 'pending' }), 'loading');
	assert.equal(screenView({ ...base, leagues: 'pending', known: false }), 'loading');
	assert.equal(screenView({ ...base, board: 'failed' }), 'board-failed');
	assert.equal(screenView({ ...base, leagues: 'failed', known: false }), 'leagues-failed');
	// Not on the account is said only once the account's leagues were read.
	assert.equal(screenView({ ...base, known: false }), 'missing');
});

void test('a narrowing keeps only the latest choice, and a failed one says the API sentence', async () => {
	const pending = new Map<string, (answer: string) => void>();
	const narrowing = new Narrowing<string, string>(
		(key) => new Promise((resolve) => pending.set(key, resolve))
	);
	const first = narrowing.choose('RB');
	const second = narrowing.choose('WR');
	pending.get('RB')?.('rb rows');
	pending.get('WR')?.('wr rows');
	assert.deepEqual(await first, { kind: 'overtaken' });
	assert.deepEqual(await second, { kind: 'answer', answer: 'wr rows' });
	assert.deepEqual(await narrowing.choose(null), { kind: 'all' });

	const refusing = new Narrowing<string, string>(() =>
		Promise.reject(api(400, 'That player is not on a roster in this league.'))
	);
	assert.deepEqual(await refusing.choose('x'), {
		kind: 'failed',
		sentence: 'That player is not on a roster in this league.'
	});
	const offline = new Narrowing<string, string>(() => Promise.reject(new Error('offline')));
	assert.deepEqual(await offline.choose('x'), { kind: 'failed', sentence: LINES.narrowingUnread });
});

const line = (id: string): PlayerLine => ({
	player: {
		host_id: id,
		board_id: id,
		name: id,
		position: 'WR',
		team: 'KC',
		injured_reserve: false
	},
	position_rank: 10,
	points_over_replacement: 0.5,
	held: false,
	facts: {
		week: 6,
		opponent: 'BUF',
		home: true,
		kickoff: null,
		bye: false,
		designation: null,
		played: false,
		points_this_week: null,
		last_games: [],
		allowed_to_position: null
	}
});

const row = (give: string[], get: string[], mine: number): TradeRow => ({
	give: give.map(line),
	get: get.map(line),
	my_gain: mine,
	their_gain: 0.6,
	close_for_them: false
});

const team = (trades: TradeRow[]): TradeTeam => ({
	roster_id: 4,
	name: 'Muttdogs',
	owner: 'muttdog',
	record: { wins: 5, losses: 0, ties: 0 },
	trades
});

void test('a marked trade is the same trade after a re-read reorders the team, and gone when it is', () => {
	const a = row(['p1'], ['q1', 'q2'], 2.1);
	const b = row(['p2'], ['q3'], 1.4);
	const key = tradeKey(4, b);
	assert.equal(key, tradeKey(4, row(['p2'], ['q3'], 9)));
	assert.equal(tradeKey(4, row(['p1'], ['q2', 'q1'], 0)), tradeKey(4, a));
	const reread = [team([row(['p2'], ['q3'], 2.5), a])];
	assert.equal(markedTrade(reread, key)?.row.my_gain, 2.5);
	assert.equal(markedTrade([team([a])], key), null);
	assert.equal(markedTrade(reread, null), null);
});
