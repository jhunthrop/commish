// The FFPC Matchup before Sunday and the two unexplained dashes (Lane 137, B107): the opponent FFPC
// sends no lineup for draws the home bug's best-lineup Proj on the Matchup, the basis says when a best
// lineup passed over a player with no Proj, and a team with neither lineup nor roster is explained
// beside best-lineup teams. Through the FFPC stand-in (ffpc.ts) on its Friday. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FIXTURE_FRIDAY_CLOCK } from '../../../../scripts/inseason-fixture/clock.ts';
import { ffpcBeforeSunday } from '../../../../scripts/inseason-fixture/ffpc.ts';
import { linesOf, recordedMatchups } from '../../../../scripts/inseason-fixture/scoreboard-at.ts';
import { momentAt } from '../../../../scripts/inseason-fixture/sunday.ts';
import { inTenths } from '../../../../scripts/inseason-fixture/tenths.ts';
import type { LeagueSync } from '../api.ts';
import type {
	LineupAdvice,
	MatchupBox,
	Scoreboard,
	TradeAdvice,
	WaiverAdvice
} from '../inseason/api.ts';
import { bugsOf, teamBasis, unlistedDrawn } from '../home/home.ts';
import { weekBasisText } from '../home/week-basis.ts';
import {
	boxBasisParts,
	drawnText,
	NONE_UNLISTED,
	unlistedLong,
	unlistedPhoneForm,
	unlistedPart
} from './basis.ts';
import { BOX } from './box.ts';
import { KICKOFF } from './kickoff.ts';
import {
	bugFigures,
	matchupUnlisted,
	nextKickoff,
	sideBox,
	standingLine,
	unlistedStates
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
const scoreboard = data('scoreboard') as Scoreboard;
const recorded = {
	matchups: await recordedMatchups(),
	lines: linesOf({
		lineup,
		waivers: data('waivers') as WaiverAdvice,
		trades: data('trades') as TradeAdvice,
		matchup
	})
};
const FRIDAY = Date.parse(FIXTURE_FRIDAY_CLOCK);
const BEST = 'Proj for teams FFPC sends no lineup for is our best lineup from their rosters.';
const BEST_PROJECTED =
	'Proj for teams FFPC sends no lineup for is our best lineup from the players with a Proj.';
const NO_ROSTER = 'Teams FFPC sends no lineup or roster for show --.';

/** The FFPC stand-in on its Friday as the stand-in API sends it (serve.ts). */
const friday = ffpcBeforeSunday({ sync, lineup, matchup, scoreboard }, momentAt(FRIDAY), recorded);

/** The Matchup's opponent on the Friday: his box side, his totals and the home bug's side for him. */
function fridayOpponent(box: MatchupBox = friday.matchup) {
	const opponent = friday.sync.matchup?.opponent;
	assert.ok(opponent);
	const side = box.sides.find((s) => s.roster_id === opponent.roster_id) ?? null;
	const read = { hostTotal: null, landed: true, week: box.week, now: FRIDAY, started: false };
	const totals = sideBox(opponent, side, read, ZONE).totals;
	const bug = bugsOf(friday.scoreboard, friday.sync, FRIDAY, ZONE).find((b) => b.mine);
	const home = bug?.sides.find((s) => s.rosterId === opponent.roster_id);
	assert.ok(home);
	return { side, totals, home };
}

/** The Matchup's basis as a desk reads it, the opponent's figures said as MatchupPanel says them. */
function matchupBasis(box: MatchupBox): string {
	const { side, totals } = fridayOpponent(box);
	const parts = boxBasisParts(
		{
			projection: { readAt: box.projection_read_at, scoring: box.projection_scoring },
			lines: box.sides.flatMap((s) => [...s.starters.map((st) => st.line), ...s.bench]),
			byPlayer: false,
			teamTotal: true,
			host: 'ffpc',
			unlisted: matchupUnlisted(side, totals),
			lineup: null
		},
		{ zone: ZONE, zoned: false },
		FRIDAY
	);
	return drawnText(parts, 'desk');
}

void test("before Sunday the FFPC Matchup's opponent draws the home bug's best-lineup Proj, said once, never as points (ruling 1)", () => {
	const { side, totals, home } = fridayOpponent();
	assert.ok(side);
	assert.equal(side.starters.length, 0);
	assert.equal(side.projection_best_lineup, true);
	assert.ok(typeof side.projection === 'number');
	// One figure per side across screens: the Matchup's big Proj is the home bug's.
	assert.equal(totals.proj, side.projection);
	assert.equal(bugFigures(totals, false).big, home.big);
	assert.notEqual(home.big, BOX.none);
	// Before kickoff it is his Proj: no Pts, no standing, no Decided.
	assert.equal(bugFigures(totals, false).bigLabel, BOX.proj);
	assert.equal(standingLine(friday.matchup, false), null);
	assert.equal(friday.matchup.standing ?? null, null);
	assert.equal(friday.matchup.decided ?? null, null);
	const said = matchupBasis(friday.matchup);
	assert.equal(said.split('sends no lineup for').length, 2, `said once: ${said}`);
	assert.ok(said.includes(side.best_lineup_skipped === true ? BEST_PROJECTED : BEST), said);
	assert.doesNotMatch(said, /No Proj final while/);
});

void test('an answer before Lane 137 sends the Matchup no Proj for the opponent: "--", and the basis says nothing of a best lineup', () => {
	const older: MatchupBox = {
		...friday.matchup,
		sides: friday.matchup.sides.map((s) => {
			const rest = { ...s };
			delete rest.projection;
			delete rest.best_lineup_skipped;
			return rest;
		})
	};
	const { side, totals } = fridayOpponent(older);
	assert.equal(totals.proj, null);
	assert.equal(bugFigures(totals, false).big, BOX.none);
	assert.deepEqual(matchupUnlisted(side, totals), NONE_UNLISTED);
	assert.doesNotMatch(matchupBasis(older), /best lineup/);
});

void test('a best lineup that passed over a player with no Proj says it is from the players with a Proj, only then (ruling 2)', () => {
	const flagged: MatchupBox = {
		...friday.matchup,
		sides: friday.matchup.sides.map((s) =>
			s.projection_best_lineup === true ? { ...s, best_lineup_skipped: true } : s
		)
	};
	const { side, totals } = fridayOpponent(flagged);
	assert.equal(matchupUnlisted(side, totals).skipped, true);
	assert.ok(matchupBasis(flagged).includes(BEST_PROJECTED));
	// The home board: one side's skip says it for the board, once; none says the rosters' words.
	const board: Scoreboard = {
		...friday.scoreboard,
		games: friday.scoreboard.games.map((g, i) =>
			i === 0
				? g
				: {
						...g,
						sides: g.sides.map((s) =>
							s.projection_best_lineup === true
								? { ...s, best_lineup_skipped: true, projection: s.projection ?? 12.5 }
								: s
						)
					}
		)
	};
	const skipped = unlistedDrawn(bugsOf(board, friday.sync, FRIDAY, ZONE));
	assert.equal(skipped.skipped, true);
	// With no lineup passing over anyone, the rosters' words.
	const none: Scoreboard = {
		...friday.scoreboard,
		games: friday.scoreboard.games.map((g) => ({
			...g,
			sides: g.sides.map((s) => {
				const rest = { ...s };
				delete rest.best_lineup_skipped;
				return rest;
			})
		}))
	};
	const unflagged = unlistedDrawn(bugsOf(none, friday.sync, FRIDAY, ZONE));
	assert.equal(unflagged.skipped, false);
	assert.ok(unlistedPart('ffpc', unflagged).startsWith(BEST));
	assert.equal(
		unlistedPart('ffpc', { ...NONE_UNLISTED, bestLineup: true, skipped: true }),
		BEST_PROJECTED
	);
	// A skip with no best-lineup figure drawn says nothing.
	assert.equal(unlistedPart('ffpc', { ...NONE_UNLISTED, skipped: true }), '');
});

void test('a team with neither lineup nor roster is explained beside best-lineup teams, as a second sentence (ruling 3)', () => {
	const drawn = unlistedDrawn(bugsOf(friday.scoreboard, friday.sync, FRIDAY, ZONE));
	// The stand-in's Friday holds both: rosters FFPC carries and the rosterless (FFPC_ROSTERLESS).
	assert.equal(drawn.bestLineup, true);
	assert.equal(drawn.noRoster, true);
	const said = teamBasis(
		'ffpc',
		friday.scoreboard.projection_read_at,
		friday.scoreboard.projection_scoring,
		false,
		ZONE,
		false,
		false,
		false,
		false,
		drawn
	);
	assert.ok(said.endsWith(`${drawn.skipped ? BEST_PROJECTED : BEST} ${NO_ROSTER}`), said);
	assert.equal(said.split(NO_ROSTER).length, 2, 'said once');
	// Only beside a team that draws "--": a board with none says the best lineup's sentence alone.
	assert.equal(unlistedPart('ffpc', { ...NONE_UNLISTED, bestLineup: true }), BEST);
	assert.equal(unlistedPart('ffpc', { ...NONE_UNLISTED, noRoster: true }), NO_ROSTER);
});

void test('a crowded phone cuts qualifications, never the Game or Proj final sentence (fix round 1, HIGH-1 and HIGH-2)', () => {
	const best = { ...NONE_UNLISTED, bestLineup: true };
	assert.equal(unlistedLong(best), false);
	assert.equal(unlistedLong({ ...best, skipped: true }), true);
	assert.equal(unlistedLong({ ...best, noRoster: true }), true);
	assert.equal(unlistedLong({ ...best, paced: true }), true);
	assert.equal(unlistedLong({ ...NONE_UNLISTED, noRoster: true }), false);
	// The two FFPC sentences as one only where the second joins the pace clause (the ruling); beside a
	// skip alone, or no clause, they stay two.
	assert.equal(unlistedPhoneForm({ ...best, noRoster: true }), 'short');
	assert.equal(unlistedPhoneForm({ ...best, noRoster: true, paced: true }), 'one');
	assert.equal(
		unlistedPart('ffpc', { ...best, noRoster: true }, 'one'),
		'Teams FFPC sends no lineup for show our best lineup from their rosters, or -- with none.'
	);
	assert.match(
		unlistedPart('ffpc', { ...best, paced: true }, 'short'),
		/, in-play players at pace\.$/
	);
	const crowded = { ...best, paced: true, noRoster: true };
	// A phone with no room left (Lane 141, B121: the cuts by the room, every one made here).
	const basis = (drawn: typeof best, width: 'desk' | 'phone') =>
		weekBasisText(
			{
				standings: '',
				team: (cuts) =>
					teamBasis(
						'ffpc',
						null,
						friday.scoreboard.projection_scoring,
						false,
						ZONE,
						true,
						false,
						true,
						false,
						drawn,
						cuts
					),
				game: null,
				unlisted: drawn
			},
			width,
			{ lines: 1, chars: 10 }
		);
	// The desk says everything; the crowded phone leaves "as of kickoff" and the tight end's extra to
	// it, keeps the Proj final sentence and says the teams in one sentence.
	const desk = basis(crowded, 'desk');
	const phone = basis(crowded, 'phone');
	assert.match(desk, /as of kickoff once started/);
	assert.match(desk, /FFPC adds 0\.5 a catch for TEs\./);
	assert.ok(desk.includes(NO_ROSTER));
	assert.doesNotMatch(phone, /as of kickoff|a catch for TEs/);
	assert.match(phone, /Proj final adds the Pts/);
	assert.equal(phone.split('sends no lineup').length, 2, phone);
	// Not crowded, the phone is the desk.
	assert.equal(basis(best, 'phone'), basis(best, 'desk'));
});

void test('the Matchup phone keeps the Proj final and Game sentences while the teams words run long, cutting qualifications', () => {
	const { side, totals } = fridayOpponent();
	const unlisted = { ...matchupUnlisted(side, totals), paced: true };
	const box = friday.matchup;
	const lines = box.sides.flatMap((s) => [...s.starters.map((st) => st.line), ...s.bench]);
	const parts = boxBasisParts(
		{
			projection: { readAt: box.projection_read_at, scoring: box.projection_scoring },
			lines,
			kicked: true,
			byPlayer: false,
			teamTotal: true,
			host: 'ffpc',
			unlisted,
			lineup: null
		},
		{ zone: ZONE, zoned: false },
		FRIDAY
	);
	const desk = drawnText(parts, 'desk');
	const phone = drawnText(parts, 'phone');
	for (const text of [desk, phone]) {
		assert.match(text, /Proj final adds the Pts/);
		assert.match(text, /Game is each club's expected points/);
	}
	for (const text of [desk, phone]) assert.match(text, /their projection's pace\./);
	assert.match(desk, /read Fri/);
	assert.doesNotMatch(phone.split('Game')[0] ?? '', /read Fri/);
});

void test("the Matchup's head and its Proj final key read the starters' games, never the unlisted opponent's bench (B107 addendum)", () => {
	const box = friday.matchup;
	const starters = box.sides.flatMap((s) => s.starters.map((st) => st.line));
	const bench = box.sides.flatMap((s) => s.bench);
	// The member's starters play Sunday; the opponent's Thursday player sits on his bench only.
	assert.ok(bench.some((l) => l.facts.kickoff !== null && Date.parse(l.facts.kickoff) < FRIDAY));
	const head = nextKickoff(starters, FRIDAY, ZONE, unlistedStates(box))?.head;
	assert.equal(head, KICKOFF.first);
	const parts = boxBasisParts(
		{
			projection: { readAt: box.projection_read_at, scoring: box.projection_scoring },
			lines: [...starters, ...bench],
			kicked: false,
			byPlayer: false,
			teamTotal: true,
			host: 'ffpc',
			lineup: null
		},
		{ zone: ZONE, zoned: false },
		FRIDAY
	);
	assert.doesNotMatch(drawnText(parts, 'desk'), /Proj final/);
});

void test("a listed league's Matchup head reads its starters, a Thursday bench player's game moving nothing (review LOW-3)", () => {
	// The recorded Sleeper box as served before Sunday: every starter plays Sunday or later.
	const starters = matchup.sides.flatMap((s) => s.starters.map((st) => st.line));
	const benchman = matchup.sides.flatMap((s) => s.bench)[0];
	assert.ok(benchman);
	assert.ok(
		starters.every((l) => l.facts.kickoff === null || Date.parse(l.facts.kickoff) > FRIDAY)
	);
	// His game kicked off Thursday night.
	const thursday = {
		...benchman,
		facts: { ...benchman.facts, kickoff: '2026-10-16T00:15:00.000Z', bye: false, opponent: 'CLE' }
	};
	assert.equal(nextKickoff(starters, FRIDAY, ZONE)?.head, KICKOFF.first);
	assert.equal(nextKickoff([...starters, thursday], FRIDAY, ZONE)?.head, KICKOFF.next);
});
