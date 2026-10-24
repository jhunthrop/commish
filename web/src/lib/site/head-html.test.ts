// Every prerendered page's head as the build wrote it (Lane 169, ruling 6): one title, one
// description, one canonical address, the share set and valid structured data; the sitemap lists
// every player's page and only pages that are there, at their canonical address and in search; and
// /llms.txt names only pages that answer. Reads the build, so it is skipped until `npm run build` has
// run; the gates run it after the build.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { bannedIn, bannedInCopy } from '#lib/format/copy-guard.ts';
import { robotsTxt } from './crawl.ts';
import { SITE_ORIGIN } from './origins.ts';
import { structuredFaults, type StructuredData } from './structured-data.ts';

const BUILT = new URL('../../../.svelte-kit/cloudflare/', import.meta.url).pathname;
const built = existsSync(join(BUILT, 'index.html'));
const skip = built ? false : 'the site is not built';
/** The two pages Disney's ESPN sign-in runs in, served as files with no shell. */
const OUTSIDE_SHELL = new Set(['espn-connect.html', 'espn-responder.html']);
/** A short format slug's page: a redirect to its canonical one, no head of its own. */
const isRedirect = (html: string): boolean => html.startsWith('<script>location.href=');
const SHARE_SET = [
	'og:title',
	'og:description',
	'og:site_name',
	'og:type',
	'og:image',
	'twitter:card'
] as const;

interface BuiltPage {
	file: string;
	path: string;
	html: string;
}

function htmlFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === '_app' ? [] : htmlFiles(full);
		return entry.name.endsWith('.html') ? [full] : [];
	});
}

/** Every page the build wrote with a head of its own, by its address. */
function pages(): BuiltPage[] {
	return htmlFiles(BUILT)
		.map((full) => {
			const file = relative(BUILT, full);
			const path = file === 'index.html' ? '/' : `/${file.replace(/\.html$/, '')}`;
			return { file, path, html: readFileSync(full, 'utf8') };
		})
		.filter((page) => !OUTSIDE_SHELL.has(page.file) && !isRedirect(page.html));
}

const count = (html: string, pattern: RegExp): number =>
	html.match(new RegExp(pattern.source, 'g'))?.length ?? 0;
const metaContent = (html: string, attr: string, id: string): string | null =>
	new RegExp(`<meta ${attr}="${id}" content="([^"]*)"`).exec(html)?.[1] ?? null;
const canonicalOf = (html: string): string | null =>
	/<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? null;
const noindex = (html: string): boolean => html.includes('<meta name="robots" content="noindex"');
const structuredOf = (html: string): StructuredData[] =>
	[...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map(
		(match) => JSON.parse(match[1] ?? '') as StructuredData
	);
const unescaped = (text: string): string =>
	text
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');

/** The names a description carries as data, which the copy guard skips (copy-guard.ts, ruling R3):
 * every club's and every player's, read from their pages' titles. */
function dataNames(): Set<string> {
	const titled = (dir: string): string[] =>
		readdirSync(join(BUILT, dir))
			.filter((name) => name.endsWith('.html'))
			.map((name) => readFileSync(join(BUILT, dir, name), 'utf8'))
			.map((html) => /<title>([^<]+) · Commish<\/title>/.exec(html)?.[1] ?? '')
			.filter((title) => title !== '');
	return new Set([...titled('clubs'), ...titled('players')].map(unescaped));
}

/** The built page an address on the site answers with, null where none is built. */
function pageAt(url: string): BuiltPage | null {
	const path = new URL(url).pathname;
	const file = path === '/' ? 'index.html' : `${path.slice(1)}.html`;
	const full = join(BUILT, file);
	if (!existsSync(full)) return null;
	return { file, path, html: readFileSync(full, 'utf8') };
}

void test(
	'every prerendered page has one title, one description, the share set and its canonical address',
	{ skip },
	() => {
		const names = dataNames();
		for (const page of pages()) {
			const { html, file } = page;
			assert.equal(count(html, /<title>/), 1, `${file}: title`);
			assert.match(html, /<title>[^<]+ · Commish<\/title>/, file);
			assert.equal(count(html, /<meta name="description"/), 1, `${file}: description`);
			const description = unescaped(metaContent(html, 'name', 'description') ?? '');
			assert.ok(description.length > 0, `${file}: an empty description`);
			assert.equal(bannedInCopy(description, names), null, `${file}: ${description}`);
			for (const id of SHARE_SET) {
				const attr = id.startsWith('og:') ? 'property' : 'name';
				assert.equal(count(html, new RegExp(`<meta ${attr}="${id}" `)), 1, `${file}: ${id}`);
			}
			const canonical = canonicalOf(html);
			// The not-found page is served at any address and names none.
			if (file === '404.html') assert.equal(canonical, null, file);
			else {
				assert.equal(count(html, /<link rel="canonical"/), 1, `${file}: canonical`);
				assert.ok(canonical?.startsWith(`${SITE_ORIGIN}/`) && !canonical.includes('?'), file);
				assert.equal(metaContent(html, 'property', 'og:url'), canonical, `${file}: og:url`);
			}
			for (const data of structuredOf(html)) assert.deepEqual(structuredFaults(data), [], file);
		}
	}
);

void test('the pages in search have titles of their own', { skip }, () => {
	const titles = new Map<string, string>();
	for (const page of pages()) {
		if (noindex(page.html) || canonicalOf(page.html) !== `${SITE_ORIGIN}${page.path}`) continue;
		const title = /<title>([^<]+)<\/title>/.exec(page.html)?.[1] ?? '';
		assert.equal(
			titles.get(title),
			undefined,
			`${page.file} and ${titles.get(title) ?? ''}: ${title}`
		);
		titles.set(title, page.file);
	}
	assert.ok(titles.size > 100, String(titles.size));
});

void test('each page family carries its structured data', { skip }, () => {
	const typesOf = (file: string): string[] =>
		structuredOf(readFileSync(join(BUILT, file), 'utf8')).map((data) => data['@type']);
	assert.deepEqual(typesOf('index.html'), ['Organization']);
	assert.deepEqual(typesOf('players.html'), ['ItemList']);
	assert.deepEqual(typesOf('record.html'), ['Dataset']);
	const players = readdirSync(join(BUILT, 'players')).filter((name) => name.endsWith('.html'));
	for (const name of players) {
		const html = readFileSync(join(BUILT, 'players', name), 'utf8');
		assert.deepEqual(typesOf(join('players', name)), ['Person'], name);
		assert.equal(metaContent(html, 'property', 'og:type'), 'profile', name);
		assert.match(metaContent(html, 'property', 'og:image') ?? '', /\/share\/player\.png$/, name);
	}
});

void test(
	'the sitemap lists every player page and only pages that are built, canonical and in search',
	{ skip },
	() => {
		const xml = readFileSync(join(BUILT, 'sitemap.xml'), 'utf8');
		const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1] ?? '');
		assert.equal(new Set(locs).size, locs.length, 'a page listed twice');
		const players = readdirSync(join(BUILT, 'players'))
			.filter((name) => name.endsWith('.html'))
			.map((name) => `${SITE_ORIGIN}/players/${name.replace(/\.html$/, '')}`);
		for (const player of players) assert.ok(locs.includes(player), player);
		for (const loc of locs) {
			const page = pageAt(loc);
			assert.ok(page !== null && !isRedirect(page.html), `${loc}: not built`);
			assert.equal(canonicalOf(page.html), loc, `${loc}: not its canonical address`);
			assert.ok(!noindex(page.html), `${loc}: kept out of search`);
		}
	}
);

void test(
	'/llms.txt names only pages that answer, and the robots file is the one built',
	{ skip },
	() => {
		const llms = readFileSync(join(BUILT, 'llms.txt'), 'utf8');
		const urls = [...llms.matchAll(/\]\((https:[^)]+)\)/g)].map((match) => match[1] ?? '');
		assert.ok(urls.length >= 4, String(urls.length));
		for (const url of urls) {
			const page = pageAt(url);
			assert.ok(page !== null && !isRedirect(page.html), `${url}: no page answers`);
		}
		assert.equal(bannedIn(llms.replace(/\(https:[^)]+\)/g, '')), null);
		assert.equal(readFileSync(join(BUILT, 'robots.txt'), 'utf8'), robotsTxt());
	}
);
