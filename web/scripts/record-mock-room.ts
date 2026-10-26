// Records a mock draft as the API answers it, for the apps' mock room (Lane 213): two solo mocks on
// one seed against a local API, every answer kept whole (the envelope with `ok`, `data`, `error`), under
// shared/fixtures/mock-room. The first drafts our call by hand through round 4, queues three players,
// takes its round 4 pick back, drafts it again and lets Pick for me and Finish draft the rest; the
// second drafts a kicker, a defense and a backup quarterback by hand and finishes, so its report sits
// well down the table. Both are read through their shared links too. The device token is the drafter's
// (an `ios` pairing on the local database), read from a file and never printed.
//
//   API=http://localhost:18215 TOKEN_FILE=<file> node scripts/record-mock-room.ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { components } from '../src/lib/api/types.ts';

type Schemas = components['schemas'];
type MockRoom = Schemas['MockRoom'];
type RoomCard = Schemas['RoomCard'];

interface Envelope<T> {
	ok: boolean;
	data: T;
	error: unknown;
}

/** The fixture draft: one seed, the setup page's defaults, our slot fifth of twelve. */
export const SEED = 213;
export const SLOT = 5;
const DOWN_SLOT = 12;
const HAND_ROUNDS = 4;
const AUTOPICK_TO = 8;
const QUEUED = 3;

const api = process.env.API ?? 'http://localhost:18215';
const tokenFile = process.env.TOKEN_FILE;
if (!tokenFile) throw new Error('TOKEN_FILE is required');
const token = (await readFile(tokenFile, 'utf8')).trim();
const OUT = new URL('../../shared/fixtures/mock-room/', import.meta.url);

function settings(slot: number): Schemas['LeagueSettings'] {
	return {
		scoring: { preset: 'ppr', custom: null },
		teams: 12,
		slot,
		roster: { qb: 1, rb: 2, wr: 2, te: 1, k: 1, dst: 1, bench: 6 },
		lineup: 'standard',
		keepers: [],
		bot_style: 'adp'
	};
}

async function call<T>(method: string, path: string, body?: unknown): Promise<Envelope<T>> {
	const res = await fetch(`${api}${path}`, {
		method,
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	const envelope: Envelope<T> = await res.json();
	if (!res.ok || !envelope.ok) throw new Error(`${method} ${path} answered ${String(res.status)}`);
	return envelope;
}

/** Every answer, by its file's name, written once the drafts are done and their boards trimmed. */
const kept = new Map<string, Envelope<unknown>>();

function keep(name: string, envelope: Envelope<unknown>): void {
	kept.set(name, envelope);
}

/** The board's first players by its order a room's first screens draw, kept in every board. */
const BOARD_KEPT = 300;

/** Every player id an answer names outside its board: picks, the queue, a card's call, shortlist and
 * chances, a report's starters. */
function named(value: unknown, ids: Set<string>, key = ''): void {
	if (Array.isArray(value)) {
		for (const item of value) named(item, ids, key);
		return;
	}
	if (typeof value === 'string' && ['player_id', 'call', 'queue', 'player_ids'].includes(key)) {
		ids.add(value);
		return;
	}
	if (typeof value !== 'object' || value === null) return;
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		if (k === 'board') continue;
		if (k === 'still_there' && typeof v === 'object' && v !== null) {
			for (const id of Object.keys(v)) ids.add(id);
			continue;
		}
		named(v, ids, k);
	}
}

/** A board kept to its first BOARD_KEPT players and every player the answers name, in its order: the
 * apps' tests read the room from it, and the whole board (1,468 players) would make each file 400 KB. */
function trimmed(value: unknown, ids: ReadonlySet<string>): unknown {
	if (Array.isArray(value)) return value.map((item) => trimmed(item, ids));
	if (typeof value !== 'object' || value === null) return value;
	return Object.fromEntries(
		Object.entries(value).map(([k, v]) => {
			if (k !== 'board' || typeof v !== 'object' || v === null) return [k, trimmed(v, ids)];
			const board = v as { players: { id: string }[] };
			return [
				k,
				{ ...board, players: board.players.filter((p, i) => i < BOARD_KEPT || ids.has(p.id)) }
			];
		})
	);
}

async function write(): Promise<void> {
	const ids = new Set<string>();
	for (const envelope of kept.values()) named(envelope, ids);
	for (const [name, envelope] of kept) {
		const body = JSON.stringify(trimmed(envelope, ids), null, '\t');
		await writeFile(new URL(`${name}.json`, OUT), `${body}\n`);
	}
}

/** The turn's card: the one the answer carries, else the route's. */
async function cardOf(room: MockRoom, name: string): Promise<RoomCard> {
	if (room.card?.pick_number === room.pick_number) return room.card;
	const read = await call<RoomCard>('GET', `/mocks/${room.id ?? ''}/card`);
	keep(name, read);
	return read.data;
}

async function pickCall(room: MockRoom): Promise<Envelope<MockRoom>> {
	const card = await cardOf(room, `card-${String(room.pick_number)}`);
	return call<MockRoom>('POST', `/mocks/${room.id ?? ''}/picks`, {
		player_id: card.call,
		pick: room.pick_number
	});
}

async function recordFirst(): Promise<void> {
	const created = await call<MockRoom>('POST', '/mocks', { settings: settings(SLOT), seed: SEED });
	keep('create', created);
	const id = created.data.id ?? '';
	let room = created.data;
	await cardOf(room, 'card-first');
	for (let round = 1; round <= HAND_ROUNDS; round += 1) {
		const picked = await pickCall(room);
		keep(`pick-${String(round)}`, picked);
		room = picked.data;
	}
	const round5 = await call<MockRoom>('GET', `/mocks/${id}`);
	keep('round5', round5);
	await cardOf(round5.data, 'card-round5');
	const drafted = new Set(round5.data.picks.map((p) => p.player_id));
	const queue = (round5.data.board?.players ?? [])
		.filter((p) => !drafted.has(p.id))
		.slice(1, 1 + QUEUED)
		.map((p) => p.id);
	keep('queue', await call<MockRoom>('PUT', `/mocks/${id}/queue`, { player_ids: queue }));
	keep('shared-round5', await call<MockRoom>('GET', `/shared/mocks/${round5.data.share_code}`));
	const last = round5.data.picks.filter((p) => p.seat === SLOT).at(-1)?.pick ?? 0;
	const undone = await call<MockRoom>('POST', `/mocks/${id}/undo`, { pick: last });
	keep('undo', undone);
	keep('pick-again', await pickCall(undone.data));
	keep(
		'autopick',
		await call<MockRoom>('POST', `/mocks/${id}/autopick?to_round=${String(AUTOPICK_TO)}`)
	);
	const finished = await call<MockRoom>('POST', `/mocks/${id}/finish`);
	keep('finish', finished);
	keep('report', await call('GET', `/mocks/${id}/report`));
	keep('shared-complete', await call('GET', `/shared/mocks/${finished.data.share_code}`));
	keep('shared-report', await call('GET', `/shared/mocks/${finished.data.share_code}/report`));
}

/** Three picks by hand that a drafter regrets: a kicker, a defense and a second quarterback. */
async function recordDown(): Promise<void> {
	const created = await call<MockRoom>('POST', '/mocks', {
		settings: settings(DOWN_SLOT),
		seed: SEED
	});
	const id = created.data.id ?? '';
	let room = created.data;
	const board = created.data.board?.players ?? [];
	for (const position of ['K', 'DEF', 'QB'] as const) {
		const drafted = new Set(room.picks.map((p) => p.player_id));
		const target = board.find((p) => p.position === position && !drafted.has(p.id));
		if (!target) throw new Error(`no ${position} left`);
		room = (
			await call<MockRoom>('POST', `/mocks/${id}/picks`, {
				player_id: target.id,
				pick: room.pick_number
			})
		).data;
	}
	await call<MockRoom>('POST', `/mocks/${id}/finish`);
	keep('report-down', await call('GET', `/mocks/${id}/report`));
}

await mkdir(OUT, { recursive: true });
await recordFirst();
await recordDown();
await write();
process.stdout.write(`recorded into ${OUT.pathname}\n`);
