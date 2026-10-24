// The mark, the whistle (Lane 170): one module holds the drawing, the favicon is its output, the
// component picks the weight by size, and the shell's way home draws it under its own name. Run with
// `npm test`.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Component } from 'svelte';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import {
	MARK_COLORS,
	MARK_PATH,
	MARK_SMALL_MAX,
	MARK_SMALL_STROKE,
	MARK_STROKE,
	MARK_VIEWBOX,
	faviconSvg,
	markStroke,
	markSvg
} from './mark.ts';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

/** Mark.svelte compiled for the server, its imports pointed at the files they name. */
async function markComponent(): Promise<Component<{ size: number }>> {
	const source = read('./Mark.svelte');
	const { js } = compile(source, { generate: 'server', filename: 'Mark.svelte' });
	const code = js.code.replace(/from '([^']+)'/g, (_, spec: string) => {
		const target = spec.startsWith('.')
			? new URL(spec, import.meta.url).href
			: import.meta.resolve(spec);
		return `from '${target}'`;
	});
	const mod = (await import(
		`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
	)) as { default: Component<{ size: number }> };
	return mod.default;
}

async function drawn(size: number): Promise<string> {
	const component = await markComponent();
	return render(component, { props: { size } }).body;
}

void test('the committed favicon is the generator output (node scripts/favicon.ts)', () => {
	assert.equal(read('../assets/favicon.svg'), faviconSvg());
});

void test('the favicon draws the small weight, light colours and a dark media block', () => {
	const svg = faviconSvg();
	assert.ok(svg.includes(`d="${MARK_PATH}"`));
	assert.ok(svg.includes(`stroke-width="${String(MARK_SMALL_STROKE)}"`));
	assert.ok(
		svg.includes(`.ink{stroke:${MARK_COLORS.light.ink}}.pea{fill:${MARK_COLORS.light.accent}}`)
	);
	assert.ok(
		svg.includes(
			`@media (prefers-color-scheme:dark){.ink{stroke:${MARK_COLORS.dark.ink}}.pea{fill:${MARK_COLORS.dark.accent}}}`
		)
	);
});

void test('40 px and under take the small weight, anything larger the mark weight', () => {
	assert.equal(markStroke(16), MARK_SMALL_STROKE);
	assert.equal(markStroke(MARK_SMALL_MAX), MARK_SMALL_STROKE);
	assert.equal(markStroke(MARK_SMALL_MAX + 1), MARK_STROKE);
	assert.equal(markStroke(512), MARK_STROKE);
	assert.throws(() => markStroke(0), /positive size/);
});

void test('markSvg draws the literal colours at the size it is given', () => {
	const svg = markSvg({ ...MARK_COLORS.dark, size: 192 });
	assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="192" height="192"/);
	assert.ok(svg.includes(`viewBox="${MARK_VIEWBOX}"`));
	assert.ok(svg.includes(`stroke="${MARK_COLORS.dark.ink}"`));
	assert.ok(svg.includes(`fill="${MARK_COLORS.dark.accent}"`));
	assert.ok(svg.includes(`stroke-width="${String(MARK_STROKE)}"`));
	assert.ok(markSvg({ ...MARK_COLORS.light, size: 512, stroke: 3 }).includes('stroke-width="3"'));
});

void test('Mark draws the path at the weight its size takes, coloured by the theme', async () => {
	const small = await drawn(36);
	assert.match(small, /<svg class="mark[^"]*" width="36" height="36"/);
	assert.ok(small.includes(`viewBox="${MARK_VIEWBOX}"`));
	assert.ok(small.includes('aria-hidden="true"'));
	assert.ok(small.includes(`d="${MARK_PATH}"`));
	assert.ok(small.includes(`stroke-width="${String(MARK_SMALL_STROKE)}"`));
	const large = await drawn(64);
	assert.ok(large.includes(`stroke-width="${String(MARK_STROKE)}"`));
	assert.ok(!large.includes('#'), 'the component takes its colours from the tokens');
	const styles = read('./Mark.svelte');
	assert.match(styles, /stroke: var\(--ink\)/);
	assert.match(styles, /fill: var\(--accent\)/);
});

void test("the shell's way home draws the mark under its name, in the rail and the phone bar", () => {
	const shell = read('./Shell.svelte');
	const snippet = /\{#snippet siteMark\([^)]*\)\}([\s\S]*?)\{\/snippet\}/.exec(shell)?.[1] ?? '';
	assert.match(
		snippet,
		/<a class=\{cls\} href=\{HOME_HREF\} aria-label="Commish"><Mark \{size\} \/><\/a>/
	);
	assert.ok(!shell.includes('<b>C</b>'));
	assert.match(shell, /\{@render siteMark\('mark', RAIL_MARK_SIZE\)\}/);
	assert.match(shell, /\{@render siteMark\('home', BAR_MARK_SIZE\)\}/);
});

/** Every source file under a directory, by path. */
function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return sources(full);
		return /\.(ts|svelte|svg|js)$/.test(entry.name) ? [full] : [];
	});
}

void test('no file but the module and its favicon carries the path', () => {
	const roots = ['../', '../../../scripts/'].map((path) => new URL(path, import.meta.url).pathname);
	const allowed = new Set(['ui/mark.ts', 'assets/favicon.svg']);
	/** The chamber's arc, the part of the path no other drawing would share by chance. */
	const arc = MARK_PATH.slice(MARK_PATH.indexOf(' A'));
	const carriers = roots
		.flatMap(sources)
		.filter((file) => readFileSync(file, 'utf8').includes(arc))
		.filter((file) => ![...allowed].some((end) => file.endsWith(end)));
	assert.deepEqual(carriers, []);
});
