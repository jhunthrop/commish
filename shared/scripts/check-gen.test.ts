// The drift check's comparison: a generated file edited by hand, missing, untracked or left behind
// fails it. Run with `node --test shared/scripts/*.test.ts`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { drift } from './check-gen.ts';
import { writeOutputs } from './generated.ts';

const TOKENS = 'web/src/lib/ui/tokens.generated.css';
const FIXTURE = 'shared/fixtures/inseason/a.json';

/** A throwaway repository with `files` committed, and a fresh dir with `outputs` written. */
async function setUp(
	files: Readonly<Record<string, string>>,
	outputs: ReadonlyMap<string, string>
): Promise<{ root: string; fresh: string }> {
	const root = await mkdtemp(join(tmpdir(), 'check-gen-repo-'));
	const fresh = await mkdtemp(join(tmpdir(), 'check-gen-fresh-'));
	const git = (...args: string[]): void => {
		execFileSync('git', args, { cwd: root, stdio: 'ignore' });
	};
	git('init', '-q');
	await writeOutputs(new Map(Object.entries(files)), root);
	await mkdir(join(root, 'shared/fixtures/inseason'), { recursive: true });
	git('add', '.');
	git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'files');
	await writeOutputs(outputs, fresh);
	return { root, fresh };
}

const OUTPUTS = new Map([
	[TOKENS, ':root { --ink: #15120f; }\n'],
	[FIXTURE, '{}\n']
]);

void test('the repository as generated passes', async () => {
	const { root, fresh } = await setUp(Object.fromEntries(OUTPUTS), OUTPUTS);
	assert.deepEqual(await drift(OUTPUTS, fresh, root), []);
	await Promise.all([rm(root, { recursive: true }), rm(fresh, { recursive: true })]);
});

void test('one byte edited by hand fails, naming the file', async () => {
	const { root, fresh } = await setUp(
		{ [TOKENS]: ':root { --ink: #15120e; }\n', [FIXTURE]: '{}\n' },
		OUTPUTS
	);
	assert.deepEqual(await drift(OUTPUTS, fresh, root), [{ path: TOKENS, why: 'differs' }]);
	await Promise.all([rm(root, { recursive: true }), rm(fresh, { recursive: true })]);
});

void test('a file missing, one never added and one left behind each fail', async () => {
	const { root, fresh } = await setUp({ [TOKENS]: OUTPUTS.get(TOKENS) ?? '' }, OUTPUTS);
	assert.deepEqual(await drift(OUTPUTS, fresh, root), [{ path: FIXTURE, why: 'missing' }]);
	await writeFile(join(root, FIXTURE), '{}\n');
	assert.deepEqual(await drift(OUTPUTS, fresh, root), [{ path: FIXTURE, why: 'untracked' }]);
	await writeFile(join(root, 'shared/fixtures/inseason/old.json'), '{}\n');
	assert.deepEqual(await drift(OUTPUTS, fresh, root), [
		{ path: FIXTURE, why: 'untracked' },
		{ path: 'shared/fixtures/inseason/old.json', why: 'stale' }
	]);
	await Promise.all([rm(root, { recursive: true }), rm(fresh, { recursive: true })]);
});
