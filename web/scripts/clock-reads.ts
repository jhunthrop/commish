// How many times a source file reads the wall clock (Lane 77, review 77 findings 4 and 5), counted
// on tokens, never on text: a comment or a string that names a read is not one, and spacing inside
// a call cannot hide one. A read is `Date.now()`, `new Date()`, a bare `Date()` call and any
// `Temporal.Now`; `new Date(at)` and `performance.now()` are not (the one draws a given instant, the
// other measures a span). A Svelte file is read as its scripts, then its markup's `{...}` expressions.
import ts from 'typescript';

/** The tokens of a script, trivia (comments and whitespace) skipped, its template literals and
 * regular expressions read as one token each. */
export function scriptTokens(code: string): string[] {
	const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, code);
	const tokens: string[] = [];
	// What each open `{` was: a block or object, or a template literal's `${`.
	const braces: ('brace' | 'template')[] = [];
	let kind = scanner.scan();
	while (kind !== ts.SyntaxKind.EndOfFileToken) {
		if (kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) {
			if (startsExpression(tokens.at(-1))) kind = scanner.reScanSlashToken();
		}
		if (kind === ts.SyntaxKind.CloseBraceToken && braces.pop() === 'template') {
			kind = scanner.reScanTemplateToken(false);
		}
		if (kind === ts.SyntaxKind.OpenBraceToken) braces.push('brace');
		if (kind === ts.SyntaxKind.TemplateHead || kind === ts.SyntaxKind.TemplateMiddle) {
			braces.push('template');
		}
		tokens.push(scanner.getTokenText());
		kind = scanner.scan();
	}
	return tokens;
}

/** Whether a `/` after this token opens a regular expression rather than dividing. */
function startsExpression(previous: string | undefined): boolean {
	if (previous === undefined) return true;
	if (
		/^[\w$]/.test(previous) &&
		!/^(?:return|typeof|case|do|else|in|of|void|yield|await)$/.test(previous)
	)
		return false;
	return !/^[)\]}'"`]/.test(previous);
}

/** The reads among a script's tokens. */
export function tokenReads(tokens: readonly string[]): number {
	let reads = 0;
	tokens.forEach((token, i) => {
		const next = (n: number): string | undefined => tokens[i + n];
		if (token === 'Temporal' && next(1) === '.' && next(2) === 'Now') reads += 1;
		if (token !== 'Date') return;
		if (next(1) === '.' && next(2) === 'now' && next(3) === '(' && next(4) === ')') reads += 1;
		// `new Date()` and a bare `Date()`, but not a member `x.Date()`.
		if (next(1) === '(' && next(2) === ')' && tokens[i - 1] !== '.') reads += 1;
	});
	return reads;
}

const SCRIPT = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
const STYLE = /<style\b[^>]*>[\s\S]*?<\/style>/g;
const MARKUP_COMMENT = /<!--[\s\S]*?-->/g;

/** A Svelte markup's `{...}` expressions, outermost braces matched. */
function markupExpressions(markup: string): string[] {
	const found: string[] = [];
	let depth = 0;
	let start = 0;
	// By UTF-16 index, the unit slice() counts in: a brace is one unit whatever the text around it.
	for (let i = 0; i < markup.length; i += 1) {
		const char = markup[i];
		if (char === '{') {
			if (depth === 0) start = i + 1;
			depth += 1;
		} else if (char === '}' && depth > 0) {
			depth -= 1;
			if (depth === 0) found.push(markup.slice(start, i));
		}
	}
	return found;
}

/** How many times a file reads the clock, by its extension. */
export function clockReads(file: string, text: string): number {
	if (!file.endsWith('.svelte')) return tokenReads(scriptTokens(text));
	const scripts = [...text.matchAll(SCRIPT)].map((match) => match[1] ?? '');
	const markup = text.replace(SCRIPT, ' ').replace(STYLE, ' ').replace(MARKUP_COMMENT, ' ');
	return [...scripts, ...markupExpressions(markup)].reduce(
		(sum, code) => sum + tokenReads(scriptTokens(code)),
		0
	);
}
