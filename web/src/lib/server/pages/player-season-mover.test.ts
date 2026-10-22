// A mover's week still to play under the club his line was for (Lane 136): his special-teams snaps in
// LAC's week 6 game, kicked off and not yet in the records, make the week upcoming at KC, which is his
// page club DET's bye. The reader takes it as LAC's game and the page draws its day from LAC's slate; a
// week that is no club's game is still refused, and the page never draws it, even in a week his club
// plays (Lane 138: a false row). The page and the slate are
// the in-season contract fixture's (research/nightly/contract/fixture). Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { seasonRefusals } from '#lib/run/season-checks.ts';
import type { GameLogRow } from '#lib/run/season.ts';
import { manifestSchema, playerSchema, scheduleSchema } from '#lib/run/schema.ts';
import { kickoffsFrom, seasonView } from './player-season.ts';

const RUN = new URL(
	'../../../../../research/nightly/contract/fixture/runs/2026-10-21T12-ros/',
	import.meta.url
);
const read = (file: string): unknown => JSON.parse(readFileSync(new URL(file, RUN), 'utf8'));
// Jahmyr Gibbs: DET (bye week 6) through week 5.
const gibbs = playerSchema.parse(read('players/4429795.json'));
const schedule = scheduleSchema.parse(read('schedule.json'));
const { formats } = manifestSchema.parse(read('manifest.json'));
const BYE = 6;

/** His page with week 6 still to play at `opponent`. */
function withWeek6(opponent: string, home: boolean): typeof gibbs {
	const log = gibbs.season.log.map((row): GameLogRow =>
		row.week === BYE ? { ...row, status: 'upcoming', opponent, home } : row
	);
	return { ...gibbs, season: { ...gibbs.season, log } };
}

void test("a week still to play under another club's game, on his club's bye, is read and drawn", () => {
	// LAC is at KC in week 6, its game kicked off on the run's slate.
	const page = withWeek6('KC', false);
	assert.deepEqual([...seasonRefusals([page], schedule)], []);
	const view = seasonView(
		page.season,
		page.position,
		formats,
		kickoffsFrom(schedule.slates, page.team)
	);
	const week = view.ahead.find((row) => row.week === BYE);
	assert.deepEqual(week, { week: BYE, opponent: 'at KC', bye: false, day: 'Kicked off' });
});

void test('a week still to play that is no club game is refused, and the page never draws it', () => {
	// KC is home in week 6, so no club plays at home against KC that week.
	const page = withWeek6('KC', true);
	assert.match(
		seasonRefusals([page], schedule).get(page.id) ?? '',
		/has week 6 to play, but DET's slate has no game, so no kickoff, that week\./
	);
	assert.throws(
		() => seasonView(page.season, page.position, formats, kickoffsFrom(schedule.slates, page.team)),
		/Week 6 against KC has no kickoff\./
	);
});

void test("his own club's weeks are drawn from his own club's slate, as before", () => {
	const view = seasonView(
		gibbs.season,
		gibbs.position,
		formats,
		kickoffsFrom(schedule.slates, gibbs.team)
	);
	const det = schedule.slates.find((slate) => slate.abbr === 'DET');
	const seven = det?.games.find((game) => game.week === 7);
	assert.ok(seven);
	assert.equal(
		view.ahead.find((row) => row.week === 7)?.opponent,
		`${seven.home ? 'vs' : 'at'} ${seven.opponent}`
	);
});

void test('a week still to play naming an opponent no club plays is refused while his club plays (Lane 138)', () => {
	// KC is at SEA in week 7, so no club plays at KC that week; DET plays GB.
	const log = gibbs.season.log.map((row): GameLogRow =>
		row.week === 7 ? { ...row, opponent: 'KC', home: false } : row
	);
	const page = { ...gibbs, season: { ...gibbs.season, log } };
	assert.equal(
		seasonRefusals([page], schedule).get(page.id),
		`players/${page.id}.json has week 7 to play at KC, but no club plays that game that week.`
	);
	assert.throws(
		() => seasonView(page.season, page.position, formats, kickoffsFrom(schedule.slates, page.team)),
		/Week 7 against KC has no kickoff\./
	);
});
