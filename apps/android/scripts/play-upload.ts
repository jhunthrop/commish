/**
 * The signed release bundle to a Play track through the Play Developer API's edits flow, with a
 * short-lived access token (CI mints it by GitHub federation for the Play service account; no JSON
 * key exists or may exist). No dependency beyond fetch:
 *   1. insert an edit,
 *   2. upload the bundle (a resumable upload, so a large bundle is one request after the session),
 *   3. set the track to that version code with the release status,
 *   4. commit the edit.
 * Before the track is set, it is read: when its highest version code is equal to or above this
 * build's (a newer run finished first), the edit is deleted and the run says so (exit 0), so an older
 * run never rolls the track back. The build's code is known only from Play's answer to the upload.
 * An app that has not passed its first review takes only draft releases: when Play refuses a
 * completed release for that reason, the track is set again as draft in the same edit and committed,
 * and the run says so (a named outcome, exit 0). On a re-run (--attempt above 1), Play's "version
 * code already used" means this commit's bundle is already on Play: the edit is deleted and the run
 * says so (a named outcome, exit 0). Any other refusal deletes the edit and exits 1. Every request
 * has a timeout and none is retried.
 *
 *   PLAY_ACCESS_TOKEN=... node apps/android/scripts/play-upload.ts \
 *     --bundle app/build/outputs/bundle/release/app-release.aab \
 *     --package app.trycommish.android --track internal --status completed --attempt 1
 *
 * The token is read from the environment only and never printed; the API's answers are.
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

export const API_ROOT = 'https://androidpublisher.googleapis.com';
const API_PATH = '/androidpublisher/v3/applications';
const UPLOAD_PATH = '/upload/androidpublisher/v3/applications';
const BUNDLE_TYPE = 'application/octet-stream';
/** Play's words when an app with no reviewed release is sent a release that is not a draft. */
const DRAFT_APP_REFUSAL = /draft app/i;
/** Play's words when a bundle's version code was already uploaded. */
const CODE_USED_REFUSAL = /version code.*already been used/i;
/** A JSON call's bound, and the bundle's (a large body on a slow runner). */
const CALL_TIMEOUT_MS = 60_000;
const BUNDLE_TIMEOUT_MS = 5 * 60_000;

export type ReleaseStatus = 'completed' | 'draft';
export type Outcome = 'committed' | 'committed-as-draft' | 'already-on-play' | 'track-already-ahead';

export interface UploadRequest {
	token: string;
	packageName: string;
	track: string;
	status: ReleaseStatus;
	bundle: Uint8Array;
	/** The CI run's attempt (github.run_attempt); above 1 is a re-run. */
	attempt: number;
}

export interface UploadResult {
	outcome: Outcome;
	editId: string;
	/** Null when Play refused the bundle as already uploaded (the code is in its message). */
	versionCode: number | null;
	status: ReleaseStatus | null;
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type Log = (line: string) => void;

/** A refusal from the API, with its status and its own message (never the request's headers). */
export class PlayError extends Error {
	readonly status: number;
	readonly step: string;
	constructor(step: string, status: number, message: string) {
		super(`${step}: HTTP ${status}: ${message}`);
		this.step = step;
		this.status = status;
	}
}

async function errorMessage(response: Response): Promise<string> {
	const text = await response.text();
	try {
		const parsed = JSON.parse(text) as { error?: { message?: string } };
		return parsed.error?.message ?? text;
	} catch {
		return text;
	}
}

class Client {
	private readonly fetch: Fetch;
	private readonly token: string;
	readonly base: string;
	readonly uploadBase: string;

	constructor(fetch: Fetch, token: string, packageName: string) {
		this.fetch = fetch;
		this.token = token;
		const name = encodeURIComponent(packageName);
		this.base = `${API_ROOT}${API_PATH}/${name}`;
		this.uploadBase = `${API_ROOT}${UPLOAD_PATH}/${name}`;
	}

	async call(step: string, url: string, init: RequestInit = {}, timeoutMs = CALL_TIMEOUT_MS): Promise<Response> {
		const headers = { ...(init.headers as Record<string, string>), Authorization: `Bearer ${this.token}` };
		const response = await this.fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
		if (!response.ok) throw new PlayError(step, response.status, await errorMessage(response));
		return response;
	}

	async json<T>(step: string, url: string, init: RequestInit = {}, timeoutMs = CALL_TIMEOUT_MS): Promise<T> {
		return (await (await this.call(step, url, init, timeoutMs)).json()) as T;
	}
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function insertEdit(client: Client): Promise<string> {
	const edit = await client.json<{ id: string }>('insert edit', `${client.base}/edits`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: '{}'
	});
	return edit.id;
}

async function uploadBundle(client: Client, editId: string, bundle: Uint8Array): Promise<number> {
	const session = await client.call('start bundle upload', `${client.uploadBase}/edits/${editId}/bundles?uploadType=resumable`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, 'X-Upload-Content-Type': BUNDLE_TYPE, 'X-Upload-Content-Length': String(bundle.byteLength) },
		body: '{}'
	});
	const location = session.headers.get('location');
	if (!location) throw new PlayError('start bundle upload', session.status, 'no upload location in the answer');
	const uploaded = await client.json<{ versionCode: number }>(
		'upload bundle',
		location,
		{ method: 'PUT', headers: { 'Content-Type': BUNDLE_TYPE }, body: bundle },
		BUNDLE_TIMEOUT_MS
	);
	return uploaded.versionCode;
}

interface TrackAnswer {
	releases?: { versionCodes?: string[] }[];
}

/** Every version code on the track's releases; a release without codes contributes none. */
async function trackVersionCodes(client: Client, editId: string, track: string): Promise<number[]> {
	const answer = await client.json<TrackAnswer>('read track', `${client.base}/edits/${editId}/tracks/${encodeURIComponent(track)}`);
	return (answer.releases ?? []).flatMap((release) => release.versionCodes ?? []).map(Number).filter(Number.isInteger);
}

export type TrackDecision = 'upload' | 'skip';

/** Upload only a build newer than everything on the track: an equal or higher code there means a newer run got in first. */
export function decideUpload(trackCodes: readonly number[], buildCode: number): TrackDecision {
	return trackCodes.length > 0 && Math.max(...trackCodes) >= buildCode ? 'skip' : 'upload';
}

async function setTrack(client: Client, editId: string, track: string, versionCode: number, status: ReleaseStatus): Promise<void> {
	await client.call(`set ${track} track`, `${client.base}/edits/${editId}/tracks/${encodeURIComponent(track)}`, {
		method: 'PUT',
		headers: JSON_HEADERS,
		body: JSON.stringify({ track, releases: [{ versionCodes: [String(versionCode)], status }] })
	});
}

async function commitEdit(client: Client, editId: string): Promise<void> {
	await client.call('commit edit', `${client.base}/edits/${editId}:commit`, { method: 'POST' });
}

/** True when Play refused a completed release because the app has not passed its first review. */
export function isDraftAppRefusal(error: unknown): boolean {
	return error instanceof PlayError && error.status === 400 && DRAFT_APP_REFUSAL.test(error.message);
}

/** True when Play refused the bundle because its version code was already uploaded. */
export function isCodeUsedRefusal(error: unknown): boolean {
	return error instanceof PlayError && error.step === 'upload bundle' && CODE_USED_REFUSAL.test(error.message);
}

async function releaseWithFallback(client: Client, editId: string, request: UploadRequest, versionCode: number, log: Log): Promise<Outcome> {
	try {
		await setTrack(client, editId, request.track, versionCode, request.status);
		await commitEdit(client, editId);
		return 'committed';
	} catch (error) {
		if (request.status === 'draft' || !isDraftAppRefusal(error)) throw error;
		log(`Play refused a completed release (${(error as PlayError).message}); setting the ${request.track} track as draft instead.`);
		await setTrack(client, editId, request.track, versionCode, 'draft');
		await commitEdit(client, editId);
		return 'committed-as-draft';
	}
}

async function deleteEdit(client: Client, editId: string, log: Log): Promise<void> {
	try {
		await client.call('delete edit', `${client.base}/edits/${editId}`, { method: 'DELETE' });
		log(`Edit ${editId} deleted.`);
	} catch (error) {
		log(`Edit ${editId} was not deleted (${(error as Error).message}); Play expires it.`);
	}
}

/**
 * The whole flow; the edit is deleted when any step after its insert fails. A re-run whose bundle
 * Play already holds is a named outcome, not a failure.
 */
export async function uploadToTrack(request: UploadRequest, fetch: Fetch, log: Log): Promise<UploadResult> {
	const client = new Client(fetch, request.token, request.packageName);
	const editId = await insertEdit(client);
	log(`Edit ${editId} inserted for ${request.packageName}.`);
	try {
		const versionCode = await uploadBundle(client, editId, request.bundle);
		log(`Bundle uploaded as version code ${versionCode}.`);
		const onTrack = await trackVersionCodes(client, editId, request.track);
		if (decideUpload(onTrack, versionCode) === 'skip') {
			await deleteEdit(client, editId, log);
			log(`Skipping: the ${request.track} track already holds version code ${Math.max(...onTrack)}, not below this build's ${versionCode}; a newer run got in first, so nothing is committed.`);
			return { outcome: 'track-already-ahead', editId, versionCode, status: null };
		}
		const outcome = await releaseWithFallback(client, editId, request, versionCode, log);
		const status = outcome === 'committed' ? request.status : 'draft';
		log(`Edit ${editId} committed: version code ${versionCode} on ${request.track} as ${status}.`);
		return { outcome, editId, versionCode, status };
	} catch (error) {
		await deleteEdit(client, editId, log);
		if (request.attempt > 1 && isCodeUsedRefusal(error)) {
			log(`Play already holds this run's bundle (${(error as PlayError).message}); attempt ${request.attempt} uploads nothing.`);
			return { outcome: 'already-on-play', editId, versionCode: null, status: null };
		}
		throw error;
	}
}

function parseStatus(value: string): ReleaseStatus {
	if (value === 'completed' || value === 'draft') return value;
	throw new Error(`--status must be completed or draft, not '${value}'`);
}

function parseAttempt(value: string): number {
	const attempt = Number(value);
	if (Number.isInteger(attempt) && attempt >= 1) return attempt;
	throw new Error(`--attempt must be a whole number from 1, not '${value}'`);
}

function required(value: string | undefined, name: string): string {
	if (!value) throw new Error(`${name} is required`);
	return value;
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			bundle: { type: 'string' },
			package: { type: 'string' },
			track: { type: 'string', default: 'internal' },
			status: { type: 'string', default: 'completed' },
			attempt: { type: 'string', default: '1' }
		}
	});
	const request: UploadRequest = {
		token: required(process.env.PLAY_ACCESS_TOKEN, 'PLAY_ACCESS_TOKEN'),
		packageName: required(values.package, '--package'),
		track: values.track,
		status: parseStatus(values.status),
		bundle: new Uint8Array(await readFile(required(values.bundle, '--bundle'))),
		attempt: parseAttempt(values.attempt)
	};
	const result = await uploadToTrack(request, globalThis.fetch, (line) => console.log(line));
	if (result.outcome === 'already-on-play') {
		console.log(`::notice title=Play already has this run::Attempt ${request.attempt} found its version code already on Play, so nothing new was uploaded.`);
	}
	if (result.outcome === 'track-already-ahead') {
		console.log(`::notice title=Play track is ahead::Version code ${result.versionCode} is not above what ${request.track} already holds, so this older run committed nothing.`);
	}
	if (result.outcome === 'committed-as-draft') {
		console.log(`::notice title=Play internal as draft::The app has not passed its first review, so version code ${result.versionCode} is a draft on ${request.track}; promote it in Play Console.`);
	}
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(`::error title=Play upload::${(error as Error).message}`);
		process.exit(1);
	});
}
