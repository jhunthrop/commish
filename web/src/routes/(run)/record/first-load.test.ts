// The record's first-load script stays inside the reading budget (Lane 253): at rest the page draws
// the run's own record, so nothing it imports statically reaches the league's code, which loads with
// the league's reads, or the board's and rows' chunks, which a stray shared import once pulled in
// (86,962 B gz against 73,728). scripts/script-bytes.ts measures the built bytes; this holds the
// import graph that keeps them down, with no build. Run with `npm test`.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..', '..');
const LIB = join(SRC, 'lib');
const PAGE = join(HERE, '+page.svelte');

/** A static import with what it names: `import type` alone loads nothing. Dynamic imports are left
 * out, as the budget leaves them out. */
const STATIC_IMPORT = /import\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?'([^']+)'/g;

/** The modules the record at rest must never load with the page. */
const AFTER_PAINT = [
	'lib/run/record-league.ts',
	'lib/run/record-starters.ts',
	'lib/league/record-api.ts',
	'lib/format/list.ts',
	'lib/site/BoardView.svelte',
	'lib/site/absent.ts',
	'lib/ui/Row.svelte'
];

function resolveImport(from: string, specifier: string): string | null {
	if (specifier.startsWith('#lib/')) return join(LIB, specifier.slice('#lib/'.length));
	if (specifier.startsWith('.')) return join(dirname(from), specifier);
	return null;
}

function staticGraph(entry: string): Set<string> {
	const seen = new Set<string>();
	const visit = (file: string): void => {
		if (seen.has(file) || !existsSync(file)) return;
		seen.add(file);
		if (file.endsWith('.css') || file.endsWith('.json')) return;
		for (const match of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
			const [, typeOnly, specifier] = match;
			if (typeOnly !== undefined || specifier === undefined) continue;
			const target = resolveImport(file, specifier);
			if (target !== null) visit(target);
		}
	};
	visit(entry);
	return seen;
}

void test("the record at rest imports none of the league's or the board's code", () => {
	const reached = new Set([...staticGraph(PAGE)].map((file) => relative(SRC, file)));
	assert.ok(reached.has('routes/(run)/record/WeeklySection.svelte'), 'the graph is walked');
	assert.ok(reached.has('lib/run/records.ts'), 'the graph reaches the lib');
	for (const module of AFTER_PAINT) {
		assert.ok(!reached.has(module), `${module} loads with the page`);
	}
});

void test("the league's code loads with the league's reads", () => {
	const page = readFileSync(PAGE, 'utf8');
	assert.match(page, /import\('#lib\/run\/record-league\.ts'\)/u);
	assert.match(page, /import\('#lib\/league\/record-api\.ts'\)/u);
});
