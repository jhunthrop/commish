/**
 * The run this build prerenders, read once per artifact and shared by every page. Each loader
 * validates its artifact, and the run as a whole is cross-checked once (every format has its board,
 * the index matches the manifest, slugs are unique), so a page can trust what it is handed.
 */
import { PUBLIC_RUN_BASE_URL, PUBLIC_RUN_ID } from '$app/env/public';
import { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } from '$app/env/private';
import { locationFor, type EnvRecord } from '#lib/run/config.ts';
import {
	RUN_PATHS,
	adpSchema,
	boardSchema,
	clubsSchema,
	indexSchema,
	manifestSchema,
	playerSchema,
	recordSchema,
	scheduleSchema,
	type Adp,
	type Board,
	type Club,
	type Format,
	type IndexEntry,
	type Manifest,
	type Player,
	type RunRecord,
	type Schedule
} from '#lib/run/schema.ts';
import { openRun, type RunReader } from '#lib/run/source.ts';
import type { RunStamp } from '#lib/run/stamp.ts';
import type { z } from 'zod';

const credentialsEnv: EnvRecord = { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY };

const memo = new Map<string, Promise<unknown>>();

/** One read per key per build, however many pages ask. */
function once<T>(key: string, load: () => Promise<T>): Promise<T> {
	let pending = memo.get(key) as Promise<T> | undefined;
	if (!pending) {
		pending = load();
		memo.set(key, pending);
	}
	return pending;
}

function reader(): Promise<RunReader> {
	return once('reader', () =>
		openRun({
			runId: PUBLIC_RUN_ID,
			location: locationFor(PUBLIC_RUN_BASE_URL, credentialsEnv)
		})
	);
}

async function read<T>(path: string, schema: z.ZodType<T>): Promise<T> {
	return (await reader()).read(path, schema);
}

export function manifest(): Promise<Manifest> {
	return once('manifest', () => read(RUN_PATHS.manifest, manifestSchema));
}

export function board(format: string): Promise<Board> {
	return once(`board:${format}`, async () => {
		const loaded = await read(RUN_PATHS.board(format), boardSchema);
		if (loaded.format !== format) {
			throw new Error(`boards/${format}.json says it is the ${loaded.format} board.`);
		}
		return loaded;
	});
}

function readPlayer(id: string): Promise<Player> {
	return once(`player:${id}`, () => read(RUN_PATHS.player(id), playerSchema));
}

/** Pages prerender one at a time, so the first player read starts every player's read at once,
 * through the reader's gate. Hundreds of pages then wait on one parallel fetch, not a serial one. */
function warmPlayers(): Promise<void> {
	return once('players:warm', async () => {
		const entries = await index();
		await Promise.all(entries.map((entry) => readPlayer(entry.id)));
	});
}

export async function player(id: string): Promise<Player> {
	void warmPlayers().catch(() => undefined);
	return readPlayer(id);
}

export function adp(): Promise<Adp> {
	return once('adp', () => read(RUN_PATHS.adp, adpSchema));
}

export function record(): Promise<RunRecord> {
	return once('record', () => read(RUN_PATHS.record, recordSchema));
}

export function clubs(): Promise<Club[]> {
	return once('clubs', () => read(RUN_PATHS.clubs, clubsSchema));
}

export function schedule(): Promise<Schedule> {
	return once('schedule', () => read(RUN_PATHS.schedule, scheduleSchema));
}

function assertUnique(values: readonly string[], what: string): void {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) throw new Error(`The run's index repeats the ${what} "${value}".`);
		seen.add(value);
	}
}

/** The search index, checked against the manifest and for unique ids and slugs. */
export function index(): Promise<IndexEntry[]> {
	return once('index', async () => {
		const [entries, run] = await Promise.all([read(RUN_PATHS.index, indexSchema), manifest()]);
		if (entries.length !== run.players) {
			throw new Error(
				`index.json lists ${String(entries.length)} players, the manifest says ${String(run.players)}.`
			);
		}
		assertUnique(
			entries.map((entry) => entry.id),
			'id'
		);
		assertUnique(
			entries.map((entry) => entry.slug),
			'slug'
		);
		return entries;
	});
}

/** The default format, the first the manifest lists. */
export async function defaultFormat(): Promise<Format> {
	const [first] = (await manifest()).formats;
	if (!first) throw new Error('The manifest lists no formats.');
	return first;
}

/** A format by id, or an error naming the formats the run carries. */
export async function formatById(id: string): Promise<Format> {
	const { formats } = await manifest();
	const found = formats.find((format) => format.id === id);
	if (!found) {
		throw new Error(
			`The run has no ${id} format. It carries ${formats.map((format) => format.id).join(', ')}.`
		);
	}
	return found;
}

/** The index entry for a slug, the way every player route finds its player. */
export async function entryBySlug(slug: string): Promise<IndexEntry> {
	const found = (await index()).find((entry) => entry.slug === slug);
	if (!found) throw new Error(`No player in the run has the slug ${slug}.`);
	return found;
}

export async function stamp(): Promise<RunStamp> {
	const [run, open] = await Promise.all([manifest(), reader()]);
	if (run.runId !== open.runId) {
		throw new Error(`The manifest of run ${open.runId} says it is run ${run.runId}.`);
	}
	return {
		runId: run.runId,
		runAt: run.runAt,
		season: run.season,
		standIn: run.standIn,
		players: run.players
	};
}
