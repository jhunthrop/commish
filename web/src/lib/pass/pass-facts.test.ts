// The pass page's plans as facts in cells (Lane 66o): each price as the API gives it, the season and
// the dates, never a sentence. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draftPassFacts, groupFacts, membershipFacts, type Price } from './words.ts';

const price = (amount: number, interval: Price['interval'] = null): Price => ({
	amount_cents: amount,
	currency: 'usd',
	interval,
	lookup_key: 'k'
});

const said = (cells: readonly { label: string; value: string }[]): string[][] =>
	cells.map((c) => [c.label, c.value]);

void test('the Draft Pass is its price once, its season, its end and that it never renews', () => {
	const cells = draftPassFacts({
		season: 2026,
		pass_ends_at: '2027-03-01T00:00:00Z',
		draft_pass: price(3900)
	});
	assert.deepEqual(said(cells).slice(0, 2), [
		['Once', '$39'],
		['Season', '2026']
	]);
	const ends = cells.find((c) => c.label === 'Ends');
	assert.ok(ends);
	assert.match(ends.value, /2027/);
	assert.deepEqual(said(cells).at(-1), ['Renews', 'Never']);
	assert.deepEqual(
		draftPassFacts({ season: 2026, pass_ends_at: '2027-03-01T00:00:00Z', draft_pass: null })[0],
		{ label: 'Once', value: 'Not open yet', word: true }
	);
});

void test('the Membership names its billing, its reminder and how it is cancelled', () => {
	assert.deepEqual(said(membershipFacts(price(9900, 'year'))), [
		['A year', '$99'],
		['Renews', 'Yearly'],
		['Reminder', '7 days before'],
		['Cancel', 'One click']
	]);
	assert.deepEqual(said(membershipFacts(price(1499, 'month'))).slice(0, 2), [
		['A month', '$14.99'],
		['Renews', 'Monthly']
	]);
});

void test('the group pass is the total for the teams chosen and the price a team', () => {
	const group = { per_seat: price(3500), min_seats: 4, max_seats: 14 };
	assert.deepEqual(said(groupFacts(group, 12)), [
		['12 teams', '$420'],
		['A team', '$35'],
		['Claims', 'One link']
	]);
	assert.deepEqual(said(groupFacts(null, 12)), [['12 teams', 'Not open yet']]);
});
