// The phone bar's one rule (Lane 87): a row for each part the page passes, and no other. Run with
// `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { barRows } from './bar-rows.ts';

const source = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

void test('a page with no stamp, tail or search gets the one row, led by the mark', () => {
	assert.equal(barRows({}), 1);
	assert.equal(barRows({ stamp: '', tail: undefined, search: undefined }), 1);
});

void test('a stamp or a tail without a search gets two rows', () => {
	assert.equal(barRows({ stamp: 'Oct 19' }), 2);
	assert.equal(barRows({ tail: true }), 2);
	assert.equal(barRows({ stamp: 'Oct 19', tail: true }), 2);
});

void test('a search gets the three rows, with or without the others', () => {
	assert.equal(barRows({ search: true }), 3);
	assert.equal(barRows({ stamp: 'Oct 19', tail: true, search: true }), 3);
});

void test('the bar reads its rows from the rule, never from the path', () => {
	const shell = source('./Shell.svelte');
	assert.match(shell, /barRows\(/);
	assert.doesNotMatch(shell, /LEAGUE_PAGE|homed|homeMark/);
	for (const rows of [1, 2, 3]) assert.match(shell, new RegExp(`data-rows='${String(rows)}'`));
});

void test('account passes no bar part: the bottom bar carries its mock draft', () => {
	assert.doesNotMatch(
		source('../account/AccountPage.svelte'),
		/snippet tail\(|MOCK_VERB|Start a mock/
	);
});

void test('a closed lobby passes no search and no Leave', () => {
	const lobby = source('../../routes/lobby/[id]/+page.svelte');
	assert.match(lobby, /search=\{closed \? undefined : /);
	assert.match(lobby, /tail=\{closed \? undefined : /);
	// Closed is every final state: abandoned, finished, or an error answer.
	assert.match(
		lobby,
		/const closed = \$derived\(\s*error !== null \|\| lobby\?\.complete === true \|\| lobby\?\.abandoned === true\s*\)/
	);
});
