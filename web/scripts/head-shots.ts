// The heads the served site answers with (Lane 169, ruling 7): reads the head of ten prerendered
// pages and two pages the browser draws from the Worker, the sitemap, the robots file and /llms.txt,
// asserts each page's one title, one description, canonical address, share set and structured data,
// and draws each page's unfurl as a reader sees it (the share card, the title, the sentence) at 1280
// and 390, beside a heads.md listing every tag read. Exits non-zero on any fault.
//
//   node scripts/head-shots.ts [web origin] [out dir]
// with the site built and served by the Worker (scripts/shots.ts starts both).
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { canonicalPathOf } from '../src/lib/server/worker-head.ts';
import { robotsTxt } from '../src/lib/site/crawl.ts';
import { SITE_ORIGIN } from '../src/lib/site/origins.ts';
import { structuredFaults, type StructuredData } from '../src/lib/site/structured-data.ts';

const web = process.argv[2] ?? 'http://localhost:4196';
const out = new URL(process.argv[3] ?? '../screenshots/heads/', import.meta.url);
const WIDTHS = [1280, 390] as const;
const SHARE_SET = ['og:title', 'og:description', 'og:site_name', 'og:type', 'og:image'] as const;

/** The pages read: ten the build prerenders, then two the browser draws, whose head the Worker
 * answers with (server/worker-head.ts). The player is the rankings page's first. */
const PRERENDERED = [
	'/',
	'/players',
	'/record',
	'/board/ppr-12',
	'/board/ppr-12/wr',
	'/adp/ppr-12',
	'/clubs/lv',
	'/schedule',
	'/pass',
	'/terms'
] as const;
const DRAWN = ['/league/fixture-league', '/mock/new', '/mock/share/fixture-share'] as const;

interface Head {
	path: string;
	title: string;
	description: string;
	canonical: string | null;
	tags: Record<string, string>;
	structured: StructuredData[];
	noindex: boolean;
}

const faults: string[] = [];
const fault = (text: string): void => {
	faults.push(text);
};

const unescaped = (text: string): string =>
	text
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');

async function text(path: string): Promise<string> {
	const answer = await fetch(`${web}${path}`, { redirect: 'manual' });
	if (answer.status !== 200) throw new Error(`${path} answered ${String(answer.status)}`);
	return answer.text();
}

/** The page's head as served, and a fault for each tag it lacks or prints twice. */
async function readHead(path: string): Promise<Head> {
	const html = await text(path);
	const head = html.slice(0, html.indexOf('</head>'));
	const titles = [...head.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => unescaped(m[1] ?? ''));
	const descriptions = [...head.matchAll(/<meta name="description" content="([^"]*)"/g)];
	const canonicals = [...head.matchAll(/<link rel="canonical" href="([^"]+)"/g)];
	const tags = Object.fromEntries(
		[...head.matchAll(/<meta (?:property|name)="((?:og|twitter):[^"]+)" content="([^"]*)"/g)].map(
			(m) => [m[1] ?? '', unescaped(m[2] ?? '')]
		)
	);
	const structured = [
		...head.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)
	].map((m) => JSON.parse(m[1] ?? '') as StructuredData);
	if (titles.length !== 1) fault(`${path}: ${String(titles.length)} titles`);
	if (descriptions.length !== 1) fault(`${path}: ${String(descriptions.length)} descriptions`);
	if (canonicals.length !== 1) fault(`${path}: ${String(canonicals.length)} canonical links`);
	for (const id of SHARE_SET) if (!tags[id]) fault(`${path}: no ${id}`);
	if (tags['twitter:card'] !== 'summary_large_image') fault(`${path}: no large card`);
	for (const data of structured)
		for (const missing of structuredFaults(data)) fault(`${path}: ${missing}`);
	const canonical = canonicals[0]?.[1] ?? null;
	// A page the browser draws names its section canonical, never a member's id, and its share is the
	// request's own address (fix round 1, M1).
	const drawn = (DRAWN as readonly string[]).includes(path);
	if (canonical !== `${SITE_ORIGIN}${drawn ? canonicalPathOf(path) : path}`)
		fault(`${path}: canonical ${String(canonical)}`);
	if (tags['og:url'] !== `${SITE_ORIGIN}${path}`)
		fault(`${path}: og:url ${String(tags['og:url'])}`);
	return {
		path,
		title: titles[0] ?? '',
		description: unescaped(descriptions[0]?.[1] ?? ''),
		canonical,
		tags,
		structured,
		noindex: head.includes('<meta name="robots" content="noindex"')
	};
}

/** The unfurl as a chat app draws it: the card, the site, the title, the sentence. */
function unfurlHtml(heads: readonly Head[]): string {
	const card = (head: Head): string => {
		const image = (head.tags['og:image'] ?? '').replace(SITE_ORIGIN, web);
		return `<article><img src="${image}" alt=""><div class="meta"><div class="site">${head.tags['og:site_name'] ?? ''}</div><div class="t">${head.tags['og:title'] ?? ''}</div><div class="d">${head.description}</div><div class="u">${head.canonical ?? ''}${head.noindex ? ' · kept out of search' : ''}${head.structured.length > 0 ? ` · ${head.structured.map((d) => d['@type']).join(', ')}` : ''}</div></div></article>`;
	};
	return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>
body{margin:0;background:#f2f0ee;font:14px/1.4 -apple-system,system-ui,sans-serif;color:#1d1c1d}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px;padding:16px}
article{background:#fff;border-radius:12px;overflow:hidden;border:1px solid #ddd}
img{width:100%;aspect-ratio:1200/630;object-fit:cover;display:block;background:#090807}
.meta{padding:10px 12px}.site{font-weight:700;font-size:12px;color:#616061}
.t{font-weight:700;color:#1264a3;margin:2px 0}.d{font-size:14px}.u{margin-top:6px;font-size:11px;color:#8a8886;word-break:break-all}
</style></head><body><main>${heads.map(card).join('')}</main></body></html>`;
}

await mkdir(out, { recursive: true });
const players = await readHead('/players');
const first = players.structured.find((data) => data['@type'] === 'ItemList');
const playerPath =
	first?.['@type'] === 'ItemList'
		? new URL(first.itemListElement[0]?.url ?? SITE_ORIGIN).pathname
		: null;
if (playerPath === null) fault('/players: no ItemList to take a player from');
const paths = [...PRERENDERED, ...(playerPath === null ? [] : [playerPath])];
const heads = [
	players,
	...(await Promise.all(paths.filter((path) => path !== '/players').map(readHead))),
	...(await Promise.all(DRAWN.map(readHead)))
];
for (const path of DRAWN) {
	const head = heads.find((candidate) => candidate.path === path);
	if (head && !head.noindex) fault(`${path}: a member's page is not kept out of search`);
}

const sitemap = await text('/sitemap.xml');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] ?? '');
for (const head of heads.filter((candidate) => !candidate.noindex && candidate.canonical !== null))
	if (!locs.includes(head.canonical ?? '')) fault(`sitemap: no ${head.canonical ?? ''}`);
for (const path of DRAWN)
	if (locs.some((loc) => loc.startsWith(`${SITE_ORIGIN}${path}`))) fault(`sitemap: lists ${path}`);
if ((await text('/robots.txt')) !== robotsTxt()) fault('robots.txt is not the one built');
const llms = await text('/llms.txt');
for (const url of [...llms.matchAll(/\]\((https:[^)]+)\)/g)].map((m) => m[1] ?? '')) {
	const answer = await fetch(`${web}${new URL(url).pathname}`, { redirect: 'manual' });
	if (answer.status !== 200) fault(`llms.txt: ${url} answered ${String(answer.status)}`);
}

const browser = await chromium.launch();
try {
	for (const width of WIDTHS) {
		const page = await browser.newPage({ viewport: { width, height: 900 } });
		await page.setContent(unfurlHtml(heads), { waitUntil: 'networkidle' });
		await page.screenshot({
			path: new URL(`unfurls-${String(width)}.png`, out).pathname,
			fullPage: true
		});
		await page.close();
	}
} finally {
	await browser.close();
}

const listing = [
	`# Heads read from ${web}`,
	'',
	`Sitemap: ${String(locs.length)} pages. robots.txt and llms.txt read.`,
	'',
	...heads.flatMap((head) => [
		`## ${head.path}`,
		'',
		`- title: ${head.title}`,
		`- description: ${head.description}`,
		`- canonical: ${head.canonical ?? 'none'}${head.noindex ? ' (noindex)' : ''}`,
		...Object.entries(head.tags).map(([id, content]) => `- ${id}: ${content}`),
		...head.structured.map((data) => `- JSON-LD: ${JSON.stringify(data)}`),
		''
	]),
	'## llms.txt',
	'',
	'```',
	llms.trimEnd(),
	'```',
	''
].join('\n');
await writeFile(new URL('heads.md', out), listing);
process.stdout.write(`${String(heads.length)} heads, ${String(locs.length)} sitemap pages\n`);
if (faults.length > 0) {
	process.stdout.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
