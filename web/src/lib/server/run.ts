/**
 * The run this build prerenders, read once per artifact and shared by every page. Each loader
 * validates its artifact, and the run as a whole is cross-checked once (every format has its board,
 * the index matches the manifest, slugs are unique), so a page can trust what it is handed.
 */
import { PUBLIC_RUN_BASE_URL, PUBLIC_RUN_ID } from '$app/env/public';
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
import { checkRunSeasons } from '#lib/run/season-checks.ts';
import { openRun, type RunReader } from '#lib/run/source.ts';
import type { RunStamp } from '#lib/run/stamp.ts';
import type { z } from 'zod';

/** The R2 keys sign run reads during the build and nowhere else, so they are read from the build's
 * own environment when the first read starts, and never declared as app env: no bundle, no Worker
 * and no generated env module ever holds them. */
function buildCredentialsEnv(): EnvRecord {
	const env = globalThis.process.env;
	return { R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY };
}

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
			location: locationFor(PUBLIC_RUN_BASE_URL, buildCredentialsEnv())
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

/** The regular season's length: the last week any club plays on the run's schedule. */
function seasonWeeks(): Promise<number> {
	return once('schedule:weeks', async () =>
		Math.max(...(await schedule()).slates.flatMap((slate) => slate.games.map((game) => game.week)))
	);
}

/** The season's first kickoff: the earliest game on the run's schedule. */
export function firstKickoff(): Promise<string> {
	return once('schedule:first-kickoff', async () => {
		const kickoffs = (await schedule()).slates.flatMap((slate) =>
			slate.games.map((game) => game.kickoff)
		);
		return kickoffs.reduce((first, kickoff) =>
			Date.parse(kickoff) < Date.parse(first) ? kickoff : first
		);
	});
}

/** Whether the run was written after the season's first kickoff: the run decides, never the
 * reader's clock, so every page of one run agrees. */
export async function seasonUnderway(): Promise<boolean> {
	const [run, first] = await Promise.all([manifest(), firstKickoff()]);
	return Date.parse(run.runAt) >= Date.parse(first);
}

/** A player's file, its game log held to the run's own schedule (one row per regular-season week)
 * and its season to the index's two numbers for him. */
function readPlayer(id: string): Promise<Player> {
	return once(`player:${id}`, async () => {
		const [loaded, weeks, entries] = await Promise.all([
			read(RUN_PATHS.player(id), playerSchema),
			seasonWeeks(),
			index()
		]);
		if (loaded.season.weeks !== weeks) {
			throw new Error(
				`players/${id}.json logs ${String(loaded.season.weeks)} weeks, the schedule runs ${String(weeks)}.`
			);
		}
		const listed = entries.find((entry) => entry.id === id)?.season;
		const { games, pointsPerGame } = loaded.season;
		if (listed?.games !== games || listed.pointsPerGame !== pointsPerGame) {
			throw new Error(`index.json's season for ${id} is not his file's: ${String(games)} games.`);
		}
		return loaded;
	});
}

/** Pages prerender one at a time, so the first player read starts every player's read at once,
 * through the reader's gate. Hundreds of pages then wait on one parallel fetch, not a serial one.
 * With every file in, the rules across season blocks are checked (season-checks.ts), so the first
 * player read fails on a run that breaks one, whichever page asks. */
function warmPlayers(): Promise<void> {
	return once('players:warm', async () => {
		const entries = await index();
		const [players, slate] = await Promise.all([
			Promise.all(entries.map((entry) => readPlayer(entry.id))),
			schedule()
		]);
		checkRunSeasons(players, slate);
	});
}

export async function player(id: string): Promise<Player> {
	await warmPlayers();
	return readPlayer(id);
}

/** What every player's season figures are: the format they are scored in and the last week whose
 * games they reach, which every season block in the run shares (season-checks.ts holds them to it). */
export interface SeasonReach {
	/** The format id the figures are scored in. */
	format: string;
	/** That format as a chip prints it: "PPR". */
	scoring: string;
	/** The last week whose games are all in, 0 before week 1's. */
	through: number;
}

export function seasonReach(): Promise<SeasonReach> {
	return once('season:reach', async () => {
		const [first] = await index();
		if (!first) throw new Error('The run indexes no players.');
		const { season } = await player(first.id);
		const { label } = await formatById(season.format);
		return { format: season.format, scoring: label, through: season.through };
	});
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
