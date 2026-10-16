// The licence minimum on the player page: one line, the words the licences ask for, nowhere else.
// Run with `npm test`.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { CREDIT, CREDIT_LICENCE_HREF, creditSentence } from './credit.ts';

const WEB = fileURLToPath(new URL('../../../', import.meta.url));
const PLAYER_PAGE = 'src/routes/(run)/players/[slug]/+page.svelte';

function filesUnder(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? filesUnder(path) : [path];
	});
}

void test('the credit is the approved sentence, word for word', () => {
	assert.equal(
		creditSentence(),
		'Stats from nflverse and charting from FTN Data via nflverse, both under Creative Commons licences, our rates worked out from their counts.'
	);
});

void test('the licence words link the stricter licence, CC BY-SA 4.0', () => {
	assert.equal(CREDIT.licenceWords, 'Creative Commons licences');
	assert.equal(CREDIT_LICENCE_HREF, 'https://creativecommons.org/licenses/by-sa/4.0/');
});

void test('the credit names no other feed and breaks no copy rule', () => {
	const sentence = creditSentence();
	for (const other of [
		'Next Gen',
		'Pro Football',
		'PFR',
		'Tank01',
		'Odds',
		'Calculator',
		'nfelo'
	]) {
		assert.ok(!sentence.includes(other), other);
	}
	assert.ok(!/[—–;]/.test(sentence));
});

void test('the player page prints the credit once, and no other file does', () => {
	const page = readFileSync(join(WEB, PLAYER_PAGE), 'utf8');
	assert.equal(page.match(/<Credit\b/g)?.length, 1);
	const users = filesUnder(join(WEB, 'src'))
		.filter((file) => /\.(svelte|ts)$/.test(file) && !file.endsWith('.test.ts'))
		.filter((file) => !file.endsWith('/credit.ts') && !file.endsWith('/Credit.svelte'))
		.filter((file) => /site\/credit|\/Credit\.svelte|\.\/credit/.test(readFileSync(file, 'utf8')))
		.map((file) => file.replace(WEB, ''));
	assert.deepEqual(users, [PLAYER_PAGE]);
});

void test('there is no /data page any more, while the data files stay', () => {
	assert.equal(existsSync(join(WEB, 'src/routes/data/+page.svelte')), false);
	assert.equal(existsSync(join(WEB, 'src/routes/data/+page.server.ts')), false);
	const built = join(WEB, '.svelte-kit/cloudflare');
	if (!existsSync(built)) return;
	assert.equal(existsSync(join(built, 'data.html')), false);
	assert.equal(existsSync(join(built, 'data/run.txt')), true);
});
