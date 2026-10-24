/** The design tokens' generator: shared/design/tokens.json, the one source of colours in both themes,
 * spacing, radii, the type scale and the faces, into the web's CSS custom properties, the iOS
 * `Tokens` enum and the Android `Tokens` object. The files it writes are committed, and check-gen.ts
 * holds them to the source.
 *
 *   node shared/scripts/gen-tokens.ts
 *
 * A colour is a pair of hex values (light, dark), a reference to another colour (`ref`), or a mix of
 * two in sRGB (`mix`, the web's `color-mix`). The CSS keeps references and mixes as expressions, so a
 * theme's redefinition flows through them as it always has; the apps get each resolved per theme. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPOSITORY, generatedBy, stringLiteral, writeOutputs, type Outputs } from './generated.ts';

export interface PairColor {
	light: string;
	dark: string;
}
export interface RefColor {
	ref: string;
}
export interface MixColor {
	/** `percent` of `of`, the rest `with`, in sRGB. */
	mix: { of: string; with: string; percent: number };
}
export type ColorToken = PairColor | RefColor | MixColor;

export interface Tokens {
	color: Readonly<Record<string, ColorToken>>;
	space: Readonly<Record<string, number>>;
	radius: Readonly<Record<string, number>>;
	/** Type sizes in pixels. */
	type: Readonly<Record<string, number>>;
	font: Readonly<Record<string, string>>;
	/** A token's note by `group.name` (`color.accent`), carried as a comment into each output. */
	notes?: Readonly<Record<string, string>>;
}

export interface Rendered {
	css: string;
	swift: string;
	kotlin: string;
}

type Theme = 'light' | 'dark';
const THEMES: readonly Theme[] = ['light', 'dark'];

export const SOURCE = 'shared/design/tokens.json';
const SCRIPT = 'shared/scripts/gen-tokens.ts';
export const OUTPUT = {
	css: 'web/src/lib/ui/tokens.generated.css',
	swift: 'apps/ios/Packages/CommishDesign/Sources/CommishDesign/Tokens.generated.swift',
	kotlin: 'apps/android/design/src/main/kotlin/app/trycommish/design/Tokens.kt'
} as const;

/** The CSS a rem is, in pixels. */
const REM_PX = 16;
const HEX = /^#[0-9a-f]{6}$/;
const CHANNEL_MAX = 255;
const PERCENT = 100;
/** A type key the web names by its step (`--t-2xl`), not its letters. */
const TYPE_CSS_NAMES: Readonly<Record<string, string>> = { xxl: '2xl', xxxl: '3xl' };
/** The type scale's enum in Swift. A nested type named `Type` compiles but no member access reaches
 * it: `Tokens.Type` is always the metatype of `Tokens`, so `Tokens.Type.xs` fails to type-check. */
export const SWIFT_TYPE_ENUM = 'TypeScale';

/** `inkStrong2` as the web names it: `ink-strong-2`. */
export function kebab(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/([a-zA-Z])(\d)/g, '$1-$2')
		.toLowerCase();
}

function isPair(token: ColorToken): token is PairColor {
	return 'light' in token;
}
function isRef(token: ColorToken): token is RefColor {
	return 'ref' in token;
}

/** Every colour as hex in each theme, references and mixes resolved, or an error naming the token. */
function resolveColors(colors: Tokens['color']): Map<string, Record<Theme, string>> {
	const resolved = new Map<string, Record<Theme, string>>();
	const resolving = new Set<string>();
	const resolve = (name: string, from: string): Record<Theme, string> => {
		const done = resolved.get(name);
		if (done) return done;
		const token = colors[name];
		if (token === undefined)
			throw new Error(`color.${from} names color.${name}, which is not a token.`);
		if (resolving.has(name)) throw new Error(`color.${name} refers back to itself.`);
		resolving.add(name);
		const value = colorValue(name, token, (other) => resolve(other, name));
		resolving.delete(name);
		resolved.set(name, value);
		return value;
	};
	for (const name of Object.keys(colors)) resolve(name, name);
	return resolved;
}

function colorValue(
	name: string,
	token: ColorToken,
	resolve: (other: string) => Record<Theme, string>
): Record<Theme, string> {
	if (isPair(token)) {
		for (const theme of THEMES) {
			if (!HEX.test(token[theme]))
				throw new Error(`color.${name}.${theme} "${token[theme]}" is not a lower-case #rrggbb.`);
		}
		return { light: token.light, dark: token.dark };
	}
	if (isRef(token)) return resolve(token.ref);
	const { of, with: other, percent } = token.mix;
	if (!(percent > 0 && percent < PERCENT))
		throw new Error(`color.${name}'s mix ${String(percent)}% is not between 0 and 100.`);
	const a = resolve(of);
	const b = resolve(other);
	return { light: mix(a.light, b.light, percent), dark: mix(a.dark, b.dark, percent) };
}

/** `percent` of `a` and the rest of `b`, channel by channel in sRGB, rounded. */
function mix(a: string, b: string, percent: number): string {
	const share = percent / PERCENT;
	const channel = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
	const channels = [0, 1, 2].map((i) =>
		Math.min(CHANNEL_MAX, Math.round(channel(a, i) * share + channel(b, i) * (1 - share)))
	);
	return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function cssColor(token: ColorToken, theme: Theme): string {
	if (isPair(token)) return token[theme];
	if (isRef(token)) return `var(--${kebab(token.ref)})`;
	const { of, with: other, percent } = token.mix;
	return `color-mix(in srgb, var(--${kebab(of)}) ${String(percent)}%, var(--${kebab(other)}))`;
}

/** A note as a comment on the line above its declaration, so a long one never wraps the value. */
function cssNoteAbove(note: string | undefined): string[] {
	return note === undefined ? [] : [`/* ${note} */`];
}

function renderCss(tokens: Tokens): string {
	const notes = tokens.notes ?? {};
	const colors = Object.entries(tokens.color);
	const light = [
		...Object.entries(tokens.type).map(
			([name, px]) =>
				`--t-${TYPE_CSS_NAMES[name] ?? name}: ${String(px / REM_PX)}rem; /* ${String(px)}${notes[`type.${name}`] === undefined ? '' : ` ${notes[`type.${name}`] ?? ''}`} */`
		),
		...Object.entries(tokens.space).map(([name, px]) => `--${kebab(name)}: ${String(px)}px;`),
		...Object.entries(tokens.radius).map(([name, px]) => `--r-${kebab(name)}: ${String(px)}px;`),
		...colors.flatMap(([name, token]) => [
			...cssNoteAbove(notes[`color.${name}`]),
			`--${kebab(name)}: ${cssColor(token, 'light')};`
		])
	];
	// Dark redefines only the pairs that differ: a reference or a mix follows its parts by itself.
	const dark = colors.flatMap(([name, token]) =>
		isPair(token) && token.dark !== token.light ? [`--${kebab(name)}: ${token.dark};`] : []
	);
	const block = (lines: readonly string[], indent: string): string =>
		lines.map((line) => `${indent}${line}`).join('\n');
	return `/* ${generatedBy(SCRIPT, SOURCE)}
   Light values live on bare :root. Dark redefines tokens only, twice, so the OS setting and the
   explicit data-theme toggle both win. tokens.css imports this file and keeps the layout tokens. */

:root {
${block(light, '\t')}
}

@media (prefers-color-scheme: dark) {
	:root:not([data-theme='light']) {
${block(dark, '\t\t')}
	}
}

:root[data-theme='dark'] {
${block(dark, '\t')}
}
`;
}

function hexDigits(hex: string): string {
	return hex.slice(1).toUpperCase();
}

/** A number as Swift and Kotlin read a Double: `4` in Swift, `4.0` in Kotlin. */
function swiftNumber(value: number): string {
	return String(value);
}
function kotlinNumber(value: number): string {
	return Number.isInteger(value) ? `${String(value)}.0` : String(value);
}

function swiftDoc(note: string | undefined, indent: string): string {
	return note === undefined ? '' : `${indent}/// ${note}\n`;
}

function renderSwift(tokens: Tokens, colors: Map<string, Record<Theme, string>>): string {
	const notes = tokens.notes ?? {};
	const numbers = (group: 'space' | 'radius' | 'type'): string =>
		Object.entries(tokens[group])
			.map(
				([name, value]) =>
					`${swiftDoc(notes[`${group}.${name}`], '        ')}        public static let ${name}: Double = ${swiftNumber(value)}`
			)
			.join('\n');
	const enumOf = (name: string, body: string): string =>
		`    public enum ${name} {\n${body}\n    }`;
	const colorLines = [...colors]
		.map(
			([name, value]) =>
				`${swiftDoc(notes[`color.${name}`], '        ')}        public static let ${name} = ThemedColor(light: 0x${hexDigits(value.light)}, dark: 0x${hexDigits(value.dark)})`
		)
		.join('\n');
	const fontLines = Object.entries(tokens.font)
		.map(([name, face]) => `        public static let ${name} = ${stringLiteral(face, 'swift')}`)
		.join('\n');
	return `// ${generatedBy(SCRIPT, SOURCE)}
// swiftlint:disable all

/// A colour in each theme as 0xRRGGBB: the light value and the dark one.
public struct ThemedColor: Sendable, Equatable {
    public let light: UInt32
    public let dark: UInt32

    public init(light: UInt32, dark: UInt32) {
        self.light = light
        self.dark = dark
    }
}

/// The design tokens: colours in both themes, spacing, radii and type sizes in points, the faces.
public enum Tokens {
${[
	enumOf('Color', colorLines),
	enumOf('Space', numbers('space')),
	enumOf('Radius', numbers('radius')),
	enumOf(SWIFT_TYPE_ENUM, numbers('type')),
	enumOf('Font', fontLines)
].join('\n\n')}
}
`;
}

function kotlinDoc(note: string | undefined, indent: string): string {
	return note === undefined ? '' : `${indent}/** ${note} */\n`;
}

function renderKotlin(tokens: Tokens, colors: Map<string, Record<Theme, string>>): string {
	const notes = tokens.notes ?? {};
	const numbers = (group: 'space' | 'radius' | 'type'): string =>
		Object.entries(tokens[group])
			.map(
				([name, value]) =>
					`${kotlinDoc(notes[`${group}.${name}`], '        ')}        const val ${name}: Double = ${kotlinNumber(value)}`
			)
			.join('\n');
	const objectOf = (name: string, body: string): string => `    object ${name} {\n${body}\n    }`;
	const colorLines = [...colors]
		.map(
			([name, value]) =>
				`${kotlinDoc(notes[`color.${name}`], '        ')}        val ${name} = ThemedColor(0xFF${hexDigits(value.light)}, 0xFF${hexDigits(value.dark)})`
		)
		.join('\n');
	const fontLines = Object.entries(tokens.font)
		.map(([name, face]) => `        const val ${name} = ${stringLiteral(face, 'kotlin')}`)
		.join('\n');
	return `// ${generatedBy(SCRIPT, SOURCE)}
@file:Suppress("ktlint", "MagicNumber")

package app.trycommish.design

/** A colour in each theme as 0xAARRGGBB: the light value and the dark one. */
data class ThemedColor(val light: Long, val dark: Long)

/** The design tokens: colours in both themes, spacing, radii and type sizes in dp and sp, the faces. */
object Tokens {
${[
	objectOf('Color', colorLines),
	objectOf('Space', numbers('space')),
	objectOf('Radius', numbers('radius')),
	objectOf('Type', numbers('type')),
	objectOf('Font', fontLines)
].join('\n\n')}
}
`;
}

/** The three files from the tokens, or an error naming the token that is wrong. */
export function render(tokens: Tokens): Rendered {
	for (const [key, note] of Object.entries(tokens.notes ?? {})) {
		if (note.includes('*/'))
			throw new Error(`notes.${key} would close the comment it is carried in.`);
	}
	const colors = resolveColors(tokens.color);
	return {
		css: renderCss(tokens),
		swift: renderSwift(tokens, colors),
		kotlin: renderKotlin(tokens, colors)
	};
}

export async function readTokens(root: string = REPOSITORY): Promise<Tokens> {
	return JSON.parse(await readFile(join(root, SOURCE), 'utf8')) as Tokens;
}

export async function generate(): Promise<Outputs> {
	const { css, swift, kotlin } = render(await readTokens());
	return new Map([
		[OUTPUT.css, css],
		[OUTPUT.swift, swift],
		[OUTPUT.kotlin, kotlin]
	]);
}

if (import.meta.main) await writeOutputs(await generate());
