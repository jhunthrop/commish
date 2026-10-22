// The League page's phone basis makes its cuts by the room left (Lane 141, B121): none where the
// paragraph fits, else the fewest, the full Game sentence kept first and FFPC's tight end sentence
// next. Through the FFPC stand-in (ffpc.ts) on its Saturday and its Sunday morning. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	FIXTURE_SUNDAY_MORNING_CLOCK,
	FIXTURE_WEEK_CLOCK
} from '../../../../scripts/inseason-fixture/clock.ts';
import { ffpcBeforeSunday } from '../../../../scripts/inseason-fixture/ffpc.ts';
import {
	linesOf,
	recordedMatchups,
	scoreboardAt
} from '../../../../scripts/inseason-fixture/scoreboard-at.ts';
import { momentAt } from '../../../../scripts/inseason-fixture/sunday.ts';
import { inTenths } from '../../../../scripts/inseason-fixture/tenths.ts';
import type { LeagueSync } from '../api.ts';
import type { LineupAdvice, MatchupBox, TradeAdvice, WaiverAdvice } from '../inseason/api.ts';
import { unlistedLong } from '../box/basis.ts';
import { bugsOf } from './home.ts';
import { leagueWeekParts, PHONE_ROOM, weekBasisText, wrappedLines } from './week-basis.ts';

const data = (name: string): unknown =>
	inTenths(
		JSON.parse(
			readFileSync(
				new URL(`../../../../scripts/inseason-fixture/data/${name}.json`, import.meta.url),
				'utf8'
			)
		)
	);
const ZONE = 'America/Chicago';
const sync = data('sync') as LeagueSync;
const lineup = data('lineup') as LineupAdvice;
const matchup = data('matchup') as MatchupBox;
const recorded = {
	matchups: await recordedMatchups(),
	lines: linesOf({
		lineup,
		waivers: data('waivers') as WaiverAdvice,
		trades: data('trades') as TradeAdvice,
		matchup
	})
};
const GAME_FULL = "Game is each club's expected points, his first, and weather, read";
const GAME_READ = /Game was read/;
const TE = 'FFPC adds 0.5 a catch for TEs.';

/** The read stamp the stand-in API puts on its answers, minutes before the clock (serve.ts). */
const READ_MS_AGO = 4 * 60_000;

/** The League page's basis parts on the FFPC stand-in at a clock, the scoreboard at the clock as the
 * stand-in API sends it (serve.ts scoreboardNow), the parts as LeaguePage.svelte builds them. */
function partsAt(at: string) {
	const now = Date.parse(at);
	const moment = momentAt(now);
	const board = scoreboardAt(
		{ me: sync.me, week: sync.week, ...recorded, box: matchup },
		{ ...moment, scored: true },
		new Date(now - READ_MS_AGO).toISOString()
	);
	const week = ffpcBeforeSunday({ sync, lineup, matchup, scoreboard: board }, moment, recorded);
	return leagueWeekParts({
		sync: week.sync,
		scoreboard: week.scoreboard,
		playerPoints: week.lineup.player_points,
		gameLines: week.lineup.slots.flatMap((s) => (s.host ? [s.host] : [])),
		bugs: bugsOf(week.scoreboard, week.sync, now, ZONE),
		now,
		zone: ZONE
	});
}

void test('a paragraph wraps word by word at the room a line holds', () => {
	assert.equal(wrappedLines('', 10), 0);
	assert.equal(wrappedLines('one two', 7), 1);
	assert.equal(wrappedLines('one two', 6), 2);
	assert.equal(wrappedLines('a  b\nc', 3), 2);
	// A word wider than the line takes a line of its own.
	assert.equal(wrappedLines('a abcdefgh b', 4), 3);
});

void test("Saturday's phone has room: the full Game sentence, as the desk says it (review LOW-5)", () => {
	const parts = partsAt(FIXTURE_WEEK_CLOCK);
	assert.ok(unlistedLong(parts.unlisted), 'the FFPC words run long on the Saturday');
	const desk = weekBasisText(parts, 'desk');
	const phone = weekBasisText(parts, 'phone');
	assert.ok(phone.includes(GAME_FULL), phone);
	assert.ok(wrappedLines(phone, PHONE_ROOM.chars) <= PHONE_ROOM.lines);
	// With the room for every sentence the phone is the desk.
	assert.equal(weekBasisText(parts, 'phone', { lines: 40, chars: 70 }), desk);
});

void test('a phone short of room cuts the qualifications first, the tight end sentence next to last, the Game sentence last', () => {
	const parts = partsAt(FIXTURE_WEEK_CLOCK);
	const desk = weekBasisText(parts, 'desk');
	assert.ok(desk.includes(TE) && desk.includes(GAME_FULL), desk);
	const lines = (text: string): number => wrappedLines(text, PHONE_ROOM.chars);
	// Each room from the most cut to the desk's: the Game sentence is whole wherever the tight end's
	// is said, and the phone takes the fewest cuts that fit.
	for (let room = 1; room <= lines(desk); room += 1) {
		const phone = weekBasisText(parts, 'phone', { lines: room, chars: PHONE_ROOM.chars });
		if (phone.includes(TE)) assert.ok(phone.includes(GAME_FULL), `room ${String(room)}: ${phone}`);
		if (lines(phone) > room) assert.match(phone, GAME_READ, `room ${String(room)}: every cut made`);
	}
	const none = weekBasisText(parts, 'phone', { lines: 1, chars: PHONE_ROOM.chars });
	assert.match(none, GAME_READ);
	assert.ok(!none.includes(TE));
});

void test("Sunday morning's crowded phone fits its room, the pace clause's Game read alone at every width", () => {
	const parts = partsAt(FIXTURE_SUNDAY_MORNING_CLOCK);
	assert.ok(parts.unlisted.paced);
	const phone = weekBasisText(parts, 'phone');
	assert.ok(wrappedLines(phone, PHONE_ROOM.chars) <= PHONE_ROOM.lines, phone);
	for (const text of [phone, weekBasisText(parts, 'desk')]) assert.match(text, GAME_READ);
	assert.match(phone, /Proj final adds the Pts/);
});
