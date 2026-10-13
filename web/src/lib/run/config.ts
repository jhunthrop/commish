/**
 * Which run the build reads, and from where. Two build-time inputs, so the first real nightly run
 * replaces the stand-in with no code change:
 *
 *   PUBLIC_RUN_ID        the run's id, "2026-10-12T05". "latest" reads the run the latest pointer names.
 *   PUBLIC_RUN_BASE_URL  the folder holding runs/: an https URL (R2's S3 endpoint for the bucket in
 *                        CI) or a local directory for development, relative to web/.
 *
 * Over https the reads are signed when R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are set, so the
 * bucket never has to be public. They are read at build only and never reach a bundle.
 */
import { runIdSchema } from './schema.ts';

export const LATEST_RUN = 'latest';

export interface R2Credentials {
	accessKeyId: string;
	secretAccessKey: string;
}

export type RunLocation =
	| { kind: 'https'; baseUrl: string; credentials: R2Credentials | null }
	| { kind: 'directory'; path: string };

export interface RunConfig {
	/** A run id, or LATEST_RUN until the pointer is read. */
	runId: string;
	location: RunLocation;
}

export type EnvRecord = Readonly<Record<string, string | undefined>>;

function required(env: EnvRecord, name: string): string {
	const value = env[name]?.trim();
	if (!value) {
		throw new Error(
			`${name} is not set. Set PUBLIC_RUN_ID and PUBLIC_RUN_BASE_URL in web/.env, or run npm run standin to write the stand-in run and its .env.`
		);
	}
	return value;
}

/** The run id as given: a run id, or "latest". Throws on anything else. */
export function parseRunId(value: string | undefined): string {
	const id = value?.trim() ?? '';
	if (id === LATEST_RUN) return id;
	const parsed = runIdSchema.safeParse(id);
	if (!parsed.success) {
		throw new Error(`PUBLIC_RUN_ID "${id}" is neither "latest" nor a run id like 2026-10-12T05.`);
	}
	return parsed.data;
}

/** An https URL or a directory path, with no trailing slash. */
export function parseBaseUrl(value: string | undefined): string {
	const base = value?.trim().replace(/\/+$/, '') ?? '';
	if (base === '') throw new Error('PUBLIC_RUN_BASE_URL is empty.');
	if (/^[a-z]+:/i.test(base) && !base.startsWith('https://')) {
		throw new Error(`PUBLIC_RUN_BASE_URL "${base}" must be https or a local directory.`);
	}
	return base;
}

function credentials(env: EnvRecord): R2Credentials | null {
	const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
	const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
	if (!accessKeyId && !secretAccessKey) return null;
	if (!accessKeyId || !secretAccessKey) {
		throw new Error('Set both R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY, or neither.');
	}
	return { accessKeyId, secretAccessKey };
}

export function locationFor(base: string, env: EnvRecord): RunLocation {
	return base.startsWith('https://')
		? { kind: 'https', baseUrl: base, credentials: credentials(env) }
		: { kind: 'directory', path: base };
}

/** The run config from an environment: process.env in a script, the validated values in the app. */
export function runConfigFrom(env: EnvRecord): RunConfig {
	const base = parseBaseUrl(required(env, 'PUBLIC_RUN_BASE_URL'));
	return {
		runId: parseRunId(required(env, 'PUBLIC_RUN_ID')),
		location: locationFor(base, env)
	};
}
