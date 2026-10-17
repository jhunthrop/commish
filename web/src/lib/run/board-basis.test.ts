// A page of board rows says its basis once (Lane 66n): the order, the ADP's drafts, the gap and the
// season's columns, short enough for five lines on a phone. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GAP_WORDS, boardBasis, type BasisFacts } from './board-basis.ts';

const PRESEASON: BasisFacts = {
	format: { label: 'PPR', teams: 12 },
	season: 2026,
	order: 'board',
	adpBasis: ['PPR drafts, Sep 9'],
	gap: true,
	reach: { scoring: 'PPR', through: 5 }
};

const text = (facts: BasisFacts, phone = false): string =>
	boardBasis(facts)
		.filter((part) => !phone || part.phone)
		.map((part) => part.text)
		.join(' ');

void test('the board says its order, its drafts, the gap and the season columns once', () => {
	assert.equal(
		text(PRESEASON),
		"Our PPR board, by points over replacement for 12 teams. ADP from PPR drafts, Sep 9. Gap, drafters' ADP less our rank: green when they wait, rose when they reach. GP and A game are this season's, through week 5."
	);
});

void test('the phone leaves out the season columns it does not draw', () => {
	assert.doesNotMatch(text(PRESEASON, true), /GP and A game/);
	assert.match(text(PRESEASON, true), /Gap, drafters/);
});

void test('a position view names its tiers, ADP leads with the drafts and counts the undrafted', () => {
	assert.match(text({ ...PRESEASON, position: 'WR' }), /Tiers are drawn within WR\./);
	const adp = text({ ...PRESEASON, order: 'adp', noAdp: 333 });
	assert.match(adp, /^ADP from PPR drafts, Sep 9, earliest first\. Our PPR board, by points /);
	assert.match(adp, /333 players on our board have no ADP yet\.$/);
});

void test('a rest-of-season board names the week and the refresh, and no gap', () => {
	const rest = text({
		...PRESEASON,
		format: { label: 'PPR', teams: 12, rosFromWeek: 6, refreshedAt: '2026-10-14T12:00:00.000Z' },
		gap: false
	});
	assert.match(
		rest,
		/the rest of the 2026 season from week 6, by points over replacement for 12 teams, refreshed October 14\./
	);
	assert.doesNotMatch(rest, /Gap, drafters/);
});

void test('the season columns name another scoring, and nothing before the first kickoff', () => {
	const half = text({ ...PRESEASON, format: { label: 'Half PPR', teams: 12 } });
	assert.match(half, /scored in PPR, through week 5/);
	assert.doesNotMatch(text({ ...PRESEASON, reach: null }), /GP/);
});

void test('no sentence carries an em-dash, a semicolon or a betting word', () => {
	const all = [GAP_WORDS, text(PRESEASON), text({ ...PRESEASON, order: 'adp', noAdp: 3 })].join(
		' '
	);
	assert.doesNotMatch(all, /[—;]|\b(odds|line|spread|bet|market|price|buy|sell)\b/iu);
});
