// The in-season screens' basis parts (Lane 66t): each names one column the screen draws, once, and
// the copy guard holds over every one. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { PlayerLine, WeekFacts } from '../inseason/api.ts';
import {
	basisText,
	boxBasisParts,
	drawnText,
	deltaPart,
	deskOrPhone,
	finalsPartAt,
	finalsParts,
	FOR_ROSTERED,
	gamePart,
	KICKED_OFF_PART,
	kickedOffPartAt,
	liveFinalsPart,
	NO_PROJ_FINAL_PART,
	OPP_PART,
	platformFinalsPart,
	PROJ_FINAL_PART,
	RANK_OPP_PART,
	RANK_OPP_PHONE,
	projPart,
	ptsPart,
	ptsPhonePart,
	projFinalPhone,
	weekProjPart,
	uncountedPart,
	UNCOUNTED,
	type Clock
} from './basis.ts';

const CENTRAL: Clock = { zone: 'America/Chicago', zoned: false };
const NAMED: Clock = { zone: 'America/Chicago', zoned: true };
/** Friday 9:00 pm Central, before every game of the week (the fixture's projection read). */
const READ = '2026-10-17T02:00:00.000Z';
/** Thursday 9:00 pm Central, the read before. */
const BEFORE = '2026-10-16T02:00:00.000Z';
/** Friday 4:01 pm Central, the game facts' read. */
const FACTS = '2026-10-16T21:01:00.000Z';
const NOW = Date.parse(READ);
const CLOSEST = { format: 'ppr', league_own: false } as const;
const OWN = { format: 'half_ppr', league_own: true } as const;

const facts = (over: Partial<WeekFacts> = {}): WeekFacts => ({
	week: 6,
	opponent: 'ATL',
	home: false,
	kickoff: '2099-10-18T17:00:00.000Z',
	bye: false,
	designation: null,
	played: false,
	points_this_week: null,
	last_games: [],
	allowed_to_position: null,
	game_total: { points: 49.5, team_points: 26.5, read_at: FACTS },
	spread: null,
	roof: null,
	weather: null,
	...over
});

const line = (over: Partial<WeekFacts> = {}): PlayerLine =>
	({ facts: facts(over), player: { position: 'QB' } }) as unknown as PlayerLine;

void test("FFPC's tight end premium is said beside PPR nearest its rules, never as the only difference (Lane 94, B26, fix round 1)", () => {
	const ffpc = { ...CLOSEST, te_bonus: 0.5 };
	const said = projPart(
		{ readAt: READ, scoring: ffpc, defense: false, league: true, host: 'ffpc' },
		CENTRAL
	);
	assert.equal(
		said,
		"Proj is this week's published projection, PPR shown, nearest FFPC's rules, read Fri 9:00 pm. FFPC adds 0.5 a catch for TEs."
	);
	assert.doesNotMatch(said, bannedPattern());
	assert.equal(
		projPart({ readAt: READ, scoring: ffpc, defense: false, league: true }, CENTRAL),
		"Proj is this week's published projection, PPR shown, nearest your league's rules, read Fri 9:00 pm. Your league adds 0.5 a catch for TEs."
	);
	// A commissioner's rules are the league's, never the platform's (fix round 2): never "Sleeper adds".
	const sleeper = projPart(
		{ readAt: READ, scoring: ffpc, defense: false, league: true, host: 'sleeper' },
		CENTRAL
	);
	assert.equal(
		sleeper,
		"Proj is this week's published projection, PPR shown, nearest your league's rules, read Fri 9:00 pm. Your league adds 0.5 a catch for TEs."
	);
	assert.doesNotMatch(sleeper, /Sleeper/);
});

void test('Proj says its scoring, whose rules, defenses when one is drawn, and its read, the zone said once on the page', () => {
	assert.equal(
		projPart({ readAt: READ, scoring: CLOSEST, defense: false, league: true }, CENTRAL),
		"Proj is this week's published projection, PPR nearest your rules, read Fri 9:00 pm."
	);
	assert.equal(
		projPart({ readAt: READ, scoring: CLOSEST, defense: true, league: true }, CENTRAL),
		"Proj is this week's published projection, PPR nearest your rules, defenses on default scoring, read Fri 9:00 pm."
	);
	assert.equal(
		projPart({ readAt: READ, scoring: OWN, defense: false, league: true }, CENTRAL),
		"Proj is this week's published projection on your rules, read Fri 9:00 pm."
	);
	assert.equal(
		projPart({ readAt: null, scoring: CLOSEST, defense: false, league: false }, NAMED),
		"Proj is this week's published projection in PPR, not in yet."
	);
	assert.equal(
		projPart({ readAt: READ, scoring: CLOSEST, defense: false, league: false }, NAMED),
		"Proj is this week's published projection in PPR, read Fri 9:00 pm Central."
	);
});

void test('the change, the Game cell and Opp rank each in one sentence', () => {
	assert.equal(deltaPart(BEFORE, CENTRAL), 'Δ Proj is its change since Thu 9:00 pm.');
	assert.equal(deltaPart(null, CENTRAL), null);
	assert.equal(
		gamePart([line()], CENTRAL, NOW, 'full'),
		"Game is each club's expected points, his first, and weather, read Fri 4:01 pm."
	);
	assert.equal(gamePart([line()], CENTRAL, NOW, 'read'), 'Game was read Fri 4:01 pm.');
	assert.equal(gamePart([line({ bye: true })], CENTRAL, NOW, 'read'), null);
	assert.equal(OPP_PART, 'Opp rank is points allowed to his position, 1st fewest.');
});

void test('Pts says whether the platform gives each player his points or each team its total, the platform named', () => {
	assert.equal(
		ptsPart(true, 'espn', 'platform'),
		"Pts are ESPN's points by player so far, each to a tenth, and Team is ESPN's score."
	);
	assert.equal(
		ptsPart(true, 'sleeper', 'rows'),
		"Pts are Sleeper's points so far, Team adds the rows."
	);
	assert.equal(ptsPart(false, 'yahoo', 'platform'), "Pts are Yahoo's team points, none by player.");
	for (const host of ['sleeper', 'espn', 'yahoo', 'ffpc', 'mfl'] as const) {
		for (const byPlayer of [true, false])
			for (const team of ['rows', 'platform'] as const)
				assert.doesNotMatch(ptsPart(byPlayer, host, team), /\bhost\b/i);
	}
});

void test('the uncounted rules are the API sentence naming them, with no link (Lane 111, B33)', () => {
	// An answer before Lane 115 carries no names: its sentence is printed as sent.
	assert.deepEqual(
		uncountedPart(
			{ basis_note: 'Our stats omit two-point, missed kick, fumble recovery and safety.' },
			[]
		),
		[{ text: 'Our stats omit two-point, missed kick, fumble recovery and safety.', phone: true }]
	);
	assert.deepEqual(uncountedPart({ basis_note: '' }, []), []);
	assert.deepEqual(uncountedPart({ basis_note: '', basis_note_list: '' }, []), []);
});

void test("with no row on the platform's points, Avg and Last are said to be our stats (Lane 115, B92)", () => {
	const advice = {
		basis_note: 'Our stats omit two-point and safety.',
		basis_note_list: 'two-point and safety'
	};
	assert.deepEqual(uncountedPart(advice, [line()]), [
		{ text: 'Avg and Last are our stats, which omit two-point and safety.', phone: true }
	]);
	const counted = line({ last_games: [{ week: 6, points: 30.4, source: 'platform' }] });
	assert.deepEqual(uncountedPart(advice, [line(), counted]), [
		{ text: 'Our stats omit two-point and safety.', phone: true }
	]);
	assert.equal(
		UNCOUNTED.ours('a, b, c, d and two more rules'),
		'Avg and Last are our stats, which omit a, b, c, d and two more rules.'
	);
});

void test('a block reads as one paragraph: a link that more words follow closes its sentence', () => {
	assert.equal(
		basisText([
			{ text: 'A.', phone: true },
			{ text: 'Which five', phone: true, href: '/x' },
			{ text: 'B.', phone: false },
			{ text: 'How the order has done', phone: true, href: '/r' }
		]),
		'A. Which five. B. How the order has done'
	);
});

void test('copy guard: every basis part is fantasy words, with no dash or semicolon', () => {
	const banned = bannedPattern();
	const said = [
		projPart({ readAt: READ, scoring: CLOSEST, defense: true, league: true }, CENTRAL),
		deltaPart(BEFORE, CENTRAL) ?? '',
		gamePart([line()], CENTRAL, NOW, 'full') ?? '',
		OPP_PART,
		RANK_OPP_PART,
		ptsPart(false, 'espn', 'platform'),
		ptsPart(true, 'espn', 'platform'),
		ptsPart(true, 'espn', 'rows'),
		platformFinalsPart('espn', "this week's", FOR_ROSTERED),
		liveFinalsPart('espn', FOR_ROSTERED)
	];
	for (const text of said) {
		assert.doesNotMatch(text, banned, text);
		assert.doesNotMatch(text, /[–—;]/, text);
	}
});

void test("the Lineup's key says Proj, its change at a desk, Game, Opp rank, Pts and the uncounted rules once", () => {
	const parts = boxBasisParts(
		{
			projection: { readAt: READ, scoring: CLOSEST },
			lines: [line()],
			byPlayer: true,
			teamTotal: false,
			host: 'sleeper',
			lineup: {
				previousReadAt: BEFORE,
				note: {
					basis_note: 'Our stats omit two-point, missed kick, fumble recovery and safety.'
				}
			}
		},
		CENTRAL,
		NOW
	);
	assert.equal(
		drawnText(parts, 'desk'),
		"Our pick starts the highest Proj at each slot. Proj is this week's published projection, PPR nearest your rules, read Fri 9:00 pm. Δ Proj is its change since Thu 9:00 pm. Game is each club's expected points, his first, and weather, read Fri 4:01 pm. Our rank is his place at his position in our order, Opp rank the points allowed to it, 1st fewest. Pts are Sleeper's points so far, Team adds the rows. Our stats omit two-point, missed kick, fumble recovery and safety."
	);
	// The phone's eight lines (Lane 115, B83): the pick rule in one clause with what Proj is, Our rank
	// and Pts in fewer words, no Δ Proj (a desk column).
	assert.equal(
		drawnText(parts, 'phone'),
		"Our pick is each slot's highest Proj, this week's published projection, PPR nearest your rules, read Fri 9:00 pm. Game is each club's expected points, his first, and weather, read Fri 4:01 pm. Our rank is his place at his position, Opp the points allowed to it, 1st fewest. Pts are Sleeper's points so far. Our stats omit two-point, missed kick, fumble recovery and safety."
	);
});

void test("the phone Lineup leaves the defenses' scoring to the desk and says why a Proj final is -- (Lane 115, B83, fix round 1)", () => {
	const defense = { ...line(), player: { position: 'DEF' } } as unknown as PlayerLine;
	const kicked = line({ kickoff: '2026-10-16T00:15:00.000Z', game_state: 'kicked_off' });
	const parts = boxBasisParts(
		{
			projection: { readAt: READ, scoring: CLOSEST },
			lines: [defense, kicked],
			byPlayer: true,
			teamTotal: false,
			noFinal: true,
			host: 'sleeper',
			lineup: { previousReadAt: null, note: { basis_note: '' } }
		},
		CENTRAL,
		NOW
	);
	const desk = drawnText(parts, 'desk');
	const phone = drawnText(parts, 'phone');
	assert.ok(
		desk.includes('defenses on default scoring') && desk.includes(NO_PROJ_FINAL_PART),
		desk
	);
	assert.ok(!phone.includes('defenses on default scoring'), phone);
	assert.ok(phone.startsWith("Our pick is each slot's highest Proj,"), phone);
	// The "--" says why in place of what a Proj final adds (MEDIUM-1).
	assert.ok(phone.includes(NO_PROJ_FINAL_PART) && !phone.includes(PROJ_FINAL_PART), phone);
});

void test("the phone Matchup leaves the defenses' scoring and a started game's Proj to the desk, the tight end sentence kept (Lane 124)", () => {
	const defense = { ...line(), player: { position: 'DEF' } } as unknown as PlayerLine;
	const kicked = line({ kickoff: '2026-10-16T00:15:00.000Z', game_state: 'kicked_off' });
	const parts = boxBasisParts(
		{
			projection: { readAt: READ, scoring: { ...CLOSEST, te_bonus: 0.5 } },
			lines: [defense, kicked],
			byPlayer: false,
			teamTotal: true,
			host: 'ffpc',
			lineup: null
		},
		CENTRAL,
		NOW
	);
	const desk = drawnText(parts, 'desk');
	const phone = drawnText(parts, 'phone');
	for (const clause of ['defenses on default scoring', 'as of kickoff once started'])
		assert.ok(desk.includes(clause) && !phone.includes(clause), `${clause}: ${phone}`);
	for (const kept of ['FFPC adds 0.5 a catch for TEs.', PROJ_FINAL_PART, 'read Fri 9:00 pm'])
		assert.ok(phone.includes(kept), `${kept}: ${phone}`);
});

void test('the Matchup and Lineup keys explain Proj final only while a starter still plays (Lane 121, B99)', () => {
	const played = line({ kickoff: '2026-10-16T00:15:00.000Z', played: true, game_state: 'final' });
	const key = (allFinal: boolean | undefined, lineup: boolean): string =>
		basisText(
			boxBasisParts(
				{
					projection: { readAt: READ, scoring: CLOSEST },
					lines: [played],
					byPlayer: true,
					teamTotal: false,
					host: 'sleeper',
					...(allFinal === undefined ? {} : { allFinal }),
					lineup: lineup ? { previousReadAt: null, note: { basis_note: '' } } : null
				},
				CENTRAL,
				NOW
			)
		);
	for (const lineup of [false, true]) {
		assert.ok(key(false, lineup).includes(PROJ_FINAL_PART));
		// The previous caller sends no allFinal: as before.
		assert.ok(key(undefined, lineup).includes(PROJ_FINAL_PART));
		// Every Team row reads Final: nothing to explain.
		assert.ok(!key(true, lineup).includes(PROJ_FINAL_PART), key(true, lineup));
	}
});

void test('the Matchup key says Proj, Pts and Game, the columns it draws', () => {
	const parts = boxBasisParts(
		{
			projection: { readAt: READ, scoring: CLOSEST },
			lines: [line()],
			byPlayer: false,
			teamTotal: true,
			host: 'espn',
			lineup: null
		},
		CENTRAL,
		NOW
	);
	assert.equal(
		basisText(parts),
		"Proj is this week's published projection, PPR nearest your rules, read Fri 9:00 pm. Our rank is his place at his position in our order. Pts are ESPN's team points, none by player. Game is each club's expected points, his first, and weather, read Fri 4:01 pm."
	);
});

void test('the Lineup and the Matchup say when Final and the stats land while a row waits (Lane 85)', () => {
	const waiting = line({ kickoff: '2026-10-18T17:00:00.000Z', played: true, game_state: 'final' });
	const box = (lineup: boolean): string =>
		basisText(
			boxBasisParts(
				{
					projection: { readAt: READ, scoring: CLOSEST },
					lines: [waiting],
					byPlayer: true,
					teamTotal: false,
					host: 'sleeper',
					lineup: lineup
						? {
								previousReadAt: null,
								note: { basis_note: '' }
							}
						: null
				},
				CENTRAL,
				Date.parse('2026-10-19T16:00:00.000Z')
			)
		);
	for (const text of [box(true), box(false)]) assert.ok(text.includes(KICKED_OFF_PART), text);
	// Once his week's stats are in, nothing waits and the sentence goes.
	const counted = line({
		kickoff: '2026-10-18T17:00:00.000Z',
		played: true,
		game_state: 'final',
		last_games: [{ week: 6, points: 12.4 }]
	});
	assert.equal(kickedOffPartAt([counted], Date.parse('2026-10-19T16:00:00.000Z')), null);
});

void test('the Lineup phone keeps its fact cells; the Final sentence waits for the desk while they show', () => {
	const waiting = line({ kickoff: '2026-10-18T17:00:00.000Z', played: true, game_state: 'final' });
	const lineup = {
		previousReadAt: null,
		note: { basis_note: '' }
	};
	const at = (lines: PlayerLine[]) =>
		boxBasisParts(
			{
				projection: { readAt: READ, scoring: CLOSEST },
				lines,
				byPlayer: true,
				teamTotal: false,
				host: 'sleeper',
				lineup
			},
			CENTRAL,
			NOW
		);
	// A row still to play draws its expected score: its sentence on the phone, the Final one at a desk.
	const sunday = at([waiting, line()]);
	const phone = sunday.filter((p) => p.phone).map((p) => p.text);
	assert.ok(phone.includes(RANK_OPP_PHONE));
	assert.ok(phone.some((t) => t.startsWith("Game is each club's expected points")));
	assert.ok(!phone.includes(KICKED_OFF_PART));
	assert.ok(sunday.some((p) => p.text === KICKED_OFF_PART && !p.phone));
	// No row draws them (every game kicked off): the Final sentence is said on the phone too.
	const tuesday = at([waiting]);
	assert.ok(tuesday.some((p) => p.text === KICKED_OFF_PART && p.phone));
});

void test('the Final sentence says what holds, never a promise of within the hour (Lane 84)', () => {
	assert.equal(KICKED_OFF_PART, 'Final lands the hour after a game, stats by Wednesday.');
	assert.equal(bannedPattern().test(KICKED_OFF_PART), false);
});

/** The fixture's clocks (scripts/inseason-fixture/clock.ts): Sunday morning before the noon games,
 * Monday night with Sunday final and the Monday game under way, Wednesday evening after our stats. */
const SUNDAY_MORNING = Date.parse('2026-10-18T15:00:00.000Z');
const MONDAY_NIGHT = Date.parse('2026-10-20T01:30:00.000Z');
const WEDNESDAY = Date.parse('2026-10-22T01:00:00.000Z');
const SUNDAY_KICKOFF = '2026-10-18T17:00:00.000Z';
const MONDAY_KICKOFF = '2026-10-20T00:15:00.000Z';

/** A Sunday starter: to come Sunday morning; final with the platform's points from Monday; final
 * with our stats from Wednesday. */
const sundayRow = (now: number): PlayerLine => {
	if (now < Date.parse(SUNDAY_KICKOFF))
		return line({
			kickoff: SUNDAY_KICKOFF,
			last_games: [{ week: 5, points: 10, source: 'stats' }]
		});
	const source = now < WEDNESDAY ? 'platform' : 'stats';
	return line({
		kickoff: SUNDAY_KICKOFF,
		played: true,
		game_state: 'final',
		last_games: [
			{ week: 6, points: 30.4, source },
			{ week: 5, points: 10, source: 'stats' }
		]
	});
};

void test('Avg and Last say they count the platform points for a final our stats lack (Lane 111, B23)', () => {
	// Sunday morning: nothing final, nothing said.
	assert.equal(finalsPartAt([sundayRow(SUNDAY_MORNING)], SUNDAY_MORNING, 'espn', 'rosters'), null);
	// Monday, every game final: the ruling's sentence.
	const monday = Date.parse('2026-10-19T16:00:00.000Z');
	assert.equal(
		finalsPartAt([sundayRow(monday)], monday, 'espn', 'rosters'),
		"Avg and Last count this week's finals from ESPN's points, our stats by Wednesday."
	);
	// Monday night, the Monday game in play beside them: one sentence for both, merged before hiding.
	const inPlay = line({ kickoff: MONDAY_KICKOFF, game_state: 'kicked_off' });
	assert.equal(
		finalsPartAt([sundayRow(MONDAY_NIGHT), inPlay], MONDAY_NIGHT, 'espn', 'rosters'),
		"Final lands the hour after a game, Avg and Last then count ESPN's points, our stats by Wednesday."
	);
	// Wednesday our stats are in: nothing waits, nothing is said.
	assert.equal(finalsPartAt([sundayRow(WEDNESDAY)], WEDNESDAY, 'espn', 'rosters'), null);
	// The platform's week named on a page turned past it (Waivers on Monday night, its rows week 7's).
	const turned: PlayerLine = {
		...sundayRow(monday),
		facts: {
			...sundayRow(monday).facts,
			week: 7,
			kickoff: '2026-10-25T17:00:00.000Z',
			played: false,
			game_state: 'upcoming'
		}
	};
	assert.equal(
		finalsPartAt([turned], monday, 'sleeper', 'pool'),
		"Avg and Last count week 6's finals from Sleeper's points for rostered players, our stats by Wednesday."
	);
});

void test('a screen that lists free agents keeps the sentence to rostered players, whose finals the platform scores', () => {
	const monday = Date.parse('2026-10-19T16:00:00.000Z');
	const free = line({
		kickoff: SUNDAY_KICKOFF,
		played: true,
		game_state: 'final',
		last_games: [{ week: 5, points: 8, source: 'stats' }]
	});
	assert.equal(
		finalsPartAt([sundayRow(monday), free], monday, 'espn', 'pool'),
		"Avg and Last count this week's finals from ESPN's points for rostered players, our stats by Wednesday."
	);
	// Without a row the platform counts, or with no league, the old sentence: our stats by Wednesday.
	assert.equal(finalsPartAt([free], monday, 'espn', 'pool'), KICKED_OFF_PART);
	// A final the platform's points count still waits on our stats, said so with no league to name.
	assert.equal(finalsPartAt([sundayRow(monday)], monday, null, 'pool'), KICKED_OFF_PART);
});

void test('the Proj sentence names the week a turned page addresses (Lane 111, B70)', () => {
	const said = (weeks?: { week: number; for_week?: number }): string =>
		projPart(
			{ readAt: READ, scoring: CLOSEST, defense: false, league: true, ...(weeks ? { weeks } : {}) },
			CENTRAL
		);
	assert.equal(
		said({ week: 6, for_week: 7 }),
		"Proj is week 7's published projection, PPR nearest your rules, read Fri 9:00 pm."
	);
	// On the platform's week, and from an answer before for_week, it is this week's.
	for (const weeks of [{ week: 7, for_week: 7 }, { week: 6 }, undefined])
		assert.match(said(weeks), /^Proj is this week's published projection/);
});

void test('a box score says the platform sentence at a desk and its short form on a phone, never the timing alone (Lane 111 fix round 1, HIGH-1)', () => {
	const inPlay = line({ kickoff: MONDAY_KICKOFF, game_state: 'kicked_off' });
	const monday = [sundayRow(MONDAY_NIGHT), inPlay];
	const parts = finalsParts(monday, MONDAY_NIGHT, 'sleeper', 'rosters', true);
	assert.deepEqual(parts, [
		{
			text: "Final lands the hour after a game, Avg and Last then count Sleeper's points, our stats by Wednesday.",
			phone: false
		},
		{
			text: "Avg and Last count Sleeper's finals, our stats by Wednesday.",
			phone: true,
			desk: false
		}
	]);
	// The Lineup while a row still draws its fact cells: neither on the phone (Lane 85).
	assert.deepEqual(
		finalsParts(monday, MONDAY_NIGHT, 'sleeper', 'rosters', false).map((p) => p.phone),
		[false]
	);
	// With no platform game the one sentence is said on both.
	const before = [line({ kickoff: MONDAY_KICKOFF, game_state: 'kicked_off' })];
	assert.deepEqual(finalsParts(before, MONDAY_NIGHT, 'sleeper', 'rosters', true), [
		{ text: KICKED_OFF_PART, phone: true }
	]);
	// Wednesday nothing waits: nothing is said.
	assert.deepEqual(finalsParts([sundayRow(WEDNESDAY)], WEDNESDAY, 'sleeper', 'rosters', true), []);
	// The Lineup's basis on Monday night: the rules named, no link, the platform sentence at a desk.
	const box = boxBasisParts(
		{
			projection: { readAt: READ, scoring: CLOSEST },
			lines: monday,
			byPlayer: true,
			teamTotal: false,
			host: 'sleeper',
			lineup: {
				previousReadAt: null,
				note: { basis_note: 'Our stats omit two-point and safety.' }
			}
		},
		CENTRAL,
		MONDAY_NIGHT
	);
	const phone = box.filter((p) => p.phone).map((p) => p.text);
	const desk = box.filter((p) => p.desk !== false).map((p) => p.text);
	assert.ok(
		phone.includes("Avg and Last count Sleeper's finals, our stats by Wednesday.") &&
			phone.includes('Our stats omit two-point and safety.')
	);
	assert.ok(
		desk.some((t) => t.includes("then count Sleeper's points")) && !desk.includes(KICKED_OFF_PART)
	);
	assert.ok(box.every((p) => p.href === undefined));
});

void test("a page turned past the platform's week says the platform sentence on a phone too: nothing there waits on Final", () => {
	const monday = Date.parse('2026-10-19T16:00:00.000Z');
	const turned: PlayerLine = {
		...sundayRow(monday),
		facts: {
			...sundayRow(monday).facts,
			week: 7,
			kickoff: '2026-10-25T17:00:00.000Z',
			played: false,
			game_state: 'upcoming'
		}
	};
	assert.deepEqual(finalsParts([turned], monday, 'sleeper', 'pool', true), [
		{
			text: "Avg and Last count week 6's finals from Sleeper's points for rostered players, our stats by Wednesday.",
			phone: true
		}
	]);
});

void test("the phone's Pts sentence leaves what Team adds to the desk (Lane 115, B83)", () => {
	assert.equal(ptsPhonePart(true, 'sleeper'), "Pts are Sleeper's points so far.");
	assert.equal(ptsPhonePart(false, 'yahoo'), "Pts are Yahoo's team points alone.");
	assert.deepEqual(deskOrPhone('A.', 'A.'), [{ text: 'A.', phone: true }]);
	assert.deepEqual(deskOrPhone('A longer.', 'A.'), [
		{ text: 'A longer.', phone: false },
		{ text: 'A.', phone: true, desk: false }
	]);
});

void test('the phone says why a "--" stands: a Proj final with none, a final game with no stats (Lane 115 fix round 1)', () => {
	assert.equal(projFinalPhone(true, true), NO_PROJ_FINAL_PART);
	assert.equal(projFinalPhone(true, false), PROJ_FINAL_PART);
	assert.equal(projFinalPhone(false, true), '');
	assert.equal(
		weekProjPart(
			'Wk 6',
			{ readAt: READ, scoring: CLOSEST, defense: false, league: true, kicked: true },
			NAMED
		),
		"Wk 6 is Pts once final, -- until his stats land, else this week's published projection."
	);
});
