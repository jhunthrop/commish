// Every league's Lineup on one page (Lane 257): each league's block from its lineup at the page's
// clock, the one verb planning then making each league's move in turn through its own calls, a failure
// in one league never stopping the next, and every sentence the page prints. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ApiError } from '#lib/api/client.ts';
import { FIXTURE_WEEK_CLOCK } from '../../../../scripts/inseason-fixture/clock.ts';
import type { LeagueHost } from '../api.ts';
import type { HostMoveInput, HostMovePlan, HostMoveResult, LineupAdvice } from './api.ts';
import {
	EVERY,
	NONE_READY,
	closeEvery,
	confirmEveryWords,
	everyLine,
	everyOutcome,
	everyReport,
	lineupBlock,
	makeEvery,
	planEvery,
	readingEveryWords,
	readyEntries,
	setEveryWords,
	settingEveryWords,
	type Movable,
	type MoveEntry
} from './every-lineup.ts';
import { makeMove, planMove, type MoveCalls, type MoveHost, type MoveStep } from './move.ts';
import { BANNED_MARKS, BANNED_WORDS } from '#lib/format/copy-guard.ts';

const recorded = JSON.parse(
	readFileSync(
		new URL('../../../../scripts/inseason-fixture/data/lineup.json', import.meta.url),
		'utf8'
	)
) as LineupAdvice;
const NOW = Date.parse(FIXTURE_WEEK_CLOCK);
const ZONE = 'America/New_York';
const OPEN: LineupAdvice['moves'] = {
	lineup: 'available',
	note: null,
	takes_writes: true,
	writes_on: true,
	reason: null
};
const espn: LineupAdvice = { ...recorded, moves: OPEN };
const set: LineupAdvice = {
	...espn,
	set: true,
	slots: espn.slots.map((slot) => ({ ...slot, changed: false }))
};
const CHANGES = recorded.slots.filter((slot) => slot.changed).length;

void test("a league's block is what its own Lineup draws at the same clock", () => {
	assert.deepEqual(lineupBlock(espn, NOW, ZONE), { kind: 'here', changes: CHANGES });
	// Sleeper takes no lineup from here: the changes are the member's to set there.
	assert.deepEqual(lineupBlock(recorded, NOW, ZONE), { kind: 'elsewhere', changes: CHANGES });
	assert.deepEqual(lineupBlock(set, NOW, ZONE), { kind: 'set' });
	const done = { ...espn, week_done: 'Every starter of yours has played.' };
	assert.deepEqual(lineupBlock(done, NOW, ZONE), { kind: 'done', line: done.week_done });
	// Once every changed row's game has kicked off, nothing is left to change.
	assert.deepEqual(lineupBlock(espn, Date.parse('2026-10-27T12:00:00.000Z'), ZONE), {
		kind: 'set'
	});
});

const PLAN: HostMovePlan = {
	status: 'ready',
	sentence: 'Start Rachaad White over Tank Bigsby at RB, on ESPN now.',
	confirm: 'token',
	host_url: '',
	bid: null
} as HostMovePlan;
const DONE: HostMoveResult = {
	outcome: 'done',
	sentence: 'Set on ESPN. Your lineup there now reads as ours.',
	host_words: null,
	host_url: '',
	processes_at: null
} as HostMoveResult;
const REFUSED: HostMoveResult = {
	...DONE,
	outcome: 'refused',
	sentence: 'ESPN did not make the move, so nothing changed there.',
	host_words: 'Lineup transaction could not be completed'
};

/** A league's mover over its calls, as the page's blocks hold one, logging each call in turn. */
function fakeMover(
	id: string,
	log: string[],
	answers: { plan: () => Promise<HostMovePlan>; make: () => Promise<HostMoveResult> }
): Movable {
	const calls: MoveCalls = {
		plan: async (move) => {
			log.push(`plan ${id} ${String(move.changes.length)}`);
			return answers.plan();
		},
		make: async (_move, confirm) => {
			log.push(`make ${id} ${confirm}`);
			return answers.make();
		},
		reread: () => log.push(`reread ${id}`)
	};
	let planned: HostMoveInput | null = null;
	const mover = {
		step: { kind: 'closed' } as MoveStep,
		async open(move: HostMoveInput, at: MoveHost) {
			planned = move;
			mover.step = await planMove(calls, move, at);
		},
		async confirm(at: MoveHost) {
			if (mover.step.kind !== 'confirm' || planned === null) return;
			mover.step = await makeMove(calls, planned, mover.step.plan, at);
		},
		close() {
			mover.step = { kind: 'closed' };
		}
	};
	return mover;
}

const entry = (id: string, mover: Movable, host: LeagueHost = 'espn'): MoveEntry => ({
	id,
	mover,
	advice: espn,
	now: NOW,
	host
});

void test('the one verb plans each league in turn, then makes each with its own token', async () => {
	const log: string[] = [];
	const ok = { plan: () => Promise.resolve(PLAN), make: () => Promise.resolve(DONE) };
	const entries = [entry('a', fakeMover('a', log, ok)), entry('b', fakeMover('b', log, ok))];
	await planEvery(entries);
	assert.deepEqual(log, [`plan a ${String(CHANGES)}`, `plan b ${String(CHANGES)}`]);
	assert.equal(readyEntries(entries).length, 2);
	await makeEvery(entries);
	assert.deepEqual(log.slice(2), ['make a token', 'reread a', 'make b token', 'reread b']);
	assert.deepEqual(everyOutcome(entries), { set: 2, unchanged: 0 });
	assert.equal(everyReport(everyOutcome(entries)), 'Set in 2 leagues.');
	closeEvery(entries);
	assert.ok(entries.every((e) => e.mover.step.kind === 'closed'));
});

void test('a failure or a refusal in one league never stops the others', async () => {
	const log: string[] = [];
	const failing = {
		plan: () =>
			Promise.reject(
				new ApiError(502, { code: 'host_failed', message: 'ESPN could not be read just now.' })
			),
		make: () => Promise.resolve(DONE)
	};
	const refusing = { plan: () => Promise.resolve(PLAN), make: () => Promise.resolve(REFUSED) };
	const ok = { plan: () => Promise.resolve(PLAN), make: () => Promise.resolve(DONE) };
	const entries = [
		entry('a', fakeMover('a', log, failing)),
		entry('b', fakeMover('b', log, refusing)),
		entry('c', fakeMover('c', log, ok))
	];
	await planEvery(entries);
	assert.equal(entries[0]?.mover.step.kind, 'failed');
	assert.deepEqual(
		readyEntries(entries).map((e) => e.id),
		['b', 'c']
	);
	await makeEvery(entries);
	// The failed plan is never made; the refusal says so in its league and the next is still made.
	assert.ok(!log.includes('make a token'));
	assert.ok(log.includes('make c token'));
	assert.deepEqual(everyOutcome(entries), { set: 1, unchanged: 2 });
	assert.equal(
		everyReport(everyOutcome(entries)),
		'Set in 1 league. 2 did not change. Each says why below.'
	);
});

void test('a move whose answer never came back is not counted as set', async () => {
	const log: string[] = [];
	const lost = {
		plan: () => Promise.resolve(PLAN),
		make: () => Promise.reject(new TypeError('network'))
	};
	const entries = [entry('a', fakeMover('a', log, lost))];
	await planEvery(entries);
	await makeEvery(entries);
	const step = entries[0]?.mover.step;
	assert.equal(step?.kind, 'failed');
	assert.deepEqual(everyOutcome(entries), { set: 0, unchanged: 1 });
	assert.equal(everyReport(everyOutcome(entries)), 'Nothing changed. Each league says why below.');
});

void test("the page's words", () => {
	assert.equal(everyLine(4, 2, []), 'Changes in 2 of your 4 leagues.');
	assert.equal(
		everyLine(4, 2, ['sleeper']),
		'Changes in 3 of your 4 leagues. 1 more to set on Sleeper yourself.'
	);
	assert.equal(
		everyLine(3, 0, ['sleeper', 'yahoo']),
		'Changes in 2 of your 3 leagues. 2 to set on Sleeper and Yahoo yourself.'
	);
	assert.equal(everyLine(3, 0, []), EVERY.allSet);
	assert.equal(everyLine(2, 2, []), 'Changes in both of your leagues.');
	assert.equal(
		everyLine(4, 3, ['sleeper']),
		'Changes in all 4 of your leagues. 1 more to set on Sleeper yourself.'
	);
	assert.equal(
		readingEveryWords(['espn', 'espn', 'ffpc']),
		'Reading your lineups on ESPN and FFPC'
	);
	assert.equal(
		confirmEveryWords(5, 2),
		'5 changes in 2 leagues, each spelled out in its league below.'
	);
	assert.equal(setEveryWords(['espn', 'espn'], 2), 'Set them on ESPN');
	assert.equal(setEveryWords(['espn'], 1), 'Set it on ESPN');
	assert.equal(settingEveryWords(['espn', 'ffpc']), 'Setting them on ESPN and FFPC');
	assert.equal(
		everyReport({ set: 1, unchanged: 1 }),
		'Set in 1 league. 1 did not change. Its league says why below.'
	);
	const said = [
		...Object.values(EVERY),
		NONE_READY,
		everyLine(4, 2, ['sleeper']),
		confirmEveryWords(5, 2),
		everyReport({ set: 1, unchanged: 1 })
	].join(' ');
	assert.ok(!BANNED_MARKS.test(said), said);
	assert.ok(!BANNED_WORDS.test(said), said);
});
