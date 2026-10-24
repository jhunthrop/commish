// The tokens moved to one source (shared/design/tokens.json, Lane 171) and the web reads them from the
// generated tokens.generated.css that tokens.css imports. This holds the move to a page that renders
// exactly as before: every token the old tokens.css declared (tokens.before.css.txt, the file as it
// stood on main before the move) has the same value in each theme and in each of the two dark blocks,
// and every colour now comes from the generated file. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (name: string): string =>
	readFileSync(new URL(`./${name}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const BEFORE = read('tokens.before.css.txt');
const GENERATED = read('tokens.generated.css');
const TOKENS = read('tokens.css');

const ROOT = ':root {';
const DARK_MEDIA = "@media (prefers-color-scheme: dark) {\n\t:root:not([data-theme='light']) {";
const DARK_TOGGLE = ":root[data-theme='dark'] {";
const PRINT = '@media print {';
const HEX = /^#[0-9a-f]{6}$/;

/** The text inside the braces that open at the end of `selector`, or '' when the CSS has no block. */
function block(css: string, selector: string): string {
	const start = css.indexOf(selector);
	if (start < 0) return '';
	let depth = 0;
	const open = start + selector.length - 1;
	for (let i = open; i < css.length; i++) {
		if (css[i] === '{') depth++;
		else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
	}
	throw new Error(`${selector} never closes`);
}

/** A block's custom properties, each value with its whitespace folded. */
function declarations(text: string): Map<string, string> {
	return new Map(
		[...text.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [
			m[1] ?? '',
			(m[2] ?? '').replace(/\s+/g, ' ').trim()
		])
	);
}

/** The custom properties of `selector` across the files, in the order the page loads them. */
function merged(files: readonly string[], selector: string): Map<string, string> {
	return new Map(files.flatMap((css) => [...declarations(block(css, selector))]));
}

/** Each theme's value of every token: light on :root, dark the root's with a dark block over it. */
function themes(
	files: readonly string[],
	dark: string
): { light: Map<string, string>; dark: Map<string, string> } {
	const light = merged(files, ROOT);
	return { light, dark: new Map([...light, ...merged(files, dark)]) };
}

const AFTER = [GENERATED, TOKENS];

void test('tokens.css imports the generated tokens first, so its own blocks still win where they set', () => {
	assert.match(TOKENS.trimStart(), /^@import '\.\/tokens\.generated\.css';/);
});

for (const [label, dark] of [
	['the OS setting', DARK_MEDIA],
	['the toggle', DARK_TOGGLE]
] as const) {
	void test(`every token keeps its value in both themes, dark by ${label}`, () => {
		const before = themes([BEFORE], dark);
		const after = themes(AFTER, dark);
		assert.ok(before.light.size > 80, `read ${String(before.light.size)} tokens from the old file`);
		for (const theme of ['light', 'dark'] as const) {
			for (const [name, value] of before[theme]) {
				assert.equal(after[theme].get(name), value, `--${name} in ${theme}`);
			}
			assert.deepEqual([...after[theme].keys()].sort(), [...before[theme].keys()].sort(), theme);
		}
	});
}

void test('every colour the old file carried now comes from the generated file, in both themes', () => {
	const before = themes([BEFORE], DARK_TOGGLE);
	const generated = themes([GENERATED], DARK_TOGGLE);
	const own = declarations(block(TOKENS, ROOT));
	const literal = [...before.light].filter(
		([, value]) => HEX.test(value) || value.startsWith('color-mix(')
	);
	const named = new Set(literal.map(([name]) => name));
	// A colour that names another colour (`--played-ink: var(--ink-3)`) is a colour too.
	const references = [...before.light].filter(([, value]) =>
		named.has(/^var\(--([a-z0-9-]+)\)$/.exec(value)?.[1] ?? '')
	);
	const colours = [...literal, ...references];
	assert.ok(colours.length > 50, `found ${String(colours.length)} colours`);
	for (const [name] of colours) {
		assert.equal(generated.light.get(name), before.light.get(name), `--${name} light`);
		assert.equal(generated.dark.get(name), before.dark.get(name), `--${name} dark`);
		assert.ok(!own.has(name), `--${name} is set in tokens.css as well as the generated file`);
	}
});

void test('the print block is unchanged', () => {
	assert.deepEqual(declarations(block(TOKENS, PRINT)), declarations(block(BEFORE, PRINT)));
});
