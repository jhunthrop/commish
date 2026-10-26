// The app's sign-in landing (Lane 172): the API sends an app's sign-in here with its pairing code in
// the query. The app takes the link and the page is never seen; when it shows, it says what to do and
// never prints the code. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { compiled } from '#lib/testing/svelte-ssr.ts';
import { APP_SIGNED_IN_PATH, NO_APP, OPEN_APP } from '#lib/site/app-words.ts';

const CODE = 'abc';
const PAGE = new URL('./+page.svelte', import.meta.url);

async function page(): Promise<string> {
	const mod = (await import(compiled(PAGE))) as { default: Component<{ data: { head: string } }> };
	return render(mod.default, { props: { data: { head: '' } } }).body;
}

void test('the page says Open Commish and what to do when the app did not open', async () => {
	const html = await page();
	assert.ok(html.includes(OPEN_APP));
	assert.ok(html.includes(NO_APP));
});

void test(`the page never prints the code it is opened with (${APP_SIGNED_IN_PATH}?code=${CODE})`, async () => {
	const html = await page();
	assert.ok(!html.includes(CODE), 'the code is in the HTML');
	// Prerendered: one HTML for every query, built before any code exists. Nothing on the page reads
	// the address, so no code can reach it at any time.
	const route = ['./+page.svelte', './+page.ts', './+page.server.ts']
		.map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'))
		.join('\n');
	assert.doesNotMatch(route, /\$app\/(state|stores)|\burl\b|searchParams|location/);
	assert.match(route, /export const prerender = true/);
	assert.match(route, /export const csr = false/);
});

void test('the page, opened with a code, sends no referrer and is never stored', () => {
	const headers = readFileSync(new URL('../../../../_headers', import.meta.url), 'utf8');
	for (const path of [APP_SIGNED_IN_PATH, `${APP_SIGNED_IN_PATH}/*`]) {
		const rule = headers.split(/\n(?=\S)/).find((block) => block.split('\n')[0] === path);
		assert.ok(rule, `no _headers rule for ${path}`);
		assert.match(rule, /^ {2}Referrer-Policy: no-referrer$/m);
		assert.match(rule, /^ {2}! Cache-Control$/m);
		assert.match(rule, /^ {2}Cache-Control: no-store$/m);
	}
});
