// Schedule strength in the run's own words (Lane 66n, review findings 4 and 11): the pages print the
// run's method and opponent basis as given, and those words name expected wins and never the
// sportsbook's figure. Read from the run contract's fixture, so a change to the nightly's words trips
// this test. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { BANNED_WORDS } from '#lib/format/copy-guard.ts';
import {
	clubsLead,
	scheduleLead,
	STRENGTH_HEADS,
	strengthFigure,
	strengthView,
	winsBasis
} from './strength-words.ts';

const FIXTURE = new URL('../../../../research/nightly/contract/fixture/runs/', import.meta.url);

interface ScheduleFile {
	opponentBasis: string;
	slates: { method: string; window: { from: string; to: string } }[];
}

const schedules: ScheduleFile[] = readdirSync(FIXTURE).map(
	(run) =>
		JSON.parse(readFileSync(new URL(`${run}/schedule.json`, FIXTURE), 'utf8')) as ScheduleFile
);

void test("the run's words name expected wins and no betting figure", () => {
	assert.ok(schedules.length > 0);
	for (const schedule of schedules) {
		const [slate] = schedule.slates;
		if (!slate) throw new Error('A schedule with no slate.');
		for (const words of [schedule.opponentBasis, slate.method]) {
			assert.match(words, /expected wins/iu, words);
			assert.doesNotMatch(words, BANNED_WORDS, words);
		}
	}
});

void test("the pages print the run's words as given", () => {
	const slate = {
		method: "the average of each club's opponents' expected wins for the season, one per game",
		window: { from: '2026-09-07T12:00:00.000Z', to: '2026-09-07T12:00:00.000Z' }
	};
	assert.equal(
		winsBasis('Expected wins, set before the season'),
		'Opponents show expected wins, set before the season.'
	);
	const view = { ...slate, kind: 'preseason' as const, strength: 9.3, rank: 4 };
	const lead = scheduleLead(view, { count: 9, atLeast: '10.5' }, { complete: 5, partial: null });
	assert.ok(lead.startsWith(`Preseason strength is ${slate.method}, read Sep 7.`), lead);
	for (const line of [lead, clubsLead('PPR', view)]) assert.doesNotMatch(line, BANNED_WORDS, line);
});

const SLATE = {
	strength: 9.3,
	rank: 4,
	method: "the average of each club's opponents' expected wins for the season, one per game",
	window: { from: '2026-09-07T12:00:00.000Z', to: '2026-09-07T12:00:00.000Z' },
	rest: {
		strength: 8.1,
		rank: 20,
		method:
			"the average of each club's remaining opponents' expected wins, one per game still to play, set before the first kickoff"
	}
};

void test('in season the strength is the rest of season, headed so; before it the preseason (Lane 80)', () => {
	assert.deepEqual(strengthView(SLATE, false), {
		kind: 'preseason',
		strength: 9.3,
		rank: 4,
		method: SLATE.method,
		window: SLATE.window
	});
	const rest = strengthView(SLATE, true);
	assert.deepEqual(rest, { kind: 'rest', ...SLATE.rest, window: SLATE.window });
	assert.equal(STRENGTH_HEADS.rest, 'Rest of season strength');
	assert.equal(STRENGTH_HEADS.preseason, 'Preseason strength');
	const monday = { complete: 5, partial: { week: 6, days: ['Thursday'], games: 1 } };
	assert.equal(
		scheduleLead(rest, { count: 9, atLeast: '10.5' }, monday),
		`Rest of season strength is ${SLATE.rest.method}, read Sep 7. Hardest first, the 9 highest opponents shaded (10.5 or more), weeks 1 to 5 and week 6's Thursday game are played, so faded.`
	);
});

void test('in season on a run with no rest of season: no strength, no sort, no sentence (Lane 80)', () => {
	const old = { ...SLATE, rest: undefined };
	assert.equal(strengthView(old, true), null);
	assert.equal(strengthView({ ...SLATE, rest: null }, true), null);
	assert.equal(
		scheduleLead(null, { count: 9, atLeast: '10.5' }, { complete: 5, partial: null }),
		'The 9 highest opponents shaded (10.5 or more), weeks 1 to 5 are played, so faded.'
	);
	assert.equal(clubsLead('PPR', null), "Every club's players on our PPR board.");
});

void test("a slate's strength prints one tenth like every other figure (the sweep's X9)", () => {
	assert.equal(strengthFigure(9.3), '9.3');
	assert.equal(strengthFigure(10), '10.0');
});
