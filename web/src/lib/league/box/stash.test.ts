// The Waivers Stash group (Lane 118, B79), through the stand-in API's answer from the fixture league
// at the fixture's Saturday clock: run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bannedIn } from '#lib/format/copy-guard.ts';
import { FIXTURE_WEEK_CLOCK } from '../../../../scripts/inseason-fixture/clock.ts';
import { inTenths } from '../../../../scripts/inseason-fixture/tenths.ts';
import { irDropWaivers, listedOnly } from '../../../../scripts/inseason-fixture/waiver-beats.ts';
import type { WaiverAdvice } from '../inseason/api.ts';
import {
	countWords,
	gainGroups,
	namesOnScreen,
	poolRows,
	STASH,
	stashBasis,
	stashRows
} from './waivers.ts';

const ZONE = 'America/Chicago';
const NOW = Date.parse(FIXTURE_WEEK_CLOCK);
const stored = inTenths(
	JSON.parse(
		readFileSync(
			new URL('../../../../scripts/inseason-fixture/data/waivers.json', import.meta.url),
			'utf8'
		)
	)
) as WaiverAdvice;
/** The sense check's case (FIXTURE_IR_DROP): Achane on injured reserve back week 9, Thornton out back
 * week 8; with one IR slot open on the member's team (FIXTURE_IR_SLOT) or none. */
const withSlot = listedOnly(irDropWaivers(stored), true);
const noSlot = listedOnly(irDropWaivers(stored), false);
const ACHANE = "De'Von Achane";
const THORNTON = 'Tyquan Thornton';

void test('the Stash group holds the two due back, by their rate from then, each saying his week', () => {
	const rows = stashRows(withSlot, ZONE, NOW);
	assert.deepEqual(
		rows.map((r) => [r.row.name, r.stash?.back]),
		[
			[ACHANE, STASH.back(9)],
			[THORNTON, STASH.back(8)]
		]
	);
	// A game is the rate from his return week, above the season figure he was listed at.
	const achane = rows[0];
	assert.ok(achane !== undefined && achane.rest !== null);
	assert.ok(achane.rest > (achane.source.add.rest_of_season_per_game ?? Infinity));
	assert.ok(rows.every((r) => !r.gains && r.beats.gain === null));
});

void test('an open IR slot that takes him is Stash with the slot named, else Add naming the drop', () => {
	const byName = new Map(stashRows(withSlot, ZONE, NOW).map((r) => [r.row.name, r]));
	const achane = byName.get(ACHANE);
	const thornton = byName.get(THORNTON);
	assert.ok(achane?.stash && thornton?.stash);
	assert.equal(achane.stash.verb, 'stash');
	assert.deepEqual(achane.stash.who, { name: STASH.slot, place: STASH.open });
	assert.equal(achane.source.drop, null);
	// The out player: the slot here takes no out, so he takes a roster spot and names his drop.
	assert.equal(thornton.stash.verb, 'add');
	assert.equal(thornton.stash.who?.place, STASH.drop);
	assert.notEqual(thornton.source.drop, null);
	const shut = stashRows(noSlot, ZONE, NOW);
	assert.ok(shut.every((r) => r.stash?.verb === 'add'));
});

void test('the group never counts with the rows that gain, and the table no longer lists them', () => {
	const rows = poolRows(withSlot, ZONE, NOW);
	assert.ok(!rows.some((r) => r.row.name === ACHANE || r.row.name === THORNTON));
	const before = countWords(rows, 'sleeper');
	const groups = gainGroups(rows);
	assert.equal(groups.gaining.length + groups.rest.length, rows.length);
	assert.match(before, new RegExp(`^${String(rows.length)} free agents`));
	assert.ok(namesOnScreen(withSlot).includes(ACHANE));
});

void test("the group's line says the week each comes back and the undated ones once", () => {
	assert.deepEqual(stashBasis(withSlot), [STASH.backEach]);
	const one = { ...withSlot, stash: (withSlot.stash ?? []).slice(0, 1) };
	assert.deepEqual(stashBasis(one), [STASH.backOne(9)]);
	assert.equal(
		STASH.backOne(9),
		"Stash rows come back week 9 by the platform's return date, their rate counts from then."
	);
	assert.deepEqual(stashBasis({ stash: [], stash_undated: 3 }), [STASH.undated]);
	assert.deepEqual(stashBasis({ ...withSlot, stash_undated: 1 }), [STASH.backEach, STASH.undated]);
	for (const words of [STASH.backEach, STASH.backOne(9), STASH.undated, STASH.back(9)]) {
		assert.equal(bannedIn(words), null, words);
	}
});

void test('an answer from before the group parses: no rows, no line, no group', () => {
	const older: WaiverAdvice = { ...withSlot };
	delete older.stash;
	delete older.stash_undated;
	assert.deepEqual(stashRows(older, ZONE, NOW), []);
	assert.deepEqual(stashBasis(older), []);
});
