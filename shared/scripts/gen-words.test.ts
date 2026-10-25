// The word tables' generator: a web word table into its JSON, the iOS `Words` enum and the Android
// `Words` object. Run with `node --test shared/scripts/*.test.ts`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OUTPUT, TABLES, gather, generate, renderWords, renderTable } from './gen-words.ts';

const TABLE = {
	week: 'Week',
	noMoves: 'No moves yet',
	f: (x: number): number => x
};

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

void test('a table gathered from a module: an object export spread, a string export under its key', () => {
	const module = {
		KINDS: { add: 'Free agent', trade: 'Trade' },
		DROP_WORD: 'Drop'
	};
	assert.deepEqual(gather(module, ['KINDS', ['drop', 'DROP_WORD']], 'm.ts'), {
		add: 'Free agent',
		trade: 'Trade',
		drop: 'Drop'
	});
});

void test('gathering fails on an export missing, a keyed export not a string and a key twice', () => {
	assert.throws(() => gather({}, ['BOX'], 'm.ts'), /m\.ts exports no BOX/);
	assert.throws(() => gather({ N: 3 }, [['n', 'N']], 'm.ts'), /m\.ts N is a number, not a string/);
	assert.throws(() => gather({ T: 'x' }, ['T'], 'm.ts'), /m\.ts T is a string, not a table/);
	assert.throws(
		() => gather({ A: { drop: 'Drop' }, D: 'Drop' }, ['A', ['drop', 'D']], 'm.ts'),
		/m\.ts gives drop twice/
	);
});

void test('several tables: each its own enum and object inside Words, in the order listed', () => {
	const { swift, kotlin } = renderWords([
		{ name: 'Box', table: { proj: 'Proj' } },
		{ name: 'Platform', table: { espn: 'ESPN' } }
	]);
	assert.match(
		swift,
		/public enum Box \{\s*public static let proj = "Proj"\s*\}\s*public enum Platform \{/
	);
	assert.match(kotlin, /object Box \{\s*const val proj = "Proj"\s*\}\s*object Platform \{/);
});

void test("the tables: the League home's, the box score's, then the shell's and the player shelf's, each with its own JSON", () => {
	assert.deepEqual(
		TABLES.map((t) => t.name),
		[
			'LeagueHome',
			'Box',
			'BoxFormat',
			'Basis',
			'BestLineupFrom',
			'Kickoff',
			'MoveKind',
			'Tiebreak',
			'WaiverOrder',
			'Platform',
			'Shell',
			'LeagueSwitch',
			'Scoring',
			'Shelf',
			'Card',
			'Lineup',
			'Against',
			'Move',
			'InSeason',
			'Designation',
			'DesignationRank',
			'Figure',
			'Matchup',
			'Board',
			'BoardFormat',
			'BoardBasis',
			'PageVerb',
			'Waivers',
			'WaiverHeads',
			'Stash',
			'Season',
			'Strip'
		]
	);
	assert.equal(new Set(TABLES.map((t) => t.json)).size, TABLES.length);
});

void test("the web's own words land in the JSON, the Swift and the Kotlin", async () => {
	const outputs = await generate();
	const json = (path: string): Record<string, unknown> =>
		JSON.parse(outputs.get(path) ?? '{}') as Record<string, unknown>;
	assert.equal(json('shared/words/league-box.json').totals, 'Team');
	assert.equal(json('shared/words/league-platform.json').mfl, 'MyFantasyLeague');
	assert.equal(json('shared/words/league-move-kind.json').drop, 'Drop');
	assert.equal(json('shared/words/league-basis.json').paceClauseShort, 'in-play players at pace');
	assert.equal(json('shared/words/shell.json').searchPlayers, 'Search players');
	assert.equal(json('shared/words/shell-league-switch.json').followFirst, 'Follow your league');
	assert.equal(json('shared/words/player-shelf.json').fullPage, 'Full page');
	assert.equal(json('shared/words/league-scoring.json').half_ppr, 'half PPR');
	assert.equal(
		json('shared/words/board.json').heldHead,
		'On a season-long list, his figures assume he plays'
	);
	assert.equal(json('shared/words/board-format.json').half, 'Half PPR');
	assert.equal(json('shared/words/page-verb.json').mock, 'Start a mock draft');
	assert.match(
		String(json('shared/words/board-basis.json').gap),
		/^Gap, drafters' ADP less our rank/
	);
	assert.equal(json('shared/words/player-card.json').none, '--');
	assert.equal(json('shared/words/league-waivers.json').noGain, 'No gain over your roster');
	assert.equal(json('shared/words/league-stash.json').backNow, 'Back this week');
	assert.deepEqual(json('shared/words/league-stash.json').functions, ['back', 'taken']);
	assert.equal(json('shared/words/league-waiver-heads.json').separator, ', ');
	assert.equal(json('shared/words/league-season.json').gainAWeek, 'Gain a week');
	const swift = outputs.get(OUTPUT.swift) ?? '';
	const kotlin = outputs.get(OUTPUT.kotlin) ?? '';
	assert.match(
		swift,
		/public enum Tiebreak \{[^}]*public static let head_to_head = "head to head"/
	);
	assert.match(kotlin, /object Kickoff \{[^}]*const val decided = "Decided"/);
});
