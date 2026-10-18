// Schedule strength in the run's own words (Lane 66n, review findings 4 and 11): the pages print the
// run's method and opponent basis as given, and those words name expected wins and never the
// sportsbook's figure. Read from the run contract's fixture, so a change to the nightly's words trips
// this test. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { clubsLead, scheduleLead, winsBasis } from './strength-words.ts';

const FIXTURE = new URL('../../../../research/nightly/contract/fixture/runs/', import.meta.url);
const BETTING = /\b(odds|line|spread|sportsbook|bets?)\b|\b(season|win) totals?\b|\bvegas\b/iu;

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
			assert.doesNotMatch(words, BETTING, words);
		}
	}
});

void test("the pages print the run's words as given", () => {
	const slate = {
		method: "the average of its opponents' expected wins for the season, one per game",
		window: { from: '2026-09-07T12:00:00.000Z', to: '2026-09-07T12:00:00.000Z' }
	};
	assert.equal(
		winsBasis('Expected wins, set before the season'),
		'Opponents show expected wins, set before the season.'
	);
	const lead = scheduleLead(slate, { count: 9, atLeast: '10.5' }, 5);
	assert.ok(lead.startsWith(`Strength is ${slate.method}, read Sep 7.`), lead);
	for (const line of [lead, clubsLead('PPR', slate)]) assert.doesNotMatch(line, BETTING, line);
});
