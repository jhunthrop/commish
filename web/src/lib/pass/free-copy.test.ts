// The free season's copy guard (Lane 150, the launch audit's B2): no site file names a paid product or
// a figure set for one, but the account's plan card for a plan an account already holds. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const WEB = fileURLToPath(new URL('../../../', import.meta.url));

/** A paid product by name, or one of the 2027 figures (a waiver budget's dollars are the league's). */
const PAID = /\bDraft Pass\b|\bMembership\b|\$(?:39|99|14\.99|29)\b/u;

/** The one file kept: the plan card says the plan /me reports an account holds (a grant, or a plan
 * bought before the free season), and the free season's card covers every other account. The
 * generated contract carries the API's own descriptions. */
const KEPT = new Set(['src/lib/account/words.ts', 'src/lib/api/types.ts']);

function filesUnder(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? filesUnder(path) : [path];
	});
}

void test('no site file names a paid product or its figure, the held plan card aside', () => {
	const hits = filesUnder(join(WEB, 'src'))
		.filter((file) => /\.(svelte|ts|json)$/u.test(file) && !file.endsWith('.test.ts'))
		.map((file) => file.replace(WEB, ''))
		.filter((file) => !KEPT.has(file))
		.flatMap((file) =>
			readFileSync(join(WEB, file), 'utf8')
				.split('\n')
				.flatMap((text, i) => (PAID.test(text) ? [`${file}:${String(i + 1)}: ${text.trim()}`] : []))
		);
	assert.deepEqual(hits, []);
});
