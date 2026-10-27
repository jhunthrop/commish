/** The Play upload's request shapes against a stub of the Play Developer API (no network). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { API_ROOT, decideUpload, PlayError, type Fetch, uploadToTrack, type UploadRequest } from './play-upload.ts';

interface Seen {
	method: string;
	url: string;
	headers: Record<string, string>;
	body: unknown;
}

const PACKAGE = 'app.trycommish.android';
const BASE = `${API_ROOT}/androidpublisher/v3/applications/${PACKAGE}`;
const UPLOAD = `${API_ROOT}/upload/androidpublisher/v3/applications/${PACKAGE}`;
const SESSION = 'https://upload.example/session-1';
const TOKEN = 'stub-token';
const BUNDLE = new Uint8Array([1, 2, 3, 4]);
const VERSION_CODE = 1219;

type Answer = (seen: Seen) => Response | undefined;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const refusal = (message: string, status = 400): Response => json({ error: { code: status, message } }, status);

/** A stub that records every request and answers like Play unless an override answers first. */
function stub(override: Answer = () => undefined): { fetch: Fetch; seen: Seen[] } {
	const seen: Seen[] = [];
	const fetch: Fetch = async (url, init) => {
		const request: Seen = { method: init.method ?? 'GET', url, headers: init.headers as Record<string, string>, body: init.body };
		seen.push(request);
		const answered = override(request);
		if (answered) return answered;
		if (url === `${BASE}/edits` && request.method === 'POST') return json({ id: 'edit-1' });
		if (url.startsWith(`${UPLOAD}/edits/edit-1/bundles`)) return new Response('{}', { status: 200, headers: { Location: SESSION } });
		if (url === SESSION) return json({ versionCode: VERSION_CODE, sha256: 'abc' });
		if (url === `${BASE}/edits/edit-1/tracks/internal` && request.method === 'GET') return json({ track: 'internal' });
		if (url === `${BASE}/edits/edit-1/tracks/internal`) return json(JSON.parse(String(init.body)));
		if (url === `${BASE}/edits/edit-1:commit`) return json({ id: 'edit-1' });
		if (url === `${BASE}/edits/edit-1` && request.method === 'DELETE') return new Response(null, { status: 204 });
		return refusal(`unexpected ${request.method} ${url}`, 404);
	};
	return { fetch, seen };
}

const request = (status: UploadRequest['status'], attempt = 1): UploadRequest => ({ token: TOKEN, packageName: PACKAGE, track: 'internal', status, bundle: BUNDLE, attempt });
const CODE_USED = 'APK specifies a version code that has already been used.';
const quiet = (): void => {};
const steps = (seen: Seen[]): string[] => seen.map((s) => `${s.method} ${s.url}`);

test('the edits flow: insert, resumable upload, track, commit, each with the bearer', async () => {
	const { fetch, seen } = stub();
	const result = await uploadToTrack(request('completed'), fetch, quiet);
	assert.deepEqual(result, { outcome: 'committed', editId: 'edit-1', versionCode: VERSION_CODE, status: 'completed' });
	assert.deepEqual(steps(seen), [
		`POST ${BASE}/edits`,
		`POST ${UPLOAD}/edits/edit-1/bundles?uploadType=resumable`,
		`PUT ${SESSION}`,
		`GET ${BASE}/edits/edit-1/tracks/internal`,
		`PUT ${BASE}/edits/edit-1/tracks/internal`,
		`POST ${BASE}/edits/edit-1:commit`
	]);
	for (const s of seen) assert.equal(s.headers.Authorization, `Bearer ${TOKEN}`);
	assert.equal(seen[1].headers['X-Upload-Content-Type'], 'application/octet-stream');
	assert.equal(seen[1].headers['X-Upload-Content-Length'], String(BUNDLE.byteLength));
	assert.equal(seen[2].body, BUNDLE);
	assert.deepEqual(JSON.parse(String(seen[4].body)), { track: 'internal', releases: [{ versionCodes: [String(VERSION_CODE)], status: 'completed' }] });
});

test('a draft request sets the track as draft', async () => {
	const { fetch, seen } = stub();
	const result = await uploadToTrack(request('draft'), fetch, quiet);
	assert.equal(result.status, 'draft');
	assert.equal(result.outcome, 'committed');
	assert.equal((JSON.parse(String(seen[4].body)) as { releases: { status: string }[] }).releases[0].status, 'draft');
});

test('the first-review refusal is a named outcome: the track again as draft, committed', async () => {
	let commits = 0;
	const { fetch, seen } = stub((s) => {
		if (s.url.endsWith(':commit') && commits++ === 0) return refusal('Only releases with status draft may be created on draft app.');
		return undefined;
	});
	const lines: string[] = [];
	const result = await uploadToTrack(request('completed'), fetch, (line) => lines.push(line));
	assert.equal(result.outcome, 'committed-as-draft');
	assert.equal(result.status, 'draft');
	const tracks = seen.filter((s) => s.url.endsWith('/tracks/internal') && s.method === 'PUT').map((s) => (JSON.parse(String(s.body)) as { releases: { status: string }[] }).releases[0].status);
	assert.deepEqual(tracks, ['completed', 'draft']);
	assert.ok(lines.some((line) => line.includes('draft app')));
});

test('any other refusal deletes the edit and fails with the step, status and message, never the token', async () => {
	const { fetch, seen } = stub((s) => (s.url === SESSION ? refusal(CODE_USED) : undefined));
	await assert.rejects(uploadToTrack(request('completed'), fetch, quiet), (error: unknown) => {
		assert.ok(error instanceof PlayError);
		assert.equal(error.step, 'upload bundle');
		assert.equal(error.status, 400);
		assert.match(error.message, /already been used/);
		assert.doesNotMatch(error.message, new RegExp(TOKEN));
		return true;
	});
	assert.equal(seen.at(-1)?.method, 'DELETE');
	assert.equal(seen.at(-1)?.url, `${BASE}/edits/edit-1`);
});

test('a 403 on insert (the account not invited in Play Console) fails before any edit exists', async () => {
	const { fetch, seen } = stub((s) => (s.url === `${BASE}/edits` ? refusal('The caller does not have permission', 403) : undefined));
	await assert.rejects(uploadToTrack(request('draft'), fetch, quiet), (error: unknown) => error instanceof PlayError && error.status === 403 && error.step === 'insert edit');
	assert.equal(seen.length, 1);
});

test('a draft refusal on a draft request is not retried', async () => {
	const { fetch, seen } = stub((s) => (s.url.endsWith(':commit') ? refusal('Only releases with status draft may be created on draft app.') : undefined));
	await assert.rejects(uploadToTrack(request('draft'), fetch, quiet), PlayError);
	assert.equal(seen.filter((s) => s.url.endsWith('/tracks/internal') && s.method === 'PUT').length, 1);
});

test('a re-run whose code Play already holds is a named outcome: the edit deleted, nothing thrown', async () => {
	const { fetch, seen } = stub((s) => (s.url === SESSION ? refusal(CODE_USED) : undefined));
	const lines: string[] = [];
	const result = await uploadToTrack(request('completed', 2), fetch, (line) => lines.push(line));
	assert.deepEqual(result, { outcome: 'already-on-play', editId: 'edit-1', versionCode: null, status: null });
	assert.equal(seen.at(-1)?.method, 'DELETE');
	assert.equal(seen.filter((s) => s.url.endsWith(':commit')).length, 0);
	assert.ok(lines.some((line) => line.includes('attempt 2')));
});

test('a re-run refused for another reason still fails', async () => {
	const { fetch } = stub((s) => (s.url === SESSION ? refusal('All uploaded bundles must be signed.', 403) : undefined));
	await assert.rejects(uploadToTrack(request('completed', 2), fetch, quiet), PlayError);
});

test('every request carries a timeout signal', async () => {
	const { fetch, seen } = stub();
	const signals: unknown[] = [];
	const watching: Fetch = (url, init) => {
		signals.push(init.signal);
		return fetch(url, init);
	};
	await uploadToTrack(request('draft'), watching, quiet);
	assert.equal(signals.length, seen.length);
	for (const signal of signals) assert.ok(signal instanceof AbortSignal);
});

test('decideUpload: empty uploads, lower uploads, equal and higher skip, codeless releases upload', () => {
	assert.equal(decideUpload([], 1219), 'upload');
	assert.equal(decideUpload([1100, 1218], 1219), 'upload');
	assert.equal(decideUpload([1219], 1219), 'skip');
	assert.equal(decideUpload([1100, 1300], 1219), 'skip');
	assert.equal(decideUpload([], 0), 'upload');
	assert.equal(decideUpload([99], 100), 'upload');
	assert.equal(decideUpload([100], 99), 'skip');
});

const trackHolding = (releases: unknown): Answer => (s) => (s.method === 'GET' && s.url.endsWith('/tracks/internal') ? json({ track: 'internal', releases }) : undefined);

test('a track already at a higher code: the edit is deleted, nothing set or committed, exit-0 outcome', async () => {
	const { fetch, seen } = stub(trackHolding([{ versionCodes: ['1300'], status: 'completed' }]));
	const lines: string[] = [];
	const result = await uploadToTrack(request('completed'), fetch, (line) => lines.push(line));
	assert.deepEqual(result, { outcome: 'track-already-ahead', editId: 'edit-1', versionCode: VERSION_CODE, status: null, trackVersionCode: 1300 });
	assert.equal(seen.at(-1)?.method, 'DELETE');
	assert.equal(seen.filter((s) => s.method === 'PUT' && s.url.endsWith('/tracks/internal')).length, 0);
	assert.equal(seen.filter((s) => s.url.endsWith(':commit')).length, 0);
	assert.ok(!lines.some((line) => line.includes('Skipping')));
});

test('a track at the same code skips too', async () => {
	const { fetch } = stub(trackHolding([{ versionCodes: [String(VERSION_CODE)] }]));
	assert.equal((await uploadToTrack(request('completed'), fetch, quiet)).outcome, 'track-already-ahead');
});

test('a track at a lower code, or with codeless releases, still commits', async () => {
	for (const releases of [[{ versionCodes: ['1100'] }], [{ status: 'draft' }], [{ versionCodes: [] }]]) {
		const { fetch } = stub(trackHolding(releases));
		assert.equal((await uploadToTrack(request('completed'), fetch, quiet)).outcome, 'committed');
	}
});

test('a failing track read is a real error: the edit is deleted and the run fails', async () => {
	const { fetch, seen } = stub((s) => (s.method === 'GET' ? refusal('backend error', 500) : undefined));
	await assert.rejects(uploadToTrack(request('completed'), fetch, quiet), (error: unknown) => error instanceof PlayError && error.step === 'read track');
	assert.equal(seen.at(-1)?.method, 'DELETE');
});

test('a 404 reading a track with no release yet is an empty track: the upload commits', async () => {
	const { fetch } = stub((s) => (s.method === 'GET' ? refusal('Track not found', 404) : undefined));
	assert.equal((await uploadToTrack(request('completed'), fetch, quiet)).outcome, 'committed');
});

test('a higher code in any release state skips, and the track reads as numbers not strings', async () => {
	for (const status of ['draft', 'halted', 'inProgress']) {
		const { fetch } = stub(trackHolding([{ versionCodes: ['1300'], status }]));
		assert.equal((await uploadToTrack(request('completed'), fetch, quiet)).outcome, 'track-already-ahead');
	}
	const { fetch } = stub(trackHolding([{ versionCodes: ['99'] }]));
	assert.equal((await uploadToTrack(request('completed'), fetch, quiet)).outcome, 'committed');
});

const deleteFails: Answer = (s) => (s.method === 'DELETE' ? refusal('gone', 500) : undefined);

test('a failing edit delete leaves the skip outcome intact', async () => {
	const ahead = trackHolding([{ versionCodes: ['1300'] }]);
	const { fetch } = stub((s) => deleteFails(s) ?? ahead(s));
	const lines: string[] = [];
	const result = await uploadToTrack(request('completed'), fetch, (line) => lines.push(line));
	assert.equal(result.outcome, 'track-already-ahead');
	assert.ok(lines.some((line) => line.includes('was not deleted')));
});

test('a failing edit delete leaves the original error intact', async () => {
	const { fetch } = stub((s) => deleteFails(s) ?? (s.url === SESSION ? refusal('All uploaded bundles must be signed.', 403) : undefined));
	await assert.rejects(uploadToTrack(request('completed'), fetch, quiet), (error: unknown) => error instanceof PlayError && error.status === 403 && error.step === 'upload bundle');
});
