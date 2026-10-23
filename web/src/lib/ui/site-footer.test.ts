// The site footer is the shell's (Lane 151): drawn once, after the page, so every page the shell
// draws, prerendered or drawn by the Worker, closes with it, and the room for a pinned verb is the
// footer's alone. Its markup is the word table's, word for word. Run with `npm test`.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SUPPORT_EMAIL, SUPPORT_HREF } from '#lib/legal/contact.ts';
import { FOOT } from '#lib/legal/foot-words.ts';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

void test('the shell draws the footer once, after the page', () => {
	const shell = read('./Shell.svelte');
	assert.equal(shell.match(/<SiteFooter\b/g)?.length, 1);
	assert.ok(shell.indexOf('{@render children()}') < shell.indexOf('<SiteFooter'));
});

void test("the footer's markup is the word table's, word for word, and links the two routes", () => {
	const footer = read('./SiteFooter.svelte');
	const markup = /<footer class="site-foot">([\s\S]*?)<\/footer>/.exec(footer)?.[1] ?? '';
	const parts = [...markup.matchAll(/<(span|a)(?: href="([^"]*)")?>([^<]*)<\/\1>/g)].map(
		([, tag, href, words]) => ({ tag, href: href ?? null, words })
	);
	assert.deepEqual(parts, [
		{ tag: 'span', href: null, words: FOOT.owner },
		{ tag: 'a', href: '/terms', words: FOOT.terms },
		{ tag: 'a', href: '/privacy', words: FOOT.privacy },
		{ tag: 'a', href: SUPPORT_HREF, words: SUPPORT_EMAIL }
	]);
	for (const route of ['../../routes/terms/+page.svelte', '../../routes/privacy/+page.svelte']) {
		assert.ok(existsSync(new URL(route, import.meta.url)), route);
	}
	assert.match(
		read('../legal/legal-links.ts'),
		/resolve\('\/terms'\)[\s\S]*resolve\('\/privacy'\)/
	);
});

void test('each verb pinned above the tab bar is marked, so the footer keeps its room', () => {
	assert.match(read('../league/box/PinnedVerb.svelte'), /class="pinned" data-pin/);
	assert.match(read('../player/PlayerCard.svelte'), /class="act" data-pin/);
	assert.match(read('./SiteFooter.svelte'), /:global\(\.main:has\(\[data-pin\]\)\)/);
	assert.match(read('./tokens.css'), /--pin-reserve:/);
});
