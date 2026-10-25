// The account's draft prep in season (B52, Lane 105 fix round 1): the draft tools recede from the
// first kickoff through the NFL playoffs, the rail's own season, and return at the offseason and
// the preseason. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Account } from './account-api.ts';
import {
	FREE_PLAN_WORDS,
	FREE_SEASON_PLAN,
	draftToolsRecede,
	planWords,
	whoLine
} from './words.ts';

void test('the draft tools recede in the regular season and the NFL playoffs', () => {
	assert.equal(draftToolsRecede({ phase: 'in_season' }), true);
	assert.equal(draftToolsRecede({ phase: 'playoffs' }), true);
});

void test('the draft tools return in the offseason and the preseason', () => {
	assert.equal(draftToolsRecede({ phase: 'offseason' }), false);
	assert.equal(draftToolsRecede({ phase: 'preseason' }), false);
});

/** An account with no plan, as /me answers a drafter who holds nothing. */
const PLAIN = { membership: null, draft_pass: null } as unknown as Account;

void test("the plan card follows the free season the catalog's flag says, and the not-free card promises no price (Lane 150 fix round 1)", () => {
	assert.deepEqual(planWords(PLAIN, true), FREE_SEASON_PLAN);
	const notFree = planWords(PLAIN, false);
	assert.deepEqual(notFree, {
		title: 'Free',
		line: 'The board, every player, ADP and our record, mock drafts and your cheat sheet stay free.',
		action: null
	});
	assert.doesNotMatch(`${notFree.title} ${notFree.line}`, /\$|price|paid|Draft Pass|Membership/i);
});

void test("the line under the account's name says its email and the day it joined, on the site's clock (Lane 198)", () => {
	assert.equal(
		whoLine({ email: 'm@example.invalid', created_at: '2026-09-01T03:00:00Z' }),
		'm@example.invalid, with us since Aug 31'
	);
	assert.deepEqual(FREE_SEASON_PLAN, { ...FREE_PLAN_WORDS, action: null });
});
