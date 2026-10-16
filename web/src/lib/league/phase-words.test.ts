// What the site says of a league's place in its season (spec 2026-10-16 §2, §3): the follow page's
// line for the screen a rail item led there from, the switch's one word beside a league, the league
// page's draft line and final standing, and the matchup's one line. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LeagueSync, MatchupSide } from './api.ts';
import {
	ADVISOR_VERB,
	FOLLOW_FOR,
	MOCK_VERB,
	NEXT_DRAFT,
	SEE_MATCHUP,
	SHEET_LINK,
	NEXT_DRAFT_ROWS,
	railInSeason,
	TURNS_AFTER_DRAFT,
	draftLine,
	finalStanding,
	matchupSummary,
	phaseWord
} from './phase-words.ts';

const EASTERN = 'America/New_York';
/** A Thursday noon on the Eastern clock. */
const NOW = new Date('2026-10-15T16:00:00.000Z');
const HOUR_MS = 3_600_000;
const later = (hours: number): string => new Date(NOW.getTime() + hours * HOUR_MS).toISOString();

/** The copy rules: no em-dash, no semicolon. */
function clean(line: string): void {
	assert.ok(!line.includes('—'), `em-dash in "${line}"`);
	assert.ok(!line.includes(';'), `semicolon in "${line}"`);
}

void test('the follow page names the screen a rail item led there from', () => {
	assert.equal(FOLLOW_FOR.start, 'Follow your league to see your lineup each week.');
	assert.equal(FOLLOW_FOR.matchup, 'Follow your league to see your matchup each week.');
	assert.equal(FOLLOW_FOR.waivers, 'Follow your league to see your best waiver add each week.');
	assert.equal(FOLLOW_FOR.trades, 'Follow your league to see the trades that help both teams.');
	for (const line of Object.values(FOLLOW_FOR)) clean(line);
});

void test("the switch's word for a league's phase", () => {
	const at = (phase: Parameters<typeof phaseWord>[0]['phase'], draftAt: string | null): string =>
		phaseWord({ phase, draft_at: draftAt }, NOW, EASTERN);
	assert.equal(at('pre_draft', later(4 * 24 + 7)), 'Draft Mon 7:00 pm');
	assert.equal(at('pre_draft', later(10 * 24)), 'Draft Oct 25');
	assert.equal(at('pre_draft', null), 'Not drafted');
	assert.equal(at('draft_day', later(7)), 'Draft today 7:00 pm');
	assert.equal(at('draft_day', later(-1)), 'Drafting');
	assert.equal(at('draft_day', later(14)), 'Draft tomorrow 2:00 am');
	assert.equal(at('draft_day', null), 'Drafting');
	assert.equal(at('in_season', null), 'Drafted');
	assert.equal(at('playoffs', null), 'Playoffs');
	assert.equal(at('offseason', null), 'Season over');
	// A Pacific member reads the draft on their own clock.
	assert.equal(
		phaseWord({ phase: 'draft_day', draft_at: later(7) }, NOW, 'America/Los_Angeles'),
		'Draft today 4:00 pm'
	);
});

void test("the league page's draft line, on the member's clock", () => {
	assert.equal(
		draftLine(later(10 * 24 + 7), NOW, EASTERN),
		'Your draft is Sunday, October 25 at 7:00 pm.'
	);
	assert.equal(draftLine(later(7), NOW, EASTERN), 'Your draft is today at 7:00 pm.');
	assert.equal(draftLine(later(-1), NOW, EASTERN), 'Your draft is on now.');
	assert.equal(draftLine(later(14), NOW, EASTERN), 'Your draft is tomorrow at 2:00 am.');
	assert.equal(draftLine(null, NOW, EASTERN), 'Your league has not set its draft time.');
	assert.equal(TURNS_AFTER_DRAFT, 'The site turns to your season after your draft.');
	for (const line of [draftLine(later(7), NOW, EASTERN), TURNS_AFTER_DRAFT]) clean(line);
});

void test('the offseason names where the team finished, and the next draft', () => {
	assert.equal(
		finalStanding('Ertz Hurts', { wins: 9, losses: 5, ties: 0, place: 3, teams: 12 }),
		'Ertz Hurts finished 3rd of 12 at 9-5.'
	);
	assert.equal(finalStanding('', null), 'Your season is over.');
	assert.equal(NEXT_DRAFT, 'Next draft');
	for (const line of [ADVISOR_VERB, MOCK_VERB, SHEET_LINK, SEE_MATCHUP]) clean(line);
});

const side = (roster: number, points: number): MatchupSide => ({
	roster_id: roster,
	points,
	points_read: true,
	starters: []
});

const sync = (
	over: Partial<LeagueSync>
): Pick<LeagueSync, 'matchup' | 'teams' | 'week_all_play' | 'week'> => ({
	week: 6,
	week_all_play: false,
	teams: [
		{
			roster_id: 1,
			name: 'Muttdogs',
			owner: 'muttdog',
			wins: 5,
			losses: 0,
			ties: 0,
			points_for: 0
		},
		{ roster_id: 2, name: 'Ertz Hurts', owner: 'me', wins: 3, losses: 2, ties: 0, points_for: 0 }
	],
	matchup: { week: 6, mine: side(2, 77.1), opponent: side(1, 84.24) },
	...over
});

void test("the league page's one matchup line names both teams and the score so far", () => {
	assert.equal(matchupSummary(sync({})), 'Week 6, Ertz Hurts 77.1, Muttdogs 84.2.');
	assert.equal(
		matchupSummary(sync({ matchup: { week: 6, mine: side(2, 0), opponent: side(1, 0) } })),
		'Week 6, Ertz Hurts against Muttdogs. No games played yet.'
	);
	assert.equal(
		matchupSummary(
			sync({ week_all_play: true, matchup: { week: 6, mine: side(2, 50), opponent: null } })
		),
		'Week 6, an all-play week. Ertz Hurts 50.0 so far.'
	);
	assert.equal(matchupSummary(sync({ matchup: null })), null);
	clean(matchupSummary(sync({})) ?? '');
});

void test('the account keeps the next draft a tap away in season', () => {
	assert.equal(railInSeason('in_season'), true);
	assert.equal(railInSeason('playoffs_waivers'), true);
	assert.equal(railInSeason('pre_draft'), false);
	assert.equal(railInSeason('offseason'), false);
	assert.deepEqual(
		NEXT_DRAFT_ROWS.map((row) => row.lead),
		['Mock draft', 'Cheat sheet']
	);
	for (const row of NEXT_DRAFT_ROWS) for (const line of Object.values(row)) clean(line);
});
