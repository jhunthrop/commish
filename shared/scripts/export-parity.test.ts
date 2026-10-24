// The parity export: the web's League home readers over the shared fixtures, the file the apps' ports
// are held to. Run with `node --test shared/scripts/*.test.ts`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLOCKS, generate, instantOf, OUTPUT } from './export-parity.ts';

void test('a file clock reads back as its instant', () => {
	assert.equal(instantOf('2026-10-18T18-56-00Z'), '2026-10-18T18:56:00.000Z');
});

void test('every clock carries the bugs, the twelve standings rows and a team basis', async () => {
	const parity = JSON.parse((await generate()).get(OUTPUT) ?? '{}') as {
		clocks: Record<string, { bugs: unknown[]; standings: { me: boolean }[]; teamBasis: string }>;
		moves: unknown[];
		seeding: string | null;
	};
	assert.deepEqual(Object.keys(parity.clocks), [...CLOCKS]);
	for (const clock of CLOCKS) {
		const home = parity.clocks[clock];
		assert.equal(home?.bugs.length, 6, clock);
		assert.equal(home?.standings.length, 12, clock);
		assert.equal(home?.standings.filter((r) => r.me).length, 1, clock);
		assert.match(home?.teamBasis ?? '', /^A team's Proj adds/, clock);
	}
	assert.equal(parity.moves.length, 15);
	assert.match(parity.seeding ?? '', /^FFPC seeds 4 for the playoffs/);
});
