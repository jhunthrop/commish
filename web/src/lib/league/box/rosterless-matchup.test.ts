// The FFPC Matchup's opponent with no lineup or roster read (Lane 141, B121): he draws "--" under Proj
// before kickoff and "Proj final --" under way, and the key says why in its own sentence, never the
// starters' "No Proj final while a starter still to play has no Proj.". Through the FFPC stand-in
// (ffpc.ts) with the member's opponent rosterless (ffpcRosterless), on its Friday and its Sunday
// morning. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	FIXTURE_FRIDAY_CLOCK,
	FIXTURE_SUNDAY_MORNING_CLOCK
} from '../../../../scripts/inseason-fixture/clock.ts';
import { ffpcBeforeSunday, ffpcRosterless } from '../../../../scripts/inseason-fixture/ffpc.ts';
import {
	linesOf,
	recordedMatchups,
	scoreboardAt
} from '../../../../scripts/inseason-fixture/scoreboard-at.ts';
import { momentAt } from '../../../../scripts/inseason-fixture/sunday.ts';
import { inTenths } from '../../../../scripts/inseason-fixture/tenths.ts';
import type { LeagueSync } from '../api.ts';
import type { LineupAdvice, MatchupBox, TradeAdvice, WaiverAdvice } from '../inseason/api.ts';
import { boxBasisParts, drawnText, NO_PROJ_FINAL_PART } from './basis.ts';
import { BOX } from './box.ts';
import {
	bugFigures,
	matchupNoFinal,
	matchupStarted,
	matchupUnlisted,
	sideBox,
	unlistedStates,
	matchupFinal
} from './matchup.ts';

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
const opponentId = sync.matchup?.opponent?.roster_id ?? null;
const recorded = {
	matchups: await recordedMatchups(),
	lines: linesOf({
		lineup,
		waivers: data('waivers') as WaiverAdvice,
		trades: data('trades') as TradeAdvice,
		matchup
	}),
	rosterless: ffpcRosterless(opponentId, true)
};
const NO_ROSTER = 'Teams FFPC sends no lineup or roster for read --.';
const READ_MS_AGO = 4 * 60_000;

/** The Matchup at a clock as MatchupPanel.svelte reads it: both sides' totals, the opponent's
 * unlisted words, the key. */
function matchupAt(at: string) {
	const now = Date.parse(at);
	const moment = momentAt(now);
	const board = scoreboardAt(
		{ me: sync.me, week: sync.week, ...recorded, box: matchup },
		{ ...moment, scored: true },
		new Date(now - READ_MS_AGO).toISOString()
	);
	const week = ffpcBeforeSunday({ sync, lineup, matchup, scoreboard: board }, moment, recorded);
	const box = week.matchup;
	const m = week.sync.matchup;
	assert.ok(m?.opponent);
	const starterLines = box.sides.flatMap((s) => s.starters.map((st) => st.line));
	const started = matchupStarted(starterLines, now);
	const headFinal = matchupFinal(starterLines, now, unlistedStates(box));
	const read = { hostTotal: null, landed: true, week: box.week, now, started, headFinal };
	const sideOf = (id: number) => box.sides.find((s) => s.roster_id === id) ?? null;
	const mine = sideBox(m.mine, sideOf(m.mine.roster_id), read, ZONE);
	const theirSide = sideOf(m.opponent.roster_id);
	const theirs = sideBox(m.opponent, theirSide, read, ZONE);
	const unlisted = matchupUnlisted(theirSide, theirs.totals);
	const noFinal = matchupNoFinal(mine.totals, theirs.totals, unlisted);
	const parts = boxBasisParts(
		{
			projection: { readAt: box.projection_read_at, scoring: box.projection_scoring },
			lines: [...mine.lines, ...theirs.lines],
			kicked: started,
			byPlayer: mine.byPlayer,
			teamTotal: mine.teamTotal,
			host: 'ffpc',
			noFinal,
			allFinal: mine.totals.allFinal && theirs.totals.allFinal,
			unlisted,
			lineup: null
		},
		{ zone: ZONE, zoned: false },
		now
	);
	return { started, mine, theirs, theirSide, unlisted, noFinal, parts };
}

void test("the stand-in can make the member's opponent rosterless, and leaves the rest as they were", () => {
	assert.ok(opponentId !== null);
	assert.ok(ffpcRosterless(opponentId, true).has(opponentId));
	assert.ok(!ffpcRosterless(opponentId, false).has(opponentId));
	const { theirSide } = matchupAt(FIXTURE_FRIDAY_CLOCK);
	// FFPC's rosters page carries nothing for him: no starters, no bench, no best lineup.
	assert.ok(theirSide);
	assert.deepEqual([theirSide.starters.length, theirSide.bench.length], [0, 0]);
	assert.notEqual(theirSide.projection_best_lineup, true);
});

void test('before kickoff the rosterless opponent draws Proj "--", said in its own sentence', () => {
	const { started, theirs, unlisted, parts } = matchupAt(FIXTURE_FRIDAY_CLOCK);
	assert.equal(started, false);
	assert.equal(bugFigures(theirs.totals, false).big, BOX.none);
	assert.equal(unlisted.noRoster, true);
	assert.equal(unlisted.bestLineup, false);
	for (const width of ['desk', 'phone'] as const) {
		const said = drawnText(parts, width);
		assert.equal(said.split(NO_ROSTER).length, 2, `said once: ${said}`);
		assert.doesNotMatch(said, /best lineup/);
	}
});

void test('under way he reads "Proj final --" with its own sentence, never the starters\' key', () => {
	const { started, mine, theirs, unlisted, noFinal, parts } = matchupAt(
		FIXTURE_SUNDAY_MORNING_CLOCK
	);
	assert.equal(started, true);
	assert.equal(bugFigures(theirs.totals, true).small, `${BOX.projFinal} ${BOX.none}`);
	assert.equal(unlisted.noRoster, true);
	// The member's own Proj final is a figure, so nothing else draws a "--" the starters' key explains.
	assert.notEqual(mine.totals.final, null);
	assert.equal(noFinal, false);
	for (const width of ['desk', 'phone'] as const) {
		const said = drawnText(parts, width);
		assert.equal(said.split(NO_ROSTER).length, 2, `said once: ${said}`);
		assert.ok(!said.includes(NO_PROJ_FINAL_PART), said);
		assert.match(said, /Proj final adds the Pts/);
	}
});

void test('the starters\' key stays for the member\'s own Proj final "--"', () => {
	const missing = { live: true, final: null };
	const drawn = { live: true, final: 80.5 };
	assert.equal(matchupNoFinal(missing, missing, { noRoster: true }), true);
	assert.equal(matchupNoFinal(drawn, missing, { noRoster: true }), false);
	assert.equal(matchupNoFinal(drawn, missing, { noRoster: false }), true);
	assert.equal(matchupNoFinal(drawn, null, { noRoster: false }), false);
	// Before kickoff no Proj final is drawn at all.
	assert.equal(matchupNoFinal({ live: false, final: null }, null, { noRoster: false }), false);
});
