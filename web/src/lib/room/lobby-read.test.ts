// The lobby room's read (B252, Lane 247): a read that did not go offers Try again and reads the room
// again in place; a refusal for good keeps only the way out. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '#lib/api/client.ts';
import { canTryAgain, readLobby } from './lobby-read.ts';

const refused = (status: number): ApiError =>
	new ApiError(status, { code: 'refused', message: 'The room could not be read' });

/** A room read that answers each call in turn: an error to throw, or the room. */
function reads(...answers: readonly (Error | string)[]): {
	read: () => Promise<string>;
	count: () => number;
} {
	let calls = 0;
	return {
		read: () => {
			const answer = answers[calls] ?? 'unanswered';
			calls += 1;
			return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
		},
		count: () => calls
	};
}

void test('a read that did not go offers Try again, which reads the room again in place', async () => {
	const room = reads(refused(503), 'room-1');
	const first = await readLobby(room.read);
	assert.equal(first.kind, 'failed');
	assert.equal(canTryAgain(first), true);
	const again = await readLobby(room.read);
	assert.deepEqual(again, { kind: 'room', room: 'room-1' });
	assert.equal(canTryAgain(again), false);
	assert.equal(room.count(), 2);
});

void test('no signal, a timeout, a 5xx and a thrown fetch are not final', async () => {
	for (const error of [refused(0), refused(500), refused(502), new TypeError('Failed to fetch')]) {
		const read = await readLobby(reads(error).read);
		assert.deepEqual(read, { kind: 'failed', error, final: false });
		assert.equal(canTryAgain(read), true);
	}
});

void test('signed out, no seat and no such room are final, with no Try again', async () => {
	for (const status of [401, 403, 404]) {
		const read = await readLobby(reads(refused(status)).read);
		assert.equal(read.kind === 'failed' && read.final, true, `status ${String(status)}`);
		assert.equal(canTryAgain(read), false);
	}
});

void test('a read that answers after the page went opens nothing (review L2)', async () => {
	let alive = true;
	const room = reads('room-1');
	const left = await readLobby(
		() => {
			alive = false;
			return room.read();
		},
		() => alive
	);
	assert.deepEqual(left, { kind: 'left' });
	assert.equal(canTryAgain(left), false);
	const failedAfter = await readLobby(reads(refused(503)).read, () => false);
	assert.deepEqual(failedAfter, { kind: 'left' });
});
