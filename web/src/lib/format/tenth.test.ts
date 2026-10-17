// The site's one rounding rule (Lane 66k H1): the API rounds every figure once to a tenth (api
// internal/tenth, whose test reads this same table), and the web prints that tenth as given. These
// checks hold the web to formatting alone: every tenth the API can send prints as itself, with no
// rounding of its own. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { boxNumber } from '#lib/league/box/box.ts';
import { fixed, signed } from './number.ts';

interface Row {
	in: number;
	out: number;
}

const rows = JSON.parse(
	readFileSync(new URL('./tenth-table.json', import.meta.url), 'utf8')
) as Row[];

void test('every tenth the API sends prints as itself, never rounded again', () => {
	for (const { out } of rows) {
		const said = fixed(out, 1);
		assert.equal(Number(said), out, `${String(out)} printed as ${said}`);
		assert.equal(boxNumber(out), said);
		assert.equal(Number(signed(out).replace('−', '-')), out === 0 ? 0 : out);
	}
});

void test('the table is the API rule: half away from zero on the decimal', () => {
	assert.deepEqual(
		rows.slice(0, 6).map((r) => [r.in, r.out]),
		[
			[9.45, 9.5],
			[9.449, 9.4],
			[1.15, 1.2],
			[10.35, 10.4],
			[0.25, 0.3],
			[0.75, 0.8]
		]
	);
});
