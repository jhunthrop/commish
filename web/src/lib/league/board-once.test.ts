// The League page's board loads once per league read (Lane 66i re-review N1): keyed on the format
// asked for, so a fallback board never asks again, and a failed load waits for the next read.
// Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardOnce } from './board-once.ts';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

void test('a run without the league’s format loads its fallback once, and never again for that format', async () => {
	let fetches = 0;
	const loaded: string[] = [];
	const once = boardOnce(async (format: string) => {
		fetches++;
		return Promise.resolve({ format: 'ppr', asked: format });
	});
	for (let read = 0; read < 3; read++) {
		once.read(
			'half_ppr',
			(board) => loaded.push(board.format),
			() => assert.fail('no failure')
		);
		await settle();
	}
	assert.equal(fetches, 1);
	assert.deepEqual(loaded, ['ppr']);
	once.read(
		'standard',
		(board) => loaded.push(board.format),
		() => assert.fail('no failure')
	);
	await settle();
	assert.equal(fetches, 2, 'a league that reads on another format asks again');
});

void test('a failed load does not fire again until the next league read', async () => {
	let fetches = 0;
	let failures = 0;
	const once = boardOnce(async () => {
		fetches++;
		return Promise.reject(new Error('offline'));
	});
	once.read(
		'ppr',
		() => assert.fail('no board'),
		() => failures++
	);
	once.read(
		'ppr',
		() => assert.fail('no board'),
		() => failures++
	);
	await settle();
	await settle();
	assert.equal(fetches, 1, 'a read while one is in flight asks nothing');
	assert.equal(failures, 1);
	once.read(
		'ppr',
		() => assert.fail('no board'),
		() => failures++
	);
	await settle();
	assert.equal(fetches, 2, 'the next league read tries again');
});
