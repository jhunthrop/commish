// The installable app: its manifest, its colours and the head tags every page carries. Run with
// `npm test`.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import { APP_COLORS, APP_ICONS, appHeadTags, webManifest } from './app-manifest.ts';

const TOKENS = readFileSync(new URL('../ui/tokens.css', import.meta.url), 'utf8');
const STATIC = new URL('../../../static/', import.meta.url);

/** A token's value in the block that starts at `selector`. */
function tokenIn(selector: string, token: string): string {
	const start = TOKENS.indexOf(selector);
	assert.notEqual(start, -1, `tokens.css has no ${selector} block`);
	const match = new RegExp(`--${token}:\\s*(#[0-9a-f]{6})`).exec(TOKENS.slice(start));
	assert.ok(match?.[1], `no --${token} after ${selector}`);
	return match[1];
}

void test('the colours are the tokens: the top bar for the chrome, the page for the splash', () => {
	assert.equal(APP_COLORS.light.chrome, tokenIn(':root {', 'shell'));
	assert.equal(APP_COLORS.light.page, tokenIn(':root {', 'bg'));
	assert.equal(APP_COLORS.dark.chrome, tokenIn(":root[data-theme='dark']", 'shell'));
	assert.equal(APP_COLORS.dark.page, tokenIn(":root[data-theme='dark']", 'bg'));
});

void test('the manifest opens standalone on the board, in the dark flagship, with icons that exist', () => {
	const manifest = webManifest();
	assert.equal(manifest.name, 'Commish');
	assert.equal(manifest.display, 'standalone');
	assert.equal(manifest.start_url, '/board');
	assert.equal(manifest.theme_color, APP_COLORS.dark.chrome);
	assert.equal(manifest.background_color, APP_COLORS.dark.page);
	assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable'));
	assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.purpose === 'any'));
	for (const icon of [...manifest.icons, APP_ICONS.appleTouch]) {
		assert.ok(existsSync(new URL(icon.src.slice(1), STATIC)), `${icon.src} is not in static/`);
	}
});

void test('every page links the manifest and colours the chrome for each theme', () => {
	const head = appHeadTags();
	assert.match(head, /<link rel="manifest" href="\/manifest\.webmanifest">/);
	assert.match(
		head,
		new RegExp(
			`<meta name="theme-color" media="\\(prefers-color-scheme: light\\)" content="${APP_COLORS.light.chrome}">`
		)
	);
	assert.match(
		head,
		new RegExp(
			`<meta name="theme-color" media="\\(prefers-color-scheme: dark\\)" content="${APP_COLORS.dark.chrome}">`
		)
	);
	assert.match(head, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png">/);
});
