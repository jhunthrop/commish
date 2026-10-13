/**
 * Reads a run's artifacts at build: from R2 over https, signed, or from a local directory. Every
 * read is parsed with its schema, so a bad artifact fails the build naming the file and the field.
 * Framework-free, so the SvelteKit build and the node scripts (the glyph guard) share it.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AwsClient } from 'aws4fetch';
import type { z } from 'zod';
import type { RunConfig, RunLocation } from './config.ts';
import { LATEST_RUN } from './config.ts';
import { LATEST_POINTER, latestPointerSchema } from './schema.ts';

/** Reads at once, at most. Enough to keep a build fast, few enough to stay polite to the bucket. */
const MAX_IN_FLIGHT = 24;
const ATTEMPTS = 4;
const RETRY_BASE_MS = 250;
const RUNS_PREFIX = 'runs';

export interface RunReader {
	/** The run being read, resolved from the latest pointer when the config asked for it. */
	runId: string;
	read<T>(path: string, schema: z.ZodType<T>): Promise<T>;
}

type Fetcher = (url: string) => Promise<Response>;

function fetcherFor(location: Extract<RunLocation, { kind: 'https' }>): Fetcher {
	if (location.credentials === null) return (url) => fetch(url);
	const client = new AwsClient({ ...location.credentials, service: 's3', region: 'auto' });
	return (url) => client.fetch(url);
}

/** A gate on how many reads run at once. */
function limiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
	let active = 0;
	const waiting: (() => void)[] = [];
	return async (task) => {
		if (active >= max) await new Promise<void>((go) => waiting.push(go));
		active += 1;
		try {
			return await task();
		} finally {
			active -= 1;
			waiting.shift()?.();
		}
	};
}

function pause(ms: number): Promise<void> {
	return new Promise((done) => setTimeout(done, ms));
}

/** Retries a network failure or a 5xx with backoff. A 4xx is an answer, not a blip. */
async function getText(fetcher: Fetcher, url: string): Promise<string> {
	let lastError: unknown = null;
	for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
		try {
			const response = await fetcher(url);
			if (response.ok) return await response.text();
			const status = `${String(response.status)} ${response.statusText}`;
			if (response.status < 500) throw new Error(`${url} answered ${status}.`);
			lastError = new Error(`${url} answered ${status}.`);
		} catch (error) {
			if (error instanceof Error && error.message.includes(' answered 4')) throw error;
			lastError = error;
		}
		await pause(RETRY_BASE_MS * 2 ** (attempt - 1));
	}
	throw new Error(`Could not read ${url} after ${String(ATTEMPTS)} attempts.`, {
		cause: lastError
	});
}

function textReader(location: RunLocation): (key: string) => Promise<string> {
	if (location.kind === 'directory') {
		const root = resolve(location.path);
		return (key) => readFile(resolve(root, key), 'utf8');
	}
	const fetcher = fetcherFor(location);
	const gate = limiter(MAX_IN_FLIGHT);
	return (key) => gate(() => getText(fetcher, `${location.baseUrl}/${key}`));
}

function parse<T>(text: string, key: string, schema: z.ZodType<T>): T {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (error) {
		throw new Error(`${key} is not JSON.`, { cause: error });
	}
	const result = schema.safeParse(json);
	if (!result.success) {
		const issue = result.error.issues[0];
		const where = issue?.path.join('.') ?? '';
		throw new Error(`${key} does not match the run format at "${where}": ${issue?.message ?? ''}`);
	}
	return result.data;
}

/** A reader for the configured run. Resolves "latest" through the pointer the run's writer moves. */
export async function openRun(config: RunConfig): Promise<RunReader> {
	const readText = textReader(config.location);
	const runId =
		config.runId === LATEST_RUN
			? parse(
					await readText(`${RUNS_PREFIX}/${LATEST_POINTER}`),
					LATEST_POINTER,
					latestPointerSchema
				).runId
			: config.runId;
	return {
		runId,
		read: async (path, schema) => {
			const key = `${RUNS_PREFIX}/${runId}/${path}`;
			return parse(await readText(key), key, schema);
		}
	};
}
