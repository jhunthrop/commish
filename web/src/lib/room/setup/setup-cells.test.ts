// The setup's settings table (Lane 66o): the facts two sentences once said, as cells, with the lobby's
// clock as the API gives it. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultSettings, setupCells } from './setup.ts';

void test('the setup says its format, teams, seat, rounds and clocks as cells', () => {
	const s = { ...defaultSettings(), slot: 4 };
	assert.deepEqual(
		setupCells(s, 15, { clock_seconds: 30 }).map((c) => [c.label, c.value]),
		[
			['Format', 'PPR'],
			['Teams', '12'],
			['Your seat', '4'],
			['Rounds', '15'],
			['Clock against bots', 'None'],
			['Clock in a lobby', '30 s a pick'],
			['A lobby starts', 'Full or 90 s']
		]
	);
});

void test('a random seat says so, a superflex league names its lineup, and no lobby read leaves its clock out', () => {
	const s = {
		...defaultSettings(),
		slot: null,
		lineup: 'superflex' as const,
		scoring: { preset: 'half_ppr' as const, custom: null }
	};
	const cells = setupCells(s, 16, undefined);
	assert.equal(cells.find((c) => c.label === 'Your seat')?.value, 'Random');
	assert.equal(cells.find((c) => c.label === 'Format')?.value, 'Half PPR, superflex');
	assert.equal(
		cells.some((c) => c.label === 'Clock in a lobby'),
		false
	);
});
