// The script a page loads on first paint, gzipped, computed from the build output with no browser:
// the page's start and app entries, the route nodes its boot call names, and every chunk those import
// statically. Dynamic imports (the sheet, the mock room) are not counted, the way the budget does not
// count what waits for a reader's first intent. It leaves out the scripts inline in the HTML and is
// not Lighthouse's transfer size (which adds headers), so compare it only with itself. Run after
// `npm run build`:
//   node scripts/script-bytes.ts [slug]       the six pages, with the slug for the player page
//   VERBOSE=1 node scripts/script-bytes.ts    also each file by weight, and the chunks by weight
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const OUTPUT = '.svelte-kit/cloudflare';
const IMMUTABLE = join(OUTPUT, '_app/immutable');
const DEFAULT_SLUG = 'puka-nacua';
const TOP_CHUNKS = 12;
const STATIC_IMPORT = /(?:from|import)\s*"(\.{1,2}\/[^"]+\.js)"/g;
const ENTRY = /import\("(\.\/_app\/immutable\/entry\/[^"]+\.js)"\)/g;
const NODE_IDS = /node_ids:\s*\[([\d,\s]*)\]/;

const slug = process.argv[2] ?? DEFAULT_SLUG;
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

const pages: [route: string, html: string][] = [
	['/', 'index.html'],
	['/board', 'board.html'],
	[`/players/${slug}`, `players/${slug}.html`],
	['/record', 'record.html'],
	['/sheet', 'sheet.html'],
	['/account', 'account.html']
];

function line(text: string): void {
	process.stdout.write(`${text}\n`);
}

const weights = new Map<string, number>();
for (const [route, html] of pages) {
	const path = join(OUTPUT, html);
	if (!existsSync(path)) throw new Error(`${path} is not in the build`);
	const files = pageFiles(path);
	let total = 0;
	for (const file of files) {
		const bytes = gzipped(file);
		total += bytes;
		weights.set(file, bytes);
		if (verbose) line(`  ${String(bytes).padStart(7)}  ${shortName(file)}`);
	}
	line(
		`${route.padEnd(24)} ${String(files.size).padStart(3)} files ${String(total).padStart(8)} B gz`
	);
}
if (verbose) {
	line('largest files (gzip):');
	const largest = [...weights].sort((a, b) => b[1] - a[1]).slice(0, TOP_CHUNKS);
	for (const [file, bytes] of largest) line(`  ${String(bytes).padStart(7)}  ${shortName(file)}`);
}
