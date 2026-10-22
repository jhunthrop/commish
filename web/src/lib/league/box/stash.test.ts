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
	backWords,
	countWords,
	gainGroups,
	HEAD_BASIS,
	headBasis,
	headBasisText,
	namesOnScreen,
	poolRows,
	STASH,
	stashBasis,
	stashRows,
	WAIVERS
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
/** The sense check's case (FIXTURE_IR_DROP): Achane on injured reserve back week 9, Royer out back
 * week 8; with one IR slot open on the member's team (FIXTURE_IR_SLOT) or none. */
const withSlot = listedOnly(irDropWaivers(stored), true);
const noSlot = listedOnly(irDropWaivers(stored), false);
const ACHANE = "De'Von Achane";
const ROYER = 'Joe Royer';

void test('the Stash group holds the two due back, by the rate his player page shows, each saying his week', () => {
	const rows = stashRows(withSlot, ZONE, NOW);
	assert.deepEqual(
		rows.map((r) => [r.row.name, r.stash?.back]),
		[
			[ACHANE, STASH.back(9)],
			[ROYER, STASH.back(8)]
		]
	);
	// A game is his rest-of-season points a game, the player page's figure, never re-divided over
	// the games after his return (fix round 1, HIGH-1); the group sorts by it.
	for (const r of rows) assert.equal(r.rest, r.source.add.rest_of_season_per_game);
	const rates = rows.map((r) => r.rest ?? Number.NEGATIVE_INFINITY);
	assert.deepEqual(
		rates,
		[...rates].sort((x, y) => y - x)
	);
	assert.ok(rows.every((r) => !r.gains && r.beats.gain === null));
});

void test('a return in the week the page addresses reads Back this week', () => {
	assert.equal(backWords(7, 7), STASH.backNow);
	assert.equal(backWords(9, 7), STASH.back(9));
});

void test('an open IR slot that takes him is Stash, naming the drop a full roster needs; else Add naming it', () => {
	const byName = new Map(stashRows(withSlot, ZONE, NOW).map((r) => [r.row.name, r]));
	const achane = byName.get(ACHANE);
	const royer = byName.get(ROYER);
	assert.ok(achane?.stash && royer?.stash);
	// The IR slot frees no bench spot until the platform moves him: the stand-in's full roster names
	// the gaining rows' drop (fix round 1 ruling).
	assert.equal(achane.stash.verb, 'stash');
	assert.equal(achane.stash.who?.place, STASH.drop);
	assert.equal(achane.stash.drops, true);
	// The out player: the slot here takes no out, so his verb is Add with his drop.
	assert.equal(royer.stash.verb, 'add');
	assert.equal(royer.stash.who?.place, STASH.drop);
	const shut = stashRows(noSlot, ZONE, NOW);
	assert.ok(shut.every((r) => r.stash?.verb === 'add'));
	// A bench spot open as well: Stash with no drop, the slot named.
	const benchOpen = {
		...withSlot,
		stash: (withSlot.stash ?? []).map((r) => ({ ...r, drop: null, drops: [] }))
	};
	const open = stashRows(benchOpen, ZONE, NOW).find((r) => r.row.name === ACHANE);
	assert.ok(open?.stash);
	assert.deepEqual(open.stash.who, { name: STASH.slot, place: STASH.open });
	assert.equal(open.stash.drops, false);
});

void test('the group never counts with the rows that gain, and the table no longer lists them', () => {
	const rows = poolRows(withSlot, ZONE, NOW);
	assert.ok(!rows.some((r) => r.row.name === ACHANE || r.row.name === ROYER));
	const before = countWords(rows, 'sleeper');
	const groups = gainGroups(rows);
	assert.equal(groups.gaining.length + groups.rest.length, rows.length);
	assert.match(before, new RegExp(`^${String(rows.length)} free agents`));
	assert.ok(namesOnScreen(withSlot).includes(ACHANE));
});

void test("the group's line says where the week comes from, what A game is, and the unlisted once", () => {
	// The capture's undated lists (Thornton on IR among them, Lane 132) are said once under the line.
	assert.deepEqual(stashBasis(withSlot), [STASH.line, STASH.undated]);
	assert.equal(
		STASH.line,
		'Stash rows come back by the listed return date. A game is our rest-of-season points a game.'
	);
	// A game is defined one way on the screen (Lane 121, B99): the line says the heads' own words.
	const heads = headBasisText(headBasis(null, true, { zone: ZONE, zoned: false }));
	assert.ok(heads.includes(`${WAIVERS.rest} ${HEAD_BASIS.rest}`), heads);
	assert.ok(STASH.line.includes(`${WAIVERS.rest} ${HEAD_BASIS.rest}.`));
	assert.deepEqual(stashBasis({ stash: [], stash_undated: 3 }), [STASH.undated]);
	assert.deepEqual(stashBasis({ ...withSlot, stash_undated: 1, stash_late: 2 }), [
		STASH.line,
		STASH.undated,
		STASH.late
	]);
	for (const words of [
		STASH.line,
		STASH.undated,
		STASH.late,
		STASH.taken(14),
		STASH.back(9),
		STASH.backNow
	]) {
		assert.equal(bannedIn(words), null, words);
	}
});

void test('a regular season the platform does not state is said where the group keeps to it', () => {
	// FFPC and MyFantasyLeague with neither the playoffs' first week nor a playoff start (Lane 121, B99).
	const taken = { ...withSlot, regular_season_taken: 14 };
	assert.equal(STASH.taken(14), 'Regular season taken as weeks 1 to 14.');
	assert.deepEqual(stashBasis(taken), [STASH.line, STASH.undated, STASH.taken(14)]);
	assert.deepEqual(stashBasis({ ...taken, stash: [], stash_undated: 0, stash_late: 1 }), [
		STASH.late,
		STASH.taken(14)
	]);
	// Nothing the group shows keeps to the season's end: no rows, none left out as late.
	assert.deepEqual(stashBasis({ ...taken, stash: [], stash_undated: 2 }), [STASH.undated]);
	assert.deepEqual(stashBasis({ ...taken, stash: [], stash_undated: 0 }), []);
	// Stated by the platform, or an answer from before Lane 121: nothing taken is said.
	assert.deepEqual(stashBasis(withSlot), [STASH.line, STASH.undated]);
});

void test('an answer from before the group parses: no rows, no line, no group', () => {
	const older: WaiverAdvice = { ...withSlot };
	delete older.stash;
	delete older.stash_undated;
	delete older.stash_late;
	assert.deepEqual(stashRows(older, ZONE, NOW), []);
	assert.deepEqual(stashBasis(older), []);
});
