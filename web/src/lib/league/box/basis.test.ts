// The in-season screens' basis parts (Lane 66t): each names one column the screen draws, once, and
// the copy guard holds over every one. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { PlayerLine, WeekFacts } from '../inseason/api.ts';
import {
	basisText,
	boxBasisParts,
	deltaPart,
	gamePart,
	KICKED_OFF_PART,
	kickedOffPartAt,
	OPP_PART,
	RANK_OPP_PART,
	projPart,
	ptsPart,
	uncountedParts,
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

void test('the uncounted rules are the API sentence, then its link to the Settings list', () => {
	const advice = {
		basis_note: 'Avg and Last miss five of your rules our stats lack.',
		basis_note_link: 'Which five'
	};
	assert.deepEqual(uncountedParts(advice, '/league/1#uncounted'), [
		{ text: advice.basis_note, phone: true },
		{ text: 'Which five', phone: true, href: '/league/1#uncounted' }
	]);
	assert.deepEqual(uncountedParts({ basis_note: '', basis_note_link: '' }, '/x'), []);
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
		ptsPart(true, 'espn', 'rows')
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
				asSetShown: true,
				previousReadAt: BEFORE,
				note: {
					basis_note: 'Avg and Last miss five of your rules our stats lack.',
					basis_note_link: 'Which five'
				},
				rulesHref: '/league/1#uncounted'
			}
		},
		CENTRAL,
		NOW
	);
	assert.equal(
		basisText(parts),
		"Our pick starts the highest Proj at each slot. Proj is this week's published projection, PPR nearest your rules, read Fri 9:00 pm. Δ Proj is its change since Thu 9:00 pm. Game is each club's expected points, his first, and weather, read Fri 4:01 pm. Our rank is his place at his position in our order, Opp rank the points allowed to it, 1st fewest. Pts are Sleeper's points so far, Team adds the rows. Avg and Last miss five of your rules our stats lack. Which five"
	);
	assert.deepEqual(
		parts.filter((p) => !p.phone).map((p) => p.text),
		['Our pick starts the highest Proj at each slot.', 'Δ Proj is its change since Thu 9:00 pm.']
	);
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
								asSetShown: false,
								previousReadAt: null,
								note: { basis_note: '', basis_note_link: '' },
								rulesHref: '/league/1#uncounted'
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
		asSetShown: false,
		previousReadAt: null,
		note: { basis_note: '', basis_note_link: '' },
		rulesHref: '/league/1#uncounted'
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
	assert.ok(phone.includes(RANK_OPP_PART));
	assert.ok(phone.some((t) => t.startsWith("Game is each club's expected points")));
	assert.ok(!phone.includes(KICKED_OFF_PART));
	assert.ok(sunday.some((p) => p.text === KICKED_OFF_PART && !p.phone));
	// No row draws them (every game kicked off): the Final sentence is said on the phone too.
	const tuesday = at([waiting]);
	assert.ok(tuesday.some((p) => p.text === KICKED_OFF_PART && p.phone));
});

void test('the Final sentence says what holds, never a promise of within the hour (Lane 84)', () => {
	assert.equal(KICKED_OFF_PART, 'Final lands the hour after a game ends, its stats by Wednesday.');
	assert.equal(bannedPattern().test(KICKED_OFF_PART), false);
});
