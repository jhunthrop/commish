// The in-season screens say the site's not-found in the words of the root error page: the two
// spellings stay equal. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LINES } from '#lib/league/inseason/words.ts';

const ERROR_PAGE = readFileSync(new URL('./+error.svelte', import.meta.url), 'utf8');

void test("the in-season not-found reads the root error page's three strings", () => {
	for (const words of [LINES.notFoundBar, LINES.notFound, LINES.notFoundLine]) {
		assert.ok(ERROR_PAGE.includes(`'${words}'`), words);
	}
});
