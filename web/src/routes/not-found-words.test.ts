// The in-season screens say the site's not-found in the error pages' words (site/error-words.ts):
// the two spellings stay equal, and both error pages draw them through one view with one verb.
// Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LINES } from '#lib/league/inseason/words.ts';
import { ERROR_WORDS } from '#lib/site/error-words.ts';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const ERROR_VIEW = read('../lib/site/ErrorView.svelte');
/** The Worker's error page and the prerendered not-found page (Lane 148). */
const PAGES = [read('./+error.svelte'), read('./404/+page.svelte')];

void test("the in-season not-found reads the error pages' three strings", () => {
	assert.deepEqual(
		[LINES.notFoundBar, LINES.notFound, LINES.notFoundLine, LINES.toBoard],
		[
			ERROR_WORDS.notFound.bar,
			ERROR_WORDS.notFound.head,
			ERROR_WORDS.notFound.lead,
			ERROR_WORDS.toBoard
		]
	);
});

void test('the not-found page gives one way on, a single verb (the sweep C14)', () => {
	assert.deepEqual(ERROR_VIEW.match(/<(Verb|Quiet)\b/gu) ?? [], ['<Verb']);
	for (const page of PAGES) {
		assert.ok(page.includes('<ErrorView'), 'draws the one error view');
		assert.deepEqual(page.match(/<(Verb|Quiet)\b/gu) ?? [], []);
		// Words from the word table only: no literal sentence in the page.
		assert.doesNotMatch(page, /'[A-Z][a-z]+ [a-z]/u);
	}
});
