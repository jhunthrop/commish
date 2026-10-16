// The hourly backstop's choice: skip only when the live site holds both the latest run and the
// commit being built. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	backstopChoice,
	deployedStamp,
	fetchDeployedStamp,
	parseDeployedStamp
} from './deployed.ts';

const SHA = '0c1a7591aa0bb1c2d3e4f5a6b7c8d9e0f1a2b3c4';
const OTHER_SHA = '86584c40aa0bb1c2d3e4f5a6b7c8d9e0f1a2b3c4';
const LATEST = { runId: '2026-10-15T05', commit: SHA };

void test('an hour where the site holds the latest run on this commit skips, and says so', () => {
	const choice = backstopChoice(LATEST, { runId: '2026-10-15T05', commit: SHA });
	assert.equal(choice.build, false);
	assert.equal(
		choice.line,
		`The site already holds run 2026-10-15T05 on commit ${SHA.slice(0, 8)}, the latest of both; nothing to build.`
	);
});

void test('a newer published run builds', () => {
	const choice = backstopChoice(LATEST, { runId: '2026-10-14T05', commit: SHA });
	assert.equal(choice.build, true);
	assert.match(choice.line, /holds run 2026-10-14T05.*latest is 2026-10-15T05/);
});

void test('the same run on another commit builds, so a pushed commit is never left undeployed', () => {
	const choice = backstopChoice(LATEST, { runId: '2026-10-15T05', commit: OTHER_SHA });
	assert.equal(choice.build, true);
	assert.match(choice.line, /commit 86584c40.*building 0c1a7591/);
});

void test('a site whose stamp cannot be read builds', () => {
	const choice = backstopChoice(LATEST, null);
	assert.equal(choice.build, true);
	assert.match(choice.line, /could not be read/);
});

void test('the stamp the build writes reads back as the run and the commit', () => {
	assert.deepEqual(parseDeployedStamp(deployedStamp('2026-10-15T05', SHA)), {
		runId: '2026-10-15T05',
		commit: SHA
	});
});

void test('a stamp without a run id or a full commit reads as nothing', () => {
	assert.equal(parseDeployedStamp('2026-10-15T05\n'), null);
	assert.equal(parseDeployedStamp(`2026-10-15T05 unknown\n`), null);
	assert.equal(parseDeployedStamp('<!doctype html><title>404</title>'), null);
	assert.equal(parseDeployedStamp(''), null);
});

void test('a build with no commit to name writes a stamp that never matches', () => {
	assert.equal(parseDeployedStamp(deployedStamp('2026-10-15T05', undefined)), null);
});

interface Seen {
	url: string;
	cacheControl: string | null;
}

function recordingFetch(seen: Seen[], body: string, status = 200): typeof fetch {
	return (input, init) => {
		seen.push({
			url: input instanceof Request ? input.url : input.toString(),
			cacheControl: new Headers(init?.headers).get('Cache-Control')
		});
		return Promise.resolve(new Response(body, { status }));
	};
}

void test('the stamp is read with a query no cached copy has and a request for a fresh copy', async () => {
	const seen: Seen[] = [];
	const stamp = await fetchDeployedStamp(
		'https://trycommish.app/',
		recordingFetch(seen, deployedStamp('2026-10-15T05', SHA)),
		1_760_000_000_000
	);
	assert.deepEqual(stamp, { runId: '2026-10-15T05', commit: SHA });
	assert.deepEqual(seen, [
		{ url: 'https://trycommish.app/data/run.txt?at=1760000000000', cacheControl: 'no-cache' }
	]);
});

void test('a site that answers with an error or not at all has no stamp', async () => {
	assert.equal(
		await fetchDeployedStamp('https://x.test', recordingFetch([], 'gone', 404), 1),
		null
	);
	const failing: typeof fetch = () => Promise.reject(new Error('offline'));
	assert.equal(await fetchDeployedStamp('https://x.test', failing, 1), null);
});
