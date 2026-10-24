// The head every page prints (Lane 169, ruling 2): its title, canonical address on the apex with no
// query string, the share set, and the markup the Worker answers for a page the browser draws. Run
// with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	documentTitle,
	headHtml,
	headMarkup,
	pageMeta,
	shareTags,
	siteUrl,
	structuredScript
} from './head.ts';
import { organizationData } from './structured-data.ts';

const HEAD = { ...pageMeta('One sentence.', '/players/puka-nacua'), title: 'Puka Nacua' };

void test('the title is the page name and the site', () => {
	assert.equal(documentTitle('Puka Nacua'), 'Puka Nacua · Commish');
});

void test('the canonical address is the apex, with no query string or fragment', () => {
	assert.equal(siteUrl('/compare?a=x&b=y'), 'https://trycommish.app/compare');
	assert.equal(siteUrl('/record#weekly'), 'https://trycommish.app/record');
	assert.equal(siteUrl('/'), 'https://trycommish.app/');
	assert.throws(() => siteUrl('players'));
});

void test('the share set: the og tags with the card at its size, and the large card', () => {
	const tags = Object.fromEntries(shareTags(HEAD).map((tag) => [tag.id, tag.content]));
	assert.deepEqual(tags, {
		'og:description': 'One sentence.',
		'og:url': 'https://trycommish.app/players/puka-nacua',
		'og:site_name': 'Commish',
		'og:type': 'website',
		'og:image': 'https://trycommish.app/share/site.png',
		'og:image:width': '1200',
		'og:image:height': '630',
		'og:image:alt': 'Commish, fantasy football rankings and draft prep',
		'twitter:card': 'summary_large_image'
	});
	const player = shareTags({ ...HEAD, type: 'profile', card: 'player' });
	assert.ok(player.some((tag) => tag.content === 'https://trycommish.app/share/player.png'));
	assert.ok(player.some((tag) => tag.id === 'og:type' && tag.content === 'profile'));
});

void test('a page served at any address names no canonical or og:url', () => {
	const anywhere = { ...HEAD, ...pageMeta('One sentence.', null) };
	assert.ok(!shareTags(anywhere).some((tag) => tag.id === 'og:url'));
	assert.doesNotMatch(headHtml(anywhere), /canonical/);
	// A page whose share opens another address than its canonical one (a member's league).
	const shared = headHtml({ ...HEAD, ...pageMeta('One.', '/league/', { sharePath: '/league/x' }) });
	assert.match(shared, /rel="canonical" href="https:\/\/trycommish\.app\/league\/"/);
	assert.match(shared, /og:url" content="https:\/\/trycommish\.app\/league\/x"/);
});

void test("the Worker's head escapes its words and keeps a member's page out of search", () => {
	const html = headHtml({
		...pageMeta('A "quoted" <b> & more.', '/league/x', { noindex: true }),
		title: 'Your league'
	});
	assert.match(
		html,
		/^<title>Your league · Commish<\/title><meta property="og:title" content="Your league">/
	);
	assert.match(html, /content="A &quot;quoted&quot; &lt;b&gt; &amp; more\."/);
	assert.match(html, /<meta name="robots" content="noindex">/);
	assert.match(html, /<link rel="canonical" href="https:\/\/trycommish\.app\/league\/x">/);
});

void test('the markup a page carries is the head but its title, its data last', () => {
	const markup = headMarkup({ ...HEAD, structured: organizationData() });
	assert.doesNotMatch(markup, /<title>|og:title/);
	assert.match(markup, /^<meta name="description" content="One sentence\.">/);
	assert.match(markup, /<script type="application\/ld\+json">\{[^<]*\}<\/script>$/);
});

void test('the structured data never closes its script early', () => {
	const script = structuredScript({ ...organizationData(), name: '</script><b>' });
	assert.equal(script.match(/<\/script>/g)?.length, 1);
	assert.match(script, /\\u003c\/script>/);
});
