// The draft room, the call card and the report speak fantasy words, never the betting register:
// "odds" is one (Lane 66m). The pool's chance a player lasts is "still there", any other probability a
// "chance". Every file the rooms and their reports are drawn from is read whole, comments too, so the
// word cannot come back in a string, a label or the note that explains one. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { BETTING_WORDS, bannedPattern } from '#lib/format/copy-guard.ts';
import { callView, chanceHead, draftWords, poolBasis } from './call.ts';
import type { RoomCard } from './api.ts';
import type { Board, RoomPlayer } from './model.ts';

/** The betting register's words a source scan reads (format/copy-guard.ts), matched whole; the room's
 * own copy is held to the whole list. */
const BETTING = BETTING_WORDS;
const BANNED = bannedPattern();

const SRC = fileURLToPath(new URL('../../', import.meta.url));
/** Where the rooms, the call card and the reports are drawn from. */
const ROOTS = [
	'lib/room',
	'lib/companion',
	'lib/ui/CallPanel.svelte',
	'lib/ui/StillThereCell.svelte',
	'lib/format/draft.ts',
	'routes/mock',
	'routes/lobby'
];

function filesUnder(path: string): string[] {
	const full = join(SRC, path);
	if (!statSync(full).isDirectory()) return [path];
	return readdirSync(full).flatMap((name) => filesUnder(join(path, name)));
}

const SOURCES = ROOTS.flatMap(filesUnder).filter(
	(file) => /\.(ts|svelte)$/.test(file) && !file.endsWith('copy-guard.test.ts')
);

void test('the room, the call card and the report sources never say a betting word', () => {
	assert.ok(SOURCES.length > 20, `read ${String(SOURCES.length)} files`);
	const hits = SOURCES.flatMap((file) =>
		readFileSync(join(SRC, file), 'utf8')
			.split('\n')
			.flatMap((line, i) =>
				BETTING.test(line) ? [`${file}:${String(i + 1)}: ${line.trim()}`] : []
			)
	);
	assert.deepEqual(hits, []);
});

const player = (id: string, name: string, vor: number): RoomPlayer => ({
	id,
	name,
	position: 'RB',
	positionRank: 1,
	team: 'DET',
	headshot: '',
	adp: 10,
	points: 200,
	vor,
	vorRound: 1,
	bye: 8
});

const BOARD: Board = {
	players: [],
	byId: new Map(),
	basis: 'Ranked by our PPR points over replacement.',
	season: 2026,
	format: 'ppr'
};

const card = (source: 'advisor' | 'runs'): RoomCard =>
	({ next_pick: 17, runs: 200, source }) as unknown as RoomCard;

void test('the pool basis names the chance a player is still there, never odds', () => {
	const said = [
		poolBasis(BOARD, null, 12, true),
		poolBasis(BOARD, null, 12),
		poolBasis(BOARD, card('advisor'), 12),
		poolBasis(BOARD, card('runs'), 12)
	];
	for (const line of said) assert.doesNotMatch(line, BANNED, line);
	assert.equal(
		said[3],
		'Ranked by our PPR points over replacement. Still there at 2.05: 200 runs of this room, each seat drafting as it has so far.'
	);
});

void test('the call card is our top three as rows, its chance column headed still there', () => {
	const call = player('a', 'Jahmyr Gibbs', 40);
	const second = player('b', 'Bijan Robinson', 50);
	const third = player('c', 'Puka Nacua', 30);
	const gone = player('d', 'Ja Marr Chase', 60);
	const everyone = [call, second, third, gone];
	const board: Board = {
		...BOARD,
		players: everyone,
		byId: new Map(everyone.map((p) => [p.id, p] as const))
	};
	const roomCard = {
		for_pick: 5,
		next_pick: 20,
		call: 'a',
		conditional: false,
		shortlist: [{ player_id: 'd' }, { player_id: 'a' }, { player_id: 'b' }, { player_id: 'c' }],
		still_there: { a: 0.2, b: 0.7 }
	} as unknown as RoomCard;
	const view = callView(roomCard, board, new Set(['d']), 12);
	assert.ok(view);
	assert.deepEqual(
		view.rows.map((r) => [r.player.id, r.chance]),
		[
			['a', 0.2],
			['b', 0.7],
			['c', null]
		]
	);
	const head = chanceHead(view);
	assert.equal(head, 'Still there 2.08');
	assert.doesNotMatch(head, BANNED);
	assert.equal(chanceHead({ ...view, nextLabel: null }), null);
	assert.equal(chanceHead({ ...view, conditional: true }), 'Reaches 1.05');
	assert.equal(draftWords('RB'), 'Draft him');
	assert.equal(draftWords('DST', 'Queue'), 'Queue them');
});

void test("a player's surname the room draws is marked as his name, so the shots' guard reads it as data (the sweep's C8)", () => {
	for (const file of [
		'lib/room/Wall.svelte',
		'lib/ui/PickStrip.svelte',
		'lib/room/SoloRoom.svelte'
	]) {
		const source = readFileSync(join(SRC, file), 'utf8');
		const drawn = source.match(/[^\n]*\{lastName\([^\n]*/gu) ?? [];
		assert.ok(drawn.length > 0, file);
		for (const line of drawn) assert.match(line, /data-name/u, `${file}: ${line.trim()}`);
	}
});
