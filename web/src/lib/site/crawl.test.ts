// What a crawler reads besides the pages (Lane 169, rulings 4 and 5): the robots file keeps every
// crawler allowed, the assistants' included, and only the member's own pages out; the sitemap is
// well formed; /llms.txt is the plain-text convention. The built files are read by head-html.test.ts.
// Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedIn } from '#lib/format/copy-guard.ts';
import {
	CRAWLED_UNDER,
	LLMS_ABOUT,
	UNCRAWLED_PATHS,
	llmsTxt,
	robotsTxt,
	sitemapXml
} from './crawl.ts';

const AI_CRAWLERS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot'];

void test('the robots file allows every crawler and keeps out only the member pages', () => {
	const robots = robotsTxt();
	const agents = robots.match(/^User-agent: .*$/gm) ?? [];
	assert.deepEqual(agents, ['User-agent: *']);
	for (const crawler of AI_CRAWLERS) assert.doesNotMatch(robots, new RegExp(crawler));
	const disallowed = (robots.match(/^Disallow: (.*)$/gm) ?? []).map((line) => line.slice(10));
	assert.ok(!disallowed.includes('/'));
	assert.deepEqual(disallowed, [...UNCRAWLED_PATHS]);
	const allowed = (robots.match(/^Allow: (.*)$/gm) ?? []).map((line) => line.slice(7));
	assert.deepEqual(allowed, [...CRAWLED_UNDER, '/']);
	assert.ok(allowed.includes('/mock/share/'), 'a shared mock unfurls');
	assert.match(robots, /^Sitemap: https:\/\/trycommish\.app\/sitemap\.xml$/m);
});

void test('the sitemap lists each page once on the apex with the run as its last change', () => {
	const xml = sitemapXml(['/', '/players/a', '/players/a', '/record'], '2026-10-21T06:00:00Z');
	const locs = xml.match(/<loc>[^<]+<\/loc>/g) ?? [];
	assert.deepEqual(locs, [
		'<loc>https://trycommish.app/</loc>',
		'<loc>https://trycommish.app/players/a</loc>',
		'<loc>https://trycommish.app/record</loc>'
	]);
	assert.equal(xml.match(/<lastmod>2026-10-21T06:00:00Z<\/lastmod>/g)?.length, 3);
	assert.match(
		xml,
		/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/
	);
});

void test('/llms.txt is a title, the paragraph, then one line per page', () => {
	const text = llmsTxt([{ name: 'Our record', path: '/record', line: 'What it grades.' }]);
	assert.equal(
		text,
		`# Commish\n\n> ${LLMS_ABOUT}\n\n## Public pages\n\n- [Our record](https://trycommish.app/record): What it grades.\n`
	);
	assert.equal(bannedIn(LLMS_ABOUT), null);
});
