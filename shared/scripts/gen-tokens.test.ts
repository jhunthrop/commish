// The token generator's one pure function, render(tokens): the web's CSS, the iOS enum and the Android
// object from one source (shared/design/tokens.json). Run with `node --test shared/scripts/*.test.ts`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render, type Tokens } from './gen-tokens.ts';

const TOKENS: Tokens = {
	color: {
		ink: { light: '#15120f', dark: '#f5f0ea' },
		paper: { light: '#ffffff', dark: '#ffffff' },
		ink3: { light: '#6b635c', dark: '#8f857c' },
		bg: { light: '#ffffff', dark: '#090807' },
		playedInk: { ref: 'ink3' },
		tier2: { mix: { of: 'ink', with: 'bg', percent: 76 } }
	},
	space: { s1: 4, s2: 8 },
	radius: { sm: 4, pill: 999 },
	type: { xs: 11, xxl: 44 },
	font: { ui: 'Outfit' }
};

/** The text with every run of whitespace one space, so a test reads a block on one line. */
const flat = (text: string): string => text.replace(/\s+/g, ' ');

void test('the CSS: light on :root, dark twice, so the OS setting and the toggle both win', () => {
	const css = flat(render(TOKENS).css);
	assert.match(css, /:root \{[^}]* --ink: #15120f;/);
	assert.ok(
		css.includes(
			"@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { --ink: #f5f0ea;"
		),
		css
	);
	assert.match(css, /:root\[data-theme='dark'\] \{[^}]* --ink: #f5f0ea;/);
});

void test('a colour the same in both themes is set once, on :root, and read the same in dark', () => {
	const { css, swift, kotlin } = render(TOKENS);
	assert.equal(css.match(/--paper:/g)?.length, 1);
	assert.match(swift, /static let paper = ThemedColor\(light: 0xFFFFFF, dark: 0xFFFFFF\)/);
	assert.match(kotlin, /val paper = ThemedColor\(0xFFFFFFFF, 0xFFFFFFFF\)/);
});

void test('a reference and a mix stay expressions in CSS and resolve per theme for the apps', () => {
	const { css, swift, kotlin } = render(TOKENS);
	assert.match(css, /--played-ink: var\(--ink-3\);/);
	assert.match(css, /--tier-2: color-mix\(in srgb, var\(--ink\) 76%, var\(--bg\)\);/);
	assert.match(swift, /static let playedInk = ThemedColor\(light: 0x6B635C, dark: 0x8F857C\)/);
	// 0x15*0.76 + 0xff*0.24 = 77.2, 0x12*0.76 + 0xff*0.24 = 74.9, 0x0f*0.76 + 0xff*0.24 = 72.6
	assert.match(swift, /static let tier2 = ThemedColor\(light: 0x4D4B49, dark: /);
	assert.match(kotlin, /val tier2 = ThemedColor\(0xFF4D4B49, /);
});

void test('the Swift: a namespaced enum with no UI import, the hex upper case', () => {
	const { swift } = render(TOKENS);
	assert.doesNotMatch(swift, /import SwiftUI/);
	assert.match(swift, /public struct ThemedColor: Sendable, Equatable \{/);
	assert.match(swift, /public static let ink = ThemedColor\(light: 0x15120F, dark: 0xF5F0EA\)/);
	assert.match(swift, /public enum Space \{[^}]*public static let s1: Double = 4/);
	assert.match(swift, /public enum Radius \{[^}]*public static let pill: Double = 999/);
	// Not `Type`: `Tokens.Type` is the metatype, so a nested enum by that name cannot be reached.
	assert.match(swift, /public enum TypeScale \{[^}]*public static let xxl: Double = 44/);
	assert.match(swift, /public enum Font \{[^}]*public static let ui = "Outfit"/);
});

void test('the Kotlin: one object in app.trycommish.design, colours as ARGB longs', () => {
	const { kotlin } = render(TOKENS);
	assert.match(kotlin, /^package app\.trycommish\.design$/m);
	assert.match(kotlin, /data class ThemedColor\(val light: Long, val dark: Long\)/);
	assert.match(kotlin, /object Color \{[^}]*val ink = ThemedColor\(0xFF15120F, 0xFFF5F0EA\)/);
	assert.match(kotlin, /object Space \{[^}]*const val s1: Double = 4\.0/);
	assert.match(kotlin, /object Type \{[^}]*const val xs: Double = 11\.0/);
	assert.match(kotlin, /object Font \{[^}]*const val ui = "Outfit"/);
});

void test('space, radius and type keep the web names, type in rem from its pixels', () => {
	const css = render(TOKENS).css;
	assert.match(css, /--s-1: 4px;/);
	assert.match(css, /--r-pill: 999px;/);
	assert.match(css, /--t-xs: 0\.6875rem; \/\* 11 \*\//);
	assert.match(css, /--t-2xl: 2\.75rem; \/\* 44 \*\//);
});

void test('a bad source fails with the token named', () => {
	assert.throws(
		() => render({ ...TOKENS, color: { ink: { light: '#15120', dark: '#000000' } } }),
		/color\.ink/
	);
	assert.throws(() => render({ ...TOKENS, color: { a: { ref: 'nowhere' } } }), /color\.a/);
	assert.throws(() => render({ ...TOKENS, notes: { 'color.ink': 'a */ b' } }), /color\.ink/);
	assert.throws(
		() => render({ ...TOKENS, color: { a: { ref: 'b' }, b: { ref: 'a' } } }),
		/color\.(a|b)/
	);
});
