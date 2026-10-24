// The word tables' generator: a web word table into its JSON, the iOS `Words` enum and the Android
// `Words` object. Run with `node --test shared/scripts/*.test.ts`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderWords, renderTable } from './gen-words.ts';

const TABLE = { week: 'Week', noMoves: 'No moves yet', f: (x: number): number => x };

void test('the JSON: every string as is, every function named under functions', () => {
	assert.deepEqual(JSON.parse(renderTable(TABLE, 'Tiny').json), {
		week: 'Week',
		noMoves: 'No moves yet',
		functions: ['f']
	});
});

void test('the Swift and Kotlin: one constant per string, inside the table named for its screen', () => {
	const { swift, kotlin } = renderWords([{ name: 'LeagueHome', table: TABLE }]);
	assert.match(swift, /public enum Words \{\s*public enum LeagueHome \{/);
	assert.match(swift, /public static let noMoves = "No moves yet"/);
	assert.doesNotMatch(swift, /\bf\b =/);
	assert.match(kotlin, /^package app\.trycommish\.design$/m);
	assert.match(kotlin, /object Words \{\s*object LeagueHome \{/);
	assert.match(kotlin, /const val noMoves = "No moves yet"/);
});

void test('a quote, a backslash, a newline and a dollar are escaped in both languages', () => {
	const { swift, kotlin } = renderWords([
		{ name: 'Odd', table: { said: 'He said "go"\nthen $5 \\ more' } }
	]);
	assert.ok(
		swift.includes('public static let said = "He said \\"go\\"\\nthen $5 \\\\ more"'),
		swift
	);
	assert.ok(kotlin.includes('const val said = "He said \\"go\\"\\nthen \\$5 \\\\ more"'), kotlin);
});

void test("a key that is the language's keyword is quoted the language's way", () => {
	const { swift, kotlin } = renderWords([
		{ name: 'K', table: { when: 'When', default: 'Default' } }
	]);
	assert.match(kotlin, /const val `when` = "When"/);
	assert.match(swift, /public static let `default` = "Default"/);
});

void test('a member that is neither a string nor a function fails with its key named', () => {
	assert.throws(() => renderTable({ n: 3 }, 'Bad'), /Bad\.n/);
});
