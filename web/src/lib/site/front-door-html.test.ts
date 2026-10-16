// The built front door holds both sets of words in its HTML, and the rail styles in its head show
// exactly one of them for each value of the root's `data-rail` (Lane 60, F3): a member whose league is
// in another phase than the site's sees the right words on the first frame, with no script. Reads the
// build, so it is skipped until `npm run build` has run; the gates run it after the build.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RAIL_KEYS, RAIL_OF_WORD_SET, WORD_SETS, wordSetOf } from '#lib/ui/nav.ts';
import { PAGE_VERBS, frontWords } from './season-words.ts';

const BUILT_FRONT_DOOR = new URL('../../../.svelte-kit/cloudflare/index.html', import.meta.url);
const built = existsSync(BUILT_FRONT_DOOR);
const skip = built ? false : 'the site is not built';

/** The words a set draws in the hero, from the same table the page reads. */
function wordsOf(set: (typeof WORD_SETS)[number]): { title: string; verb: string } {
	const words = frontWords(RAIL_OF_WORD_SET[set], { season: 2026 }, false);
	return { title: words.title, verb: PAGE_VERBS[words.verb] };
}

/** The sets a root shows, read from the page's own styles. */
function setsShown(html: string, root: string): string[] {
	const styles = [...html.matchAll(/<style>([^<]*)<\/style>/g)].map((match) => match[1] ?? '');
	return WORD_SETS.filter((set) =>
		styles.some((css) =>
			css.split('}').some((rule) => {
				const [selectors = '', body = ''] = rule.split('{');
				return (
					body.includes('display:contents') &&
					selectors.split(',').includes(`${root} [data-words=${set}]`)
				);
			})
		)
	);
}

void test(
	'the built front door draws both word sets in the bar, the heading and the verbs',
	{ skip },
	() => {
		const html = readFileSync(BUILT_FRONT_DOOR, 'utf8');
		for (const set of WORD_SETS) {
			assert.match(html, new RegExp(`<span data-words="${set}">`), set);
			const words = wordsOf(set);
			assert.ok(html.includes(words.title), `${set}: ${words.title}`);
			assert.ok(html.includes(words.verb), `${set}: ${words.verb}`);
		}
		// The bar, the heading and the verbs each draw a pair.
		const spans = html.match(/<span data-words="(draft|season)">/g) ?? [];
		assert.ok(spans.length >= WORD_SETS.length * 3, String(spans.length));
	}
);

for (const key of RAIL_KEYS) {
	void test(
		`the built front door shows exactly one word set under the ${key} rail`,
		{ skip },
		() => {
			const html = readFileSync(BUILT_FRONT_DOOR, 'utf8');
			assert.deepEqual(setsShown(html, `:root[data-rail=${key}]`), [wordSetOf(key)]);
		}
	);
}

void test('the built front door shows the draft words with no rail named', { skip }, () => {
	const html = readFileSync(BUILT_FRONT_DOOR, 'utf8');
	assert.deepEqual(setsShown(html, ':root:not([data-rail])'), ['draft']);
});
