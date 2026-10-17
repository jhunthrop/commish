// The draft room, the call card and the report speak fantasy words, never the betting register:
// "odds" is one (Lane 66m). The pool's chance a player lasts is "still there", any other probability a
// "chance". Every file the rooms and their reports are drawn from is read whole, comments too, so the
// word cannot come back in a string, a label or the note that explains one. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { poolBasis, runnerWords, type CallView } from './call.ts';
import type { RoomCard } from './api.ts';
import type { Board, RoomPlayer } from './model.ts';

/** The betting register's words, matched whole. */
const BETTING =
	/\b(odds|bets?|betting|wagers?|vegas|sportsbooks?|parlays?|underdogs?|favou?rites?)\b/i;

const SRC = fileURLToPath(new URL('../../', import.meta.url));
/** Where the rooms, the call card and the reports are drawn from. */
const ROOTS = [
	'lib/room',
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
	for (const line of said) assert.doesNotMatch(line, BETTING, line);
	assert.equal(
		said[3],
		'Ranked by our PPR points over replacement. Still there at 2.05 is read from 200 runs of this room, every seat drafting the way it has so far.'
	);
});

void test("the runner-up's sentence says still there", () => {
	const view: CallView = {
		player: player('a', 'Jahmyr Gibbs', 40),
		chance: 0.2,
		runner: player('b', 'Bijan Robinson', 50),
		runnerChance: 0.7,
		forLabel: '1.05',
		nextLabel: '2.08',
		conditional: false,
		why: null
	};
	const words = runnerWords(view);
	assert.ok(words);
	assert.doesNotMatch(words.rest, BETTING);
	assert.match(words.rest, /still there at 2\.08 70% of the time/);
});
