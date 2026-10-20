// What the site says of a league's place in its season (spec 2026-10-16 §2, §3): the follow page's
// line for the screen a rail item led there from, the switch's one word beside a league, the league
// page's draft line and final standing. Run with `npm test`.
import assert from 'node:assert/strict';
import { MOCK_VERB } from '#lib/ui/nav.ts';
import { test } from 'node:test';
import {
	ADVISOR_VERB,
	FOLLOW_FOR,
	DRAFT_TOOLS,
	NEXT_DRAFT,
	SHEET_LINK,
	NEXT_DRAFT_ROWS,
	TURNS_AFTER_DRAFT,
	draftLine,
	finalStanding,
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
	for (const line of [ADVISOR_VERB, MOCK_VERB, SHEET_LINK]) clean(line);
});

void test('in season the account says its draft tools in one line', () => {
	assert.equal(
		`${DRAFT_TOOLS.lead} ${DRAFT_TOOLS.mock}${DRAFT_TOOLS.joint}${DRAFT_TOOLS.sheet}`,
		'Draft tools: mock draft, cheat sheet'
	);
	for (const line of Object.values(DRAFT_TOOLS)) clean(line);
});

void test('out of season the account keeps the next draft a tap away', () => {
	assert.deepEqual(
		NEXT_DRAFT_ROWS.map((row) => row.lead),
		['Mock draft', 'Cheat sheet']
	);
	for (const row of NEXT_DRAFT_ROWS) for (const line of Object.values(row)) clean(line);
});
