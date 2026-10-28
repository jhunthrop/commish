// The script a page loads on first paint, gzipped, computed from the build output with no browser:
// the page's start and app entries, the route nodes its boot call names, and every chunk those import
// statically. Dynamic imports (the sheet, the mock room) are not counted, the way the budget does not
// count what waits for a reader's first intent. It leaves out the scripts inline in the HTML and is
// not Lighthouse's transfer size (which adds headers). Each page is held to its Lighthouse script
// budget (lighthouse-shared.cjs SCRIPT_BUDGETS), and a page over it exits 1, so a branch's checks
// catch a heavier page before it merges (Lane 252). Run after `npm run build`:
//   node scripts/script-bytes.ts [slug]       the six pages, with the slug for the player page (the
//                                             build's first indexed player by default)
//   VERBOSE=1 node scripts/script-bytes.ts    also each file by weight, and the chunks by weight
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const OUTPUT = '.svelte-kit/cloudflare';
const IMMUTABLE = join(OUTPUT, '_app/immutable');
/** The build's search index: its first entry is the run's top-ranked player (lighthouserc.cjs). */
const BUILT_INDEX = join(OUTPUT, 'data/index.json');
const TOP_CHUNKS = 12;
const STATIC_IMPORT = /(?:from|import)\s*"(\.{1,2}\/[^"]+\.js)"/g;
const ENTRY = /import\("(\.\/_app\/immutable\/entry\/[^"]+\.js)"\)/g;
const NODE_IDS = /node_ids:\s*\[([\d,\s]*)\]/;

interface ScriptBudgets {
	reading: number;
	tool: number;
}
const { SCRIPT_BUDGETS } = createRequire(import.meta.url)('../lighthouse-shared.cjs') as {
	SCRIPT_BUDGETS: ScriptBudgets;
};

/** The first player in the built index, the page Lighthouse audits too. */
function firstSlug(): string {
	const [first] = JSON.parse(readFileSync(BUILT_INDEX, 'utf8')) as { slug?: unknown }[];
	if (typeof first?.slug !== 'string') throw new Error(`${BUILT_INDEX} has no first player.`);
	return first.slug;
}

const slug = process.argv[2] ?? firstSlug();
const verbose = Boolean(process.env.VERBOSE);

const gzipped = (path: string): number => gzipSync(readFileSync(path)).length;
const shortName = (file: string): string => file.replace(`${IMMUTABLE}/`, '');

function nodeFile(id: number): string {
	const dir = join(IMMUTABLE, 'nodes');
	const file = readdirSync(dir).find((name) => name.startsWith(`${String(id)}.`));
	if (!file) throw new Error(`No route node ${String(id)} in ${dir}`);
	return join(dir, file);
}

function collectStaticImports(file: string, seen: Set<string>): void {
	if (seen.has(file)) return;
	seen.add(file);
	const source = readFileSync(file, 'utf8');
	for (const match of source.matchAll(STATIC_IMPORT)) {
		const target = match[1];
		if (target) collectStaticImports(join(file, '..', target), seen);
	}
}

function pageFiles(htmlPath: string): Set<string> {
	const html = readFileSync(htmlPath, 'utf8');
	const files = new Set<string>();
	for (const match of html.matchAll(ENTRY)) {
		const entry = match[1];
		if (entry) collectStaticImports(join(OUTPUT, entry), files);
	}
	const ids = NODE_IDS.exec(html)?.[1];
	if (ids === undefined) throw new Error(`${htmlPath} has no node_ids`);
	for (const id of ids.split(',').filter((part) => part.trim() !== '')) {
		collectStaticImports(nodeFile(Number(id)), files);
	}
	return files;
}

/** The server manifest the build writes beside the Worker: each route's layout and leaf nodes. */
const MANIFEST = '.svelte-kit/output/server/manifest-full.js';
/** A route's page nodes in the manifest: `page: { layouts: [0,4,], errors: [1,,], leaf: 28 }`, read
 * within the route's own entry (an endpoint's has no page, and the match never runs into the next). */
const ROUTE_PAGE =
	/id: "([^"]+)",(?:(?!id: ")[\s\S])*?page: \{ layouts: \[([\d,\s]*)\], errors: [^\]]*\], leaf: (\d+) \}/g;

/** A page the browser draws (no prerendered HTML: a league's pages, ssr off): the app's entries, as
 * the prerendered front door names them, and the nodes the manifest gives its route, its layouts and
 * its leaf (Lane 257). */
function clientFiles(route: string): Set<string> {
	const manifest = readFileSync(MANIFEST, 'utf8');
	const found = [...manifest.matchAll(ROUTE_PAGE)].find((match) => match[1] === route);
	if (found === undefined) throw new Error(`${MANIFEST} has no page for ${route}`);
	const ids = [...(found[2] ?? '').split(','), found[3] ?? ''].filter((id) => id.trim() !== '');
	const files = new Set<string>();
	const html = readFileSync(join(OUTPUT, 'index.html'), 'utf8');
	for (const match of html.matchAll(ENTRY)) {
		const entry = match[1];
		if (entry) collectStaticImports(join(OUTPUT, entry), files);
	}
	for (const id of ids) collectStaticImports(nodeFile(Number(id)), files);
	return files;
}

/** Each page, its built HTML (or, for a page the browser draws, its route) and the budget Lighthouse
 * holds it to (lighthouserc.cjs's matrix). */
const pages: [route: string, html: string, budget: keyof ScriptBudgets][] = [
	['/', 'index.html', 'reading'],
	['/board', 'board.html', 'reading'],
	[`/players/${slug}`, `players/${slug}.html`, 'reading'],
	['/record', 'record.html', 'reading'],
	['/sheet', 'sheet.html', 'tool'],
	['/account', 'account.html', 'tool'],
	['/league/[id]/[screen]', '', 'tool'],
	['/league/[id]', '', 'tool'],
	['/league', '', 'tool']
];

function line(text: string): void {
	process.stdout.write(`${text}\n`);
}

const weights = new Map<string, number>();
const over: string[] = [];
for (const [route, html, budget] of pages) {
	const path = join(OUTPUT, html);
	if (html !== '' && !existsSync(path)) throw new Error(`${path} is not in the build`);
	const files = html === '' ? clientFiles(route) : pageFiles(path);
	let total = 0;
	for (const file of files) {
		const bytes = gzipped(file);
		total += bytes;
		weights.set(file, bytes);
		if (verbose) line(`  ${String(bytes).padStart(7)}  ${shortName(file)}`);
	}
	const limit = SCRIPT_BUDGETS[budget];
	line(
		`${route.padEnd(24)} ${String(files.size).padStart(3)} files ${String(total).padStart(8)} B gz of ${String(limit)}`
	);
	if (total > limit)
		over.push(`${route} loads ${String(total)} B gz, over its ${String(limit)} B budget.`);
}
if (verbose) {
	line('largest files (gzip):');
	const largest = [...weights].sort((a, b) => b[1] - a[1]).slice(0, TOP_CHUNKS);
	for (const [file, bytes] of largest) line(`  ${String(bytes).padStart(7)}  ${shortName(file)}`);
}
for (const message of over) process.stderr.write(`::error::${message}\n`);
if (over.length > 0) process.exitCode = 1;
