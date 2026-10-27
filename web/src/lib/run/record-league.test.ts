// The record opened from a league (Lane 93 fix round 1): one lineup for the page, read by the tiles,
// the table and every sentence, so the honest sentence counts the league's starters as the tiles
// above it do. On the live record (record-fixture/record-live.json). Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	honestWords,
	leagueBasis,
	leagueView,
	pageLineup,
	shownRecord,
	weekSentence,
	type LeagueRecord,
	type PlayersByWeek
} from './record-league.ts';
import { STANDARD_LINEUP } from './record-starters.ts';
import { recordSchema } from './schema.ts';

const live = recordSchema.parse(
	JSON.parse(
		readFileSync(
			new URL('../../../scripts/record-fixture/record-live.json', import.meta.url),
			'utf8'
		)
	)
);
const players: PlayersByWeek = Object.fromEntries(
	live.weeks.flatMap((week) => (week.players === undefined ? [] : [[week.week, week.players]]))
);
const espn: LeagueRecord = {
	host: 'espn',
	teams: 12,
	lineup: { qb: 1, rb: 2, wr: 2, te: 1, flex: 1, super_flex: 0, k: 1, def: 1, bench: 7 },
	weeks: []
};

void test('the page counts the league lineup only with the league and the graded players read', () => {
	assert.deepEqual(pageLineup(live, null, players), { lineup: STANDARD_LINEUP, league: false });
	assert.equal(pageLineup(live, espn, {}).league, false, 'no players, the run lineup');
	assert.equal(pageLineup(live, espn, players).league, true);
});

void test("on a league page the honest sentence counts the league's starters, as the tiles do", () => {
	const lineup = pageLineup(live, espn, players);
	const shown = shownRecord(live, players, lineup);
	const all = shown.toDate.find((line) => line.position === 'All');
	assert.deepEqual([all?.ours.starters, all?.adp?.starters, all?.ours.startersOf], [101, 107, 168]);
	assert.equal(
		honestWords(live, shown, lineup),
		"ADP had more of the week's starters right, 107 of 168 against our 101."
	);
	const standard = pageLineup(live, null, players);
	assert.equal(honestWords(live, live, standard), live.honest);
	assert.match(live.honest ?? '', /in the standard lineup, 104 of 168 against our 100/u);
});

void test("the league's basis names its lineup across its teams and its own benchmark", () => {
	const said = leagueBasis(espn, pageLineup(live, espn, players));
	assert.equal(
		said.starters,
		"Starters right counts the week's starters the order also put in your league's lineup, QB, 2 RB, 2 WR, TE and a flex across 12 teams, kickers and defenses not counted."
	);
	const noKickers = { ...espn, lineup: { ...espn.lineup, k: 0, def: 0 } };
	assert.match(
		leagueBasis(noKickers, pageLineup(live, noKickers, players)).starters ?? '',
		/a flex across 12 teams\.$/u
	);
	assert.match(
		said.benchmark ?? '',
		/^In your ESPN league, from week 7 each graded week also grades our order and ESPN's/u
	);
	assert.equal(leagueBasis(espn, pageLineup(live, espn, {})).starters, null);
});

void test("the page's league view says the record, honest sentence and basis in the league's lineup", () => {
	const view = leagueView(live, espn, players);
	const lineup = pageLineup(live, espn, players);
	const shown = shownRecord(live, players, lineup);
	assert.deepEqual(view.record, shown);
	assert.equal(view.honest, honestWords(live, shown, lineup));
	assert.deepEqual(view.basis, leagueBasis(espn, lineup));
	assert.equal(view.host, 'espn');
	const uncounted = leagueView(live, espn, {});
	assert.equal(uncounted.record, live, 'no players, the run record as written');
	assert.equal(uncounted.honest, live.honest);
	const week = { week: 7, benchmark: 'published' as const, ours: 97, theirs: 88.6, margin: 8.4 };
	const withWeek = leagueView(live, { ...espn, weeks: [week] }, players);
	assert.deepEqual(withWeek.rows, []);
	assert.deepEqual(withWeek.sentences, [{ week: 7, text: weekSentence(week) }]);
	assert.equal(withWeek.said, null);
});

void test('a week reads who won by how much, in either direction', () => {
	const week = { week: 7, benchmark: 'espn' as const, ours: 97, theirs: 88.6, margin: 8.4 };
	assert.equal(
		weekSentence(week),
		'Week 7: following us instead of ESPN would have scored 8.4 more points, 97.0 to 88.6.'
	);
	assert.equal(
		weekSentence({ ...week, ours: 88.6, theirs: 97, margin: -8.4 }),
		'Week 7: following ESPN instead of us would have scored 8.4 more points, 97.0 to 88.6.'
	);
	assert.equal(
		weekSentence({ ...week, benchmark: 'published', theirs: 97, margin: 0 }),
		"Week 7: following us or the week's published projection would have scored the same, 97.0."
	);
});
