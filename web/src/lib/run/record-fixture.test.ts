// The record shots run's record (scripts/record-fixture/record.json, Lane 82) is live's shape and the
// web's own: run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { publishedDrawn, recordBasis } from './record.ts';
import { recordSchema } from './schema.ts';

const fixture = recordSchema.parse(
	JSON.parse(
		readFileSync(new URL('../../../scripts/record-fixture/record.json', import.meta.url), 'utf8')
	)
);

void test('the shots record has six graded weeks and Published kept from week 7, graded on no row', () => {
	const graded = fixture.weeks.filter((week) => week.status === 'graded').map((w) => w.week);
	assert.deepEqual(graded, [1, 2, 3, 4, 5, 6]);
	assert.equal(fixture.weeks.find((week) => week.week === 7)?.status, 'frozen');
	assert.equal(fixture.publishedFromWeek, 7);
	assert.equal(publishedDrawn(fixture), false);
	assert.deepEqual(
		fixture.toDate.map((line) => line.position),
		['All', 'QB', 'RB', 'WR', 'TE']
	);
});

void test('its dates agree with the run it is shot in: frozen by it, week 7 frozen before it', () => {
	const manifest = JSON.parse(
		readFileSync(
			new URL(
				'../../../../research/nightly/contract/fixture/runs/2026-10-21T12-ros/manifest.json',
				import.meta.url
			),
			'utf8'
		)
	) as { runAt: string };
	const frozen = fixture.weeks.filter((week) => week.frozenBy !== null);
	assert.ok(frozen.every((week) => week.frozenBy === '2026-10-21T12-live-shape'));
	for (const week of frozen) {
		assert.ok((week.frozenAt ?? '') < manifest.runAt, `week ${String(week.week)}`);
		assert.ok((week.gradedAt ?? '') < manifest.runAt, `week ${String(week.week)} graded`);
	}
});

void test('its basis names ADP alone and says nothing of Published before its column is drawn', () => {
	const said = recordBasis(fixture).join(' ');
	assert.ok(said.includes('ADP on the same players.'), said);
	assert.ok(!said.includes('ADP and Published'), said);
	assert.ok(!said.includes('published projection'), said);
	assert.ok(!said.includes('capture'), said);
});
