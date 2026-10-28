// A week read written before his designation changed (Lane 162, D01): through the page's build rule on
// the stand-in run's recorded capture and its recorded reads, at fixed clocks, then as the page and the
// shelf show it (week-read.ts). Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { designationsSchema, weekReadSchema, type WeekRead } from '#lib/run/schema.ts';
import { CARD } from './card.ts';
import {
	STATUS_HELD_WORDS,
	nextHourlyPass,
	readAtStatus,
	runCaptionDue,
	stampInstant,
	statusCaption,
	statusChangedSince
} from './status-held.ts';
import { shownWeekRead, type CardProjection } from './week-read.ts';

const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(new URL(`../../../scripts/${name}.json`, import.meta.url), 'utf8'));
const CAPTURE = designationsSchema.parse(fixture('standin-designations'));
const READS = (fixture('standin-week-reads') as { reads: (WeekRead & { id: string })[] }).reads;
const readOf = (id: string): WeekRead => {
	const found = READS.find((read) => read.id === id);
	if (!found) throw new Error(`The stand-in holds no read for ${id}.`);
	const { week, body, caption, status, call, writtenAt } = found;
	return weekReadSchema.parse({ week, body, caption, status, call, writtenAt, factsAt: null });
};

/** Travis Etienne Jr.: on injured reserve when his read was written Tuesday, due back Sunday Oct 18 on
 * the capture read after it (the Mason shape). */
const ETIENNE = '4239996';
/** The build's clock: Saturday Oct 17, noon Central, before his Sunday game. */
const BUILD = Date.parse('2026-10-17T17:00:00.000Z');
const DUE =
	'His status changed since this read was written. A new read is due by Sat Oct 17, 1:00 pm CT.';
const card = (state: CardProjection['state']): CardProjection => ({
	week: 6,
	scoring: 'ppr',
	points: null,
	state
});

void test('a read written before he became due back keeps its body under the status caption (D01, Lane 274)', () => {
	const read = readOf(ETIENNE);
	assert.equal(read.status, 'injured_reserve');
	assert.ok(read.body !== null);
	assert.equal(CAPTURE.players[ETIENNE]?.returning, '2026-10-18');
	const built = readAtStatus(read, CAPTURE, ETIENNE, BUILD);
	assert.deepEqual(built, { ...read, caption: DUE });
	// The page and the shelf show the read with the status caption over it, never the caption instead.
	const shown = { withheld: false, body: read.body, caption: DUE };
	assert.deepEqual(shownWeekRead(built, card('upcoming')), shown);
	assert.deepEqual(shownWeekRead(built, null), shown);
	// From kickoff no new read comes for the game: the caption is its lead alone (review M2).
	for (const state of ['kicked_off', 'final'] as const)
		assert.deepEqual(shownWeekRead(built, card(state)), {
			...shown,
			caption: STATUS_HELD_WORDS.changedLead
		});
	// Another week's game says nothing of this read's.
	assert.deepEqual(shownWeekRead(built, { ...card('kicked_off'), week: 7 }), shown);
});

void test('a read an older run already nulled keeps a caption alone, its passed due time restamped (old data)', () => {
	const runCaption =
		'His status changed since this read was written. A new read is due by Fri Oct 16, 10:00 pm CT.';
	const nulled = { ...readOf(ETIENNE), body: null, call: null, caption: runCaption };
	const built = readAtStatus(nulled, CAPTURE, ETIENNE, BUILD);
	assert.deepEqual(built, { ...nulled, caption: DUE });
	assert.deepEqual(shownWeekRead(built, card('upcoming')), { withheld: true, words: DUE });
	for (const state of ['kicked_off', 'final'] as const)
		assert.deepEqual(shownWeekRead(built, card(state)), {
			withheld: true,
			words: CARD.readNotWritten
		});
});

const CAPPED =
	'His status changed since this read was written. A new read is due by Sun Oct 18, 1:00 am CT.';

void test("the run's own status caption is said while its due time is ahead (Lane 275 N1, review H1)", () => {
	// Three falls since the write cap the rewrite: the run names the next day's first pass, which an
	// hourly guess of ours would put hours early.
	const sent = { ...readOf(ETIENNE), caption: CAPPED };
	assert.equal(runCaptionDue(sent), Date.parse('2026-10-18T06:00:00.000Z'));
	assert.equal(runCaptionDue(readOf(ETIENNE)), null);
	assert.equal(statusCaption(sent, CAPTURE, ETIENNE, BUILD), CAPPED);
	assert.deepEqual(shownWeekRead(readAtStatus(sent, CAPTURE, ETIENNE, BUILD), card('upcoming')), {
		withheld: false,
		body: sent.body,
		caption: CAPPED
	});
	// With no run caption the client says its own next hourly pass.
	assert.equal(statusCaption(readOf(ETIENNE), CAPTURE, ETIENNE, BUILD), DUE);
});

void test("once the run's due time has passed the client says its own next pass, never a time gone by (review H1)", () => {
	const sent = { ...readOf(ETIENNE), caption: CAPPED };
	// Sunday 2:00 am Central, an hour after the run's due time: the next pass is 6 am Eastern.
	const later = Date.parse('2026-10-18T07:00:00.000Z');
	assert.equal(
		statusCaption(sent, CAPTURE, ETIENNE, later),
		'His status changed since this read was written. A new read is due by Sun Oct 18, 5:00 am CT.'
	);
	// At the very due time it has passed too.
	assert.notEqual(
		statusCaption(sent, CAPTURE, ETIENNE, Date.parse('2026-10-18T06:00:00.000Z')),
		CAPPED
	);
});

void test('a status the capture says changed back stands: the run caption is not the arbiter (review M1)', () => {
	const ir = {
		status: 'injured_reserve',
		seasonLong: true,
		since: '2026-10-01T15:00:00.000Z'
	} as const;
	const still = { ...CAPTURE, players: { ...CAPTURE.players, [ETIENNE]: ir } };
	const sent = { ...readOf(ETIENNE), caption: CAPPED };
	assert.equal(statusCaption(sent, still, ETIENNE, BUILD), null);
	assert.equal(statusCaption(sent, null, ETIENNE, BUILD), null);
});

void test('a caption stamp reads back to its instant: daylight, standard, the year after the write', () => {
	const written = '2026-10-13T21:00:00.000Z';
	assert.equal(
		stampInstant('Sun Oct 18, 1:00 am CT', written),
		Date.parse('2026-10-18T06:00:00.000Z')
	);
	assert.equal(
		stampInstant('Mon Nov 2, 1:00 am CT', written),
		Date.parse('2026-11-02T07:00:00.000Z')
	);
	assert.equal(
		stampInstant('Sat Oct 17, 12:00 pm CT', written),
		Date.parse('2026-10-17T17:00:00.000Z')
	);
	assert.equal(
		stampInstant('Fri Jan 1, 1:00 am CT', '2026-12-30T21:00:00.000Z'),
		Date.parse('2027-01-01T07:00:00.000Z')
	);
	// A weekday that names no day of either year, and words that are no stamp.
	assert.equal(stampInstant('Tue Oct 18, 1:00 am CT', written), null);
	assert.equal(stampInstant('soon', written), null);
});

void test('a read written after the capture was read is the one the writer read against: it stands', () => {
	// The same read, written after the capture's stamp: the writer saw that very list (status read again).
	const after = {
		...readOf(ETIENNE),
		writtenAt: '2026-10-14T03:00:00.000Z',
		status: 'questionable'
	};
	assert.equal(readAtStatus(after, CAPTURE, ETIENNE, BUILD), after);
	// A read written after the capture, against another status, is not judged by an older list either.
	const older = { ...after, status: 'injured_reserve' };
	assert.equal(statusChangedSince(older, CAPTURE, CAPTURE.players[ETIENNE]), false);
});

void test('a read whose status has not changed stands: the run serves it as written', () => {
	const read = readOf(ETIENNE);
	// On the list when written and still on it, his run begun before the read.
	const ir = {
		status: 'injured_reserve',
		seasonLong: true,
		since: '2026-10-01T15:00:00.000Z'
	} as const;
	const still = { ...CAPTURE, players: { ...CAPTURE.players, [ETIENNE]: ir } };
	assert.equal(readAtStatus(read, still, ETIENNE, BUILD), read);
	// A player the capture does not list, his read written against no designation.
	const nacua = readOf('4426515');
	const before = { ...nacua, writtenAt: '2026-10-13T21:00:00.000Z' };
	assert.equal(readAtStatus(before, CAPTURE, '4426515', BUILD), before);
	// No capture: nothing to judge it by.
	assert.equal(readAtStatus(read, null, ETIENNE, BUILD), read);
});

void test('the same status in a run that began after the read is a change: off the list and back on', () => {
	const read = readOf(ETIENNE);
	const back = {
		...CAPTURE,
		players: {
			...CAPTURE.players,
			[ETIENNE]: { status: 'injured_reserve', seasonLong: true, since: '2026-10-14T01:00:00.000Z' }
		}
	} as const;
	assert.equal(readAtStatus(read, back, ETIENNE, BUILD).caption, DUE);
	assert.equal(readAtStatus(read, back, ETIENNE, BUILD).body, read.body);
	// Cleared from the list since: no designation where the read says injured reserve.
	const rest = Object.fromEntries(Object.entries(CAPTURE.players).filter(([id]) => id !== ETIENNE));
	assert.equal(readAtStatus(read, { ...CAPTURE, players: rest }, ETIENNE, BUILD).caption, DUE);
});

void test('the next hourly pass follows the capture schedule, as the run says it (caption.py)', () => {
	const at = (iso: string): string => new Date(nextHourlyPass(Date.parse(iso))).toISOString();
	// The run's cases (research/tests/test_week_read_status.py).
	assert.equal(at('2026-10-17T02:00:00.000Z'), '2026-10-17T03:00:00.000Z');
	assert.equal(at('2026-10-17T06:30:00.000Z'), '2026-10-17T10:00:00.000Z');
	assert.equal(at('2026-10-17T14:00:00.000Z'), '2026-10-17T15:00:00.000Z');
	assert.equal(at('2026-10-18T03:30:00.000Z'), '2026-10-18T04:00:00.000Z');
	assert.equal(at('2026-10-18T04:30:00.000Z'), '2026-10-18T06:00:00.000Z');
	// The run's caption at its Friday 10 pm Eastern instant.
	const caption = readAtStatus(
		readOf(ETIENNE),
		CAPTURE,
		ETIENNE,
		Date.parse('2026-10-17T02:00:00.000Z')
	);
	assert.equal(
		caption.caption,
		'His status changed since this read was written. A new read is due by Fri Oct 16, 10:00 pm CT.'
	);
});
