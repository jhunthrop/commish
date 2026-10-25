/** The word tables' generator: the web's word tables, which every screen's words live in, into JSON
 * under shared/words and the apps' `Words` enum (iOS) and object (Android), so the apps print the
 * web's words. A function-valued member builds its words from data and cannot be copied: the JSON
 * names it under `functions`, so an app knows to port it, and the apps get no constant for it.
 *
 *   node shared/scripts/gen-words.ts
 *
 * The web's modules are imported as they are (Node strips their types). */
import { REPOSITORY, generatedBy, stringLiteral, writeOutputs, type Outputs } from './generated.ts';
import { join } from 'node:path';

/** A word table as the web exports it: strings, and functions that build words. */
export type WordTable = Readonly<Record<string, unknown>>;

export interface NamedTable {
	/** The table's name, the enum and object the apps read it from (`LeagueHome`, `Box`). */
	name: string;
	table: WordTable;
}

/** What a table takes from its module: an exported table whole (`'BOX'`), or one exported string
 * under the key the apps read it by (`['drop', 'DROP_WORD']`), for words the web keeps beside its
 * functions rather than in a table. */
export type Pick = string | readonly [key: string, exportName: string];

/** One table the generator writes: its module, what it takes from it and the JSON it writes. */
interface TableSource {
	name: string;
	module: string;
	picks: readonly Pick[];
	json: string;
}

const SCRIPT = 'shared/scripts/gen-words.ts';
const HOME_MODULE = 'web/src/lib/league/home/home.ts';
const BOX_MODULE = 'web/src/lib/league/box/box.ts';
const BASIS_MODULE = 'web/src/lib/league/box/basis.ts';
const LINEUP_MODULE = 'web/src/lib/league/box/lineup.ts';
const DESIGNATION_MODULE = 'web/src/lib/format/designation.ts';
const WAIVERS_MODULE = 'web/src/lib/league/box/waivers.ts';

/** Every table the apps print from, the League home's first, then the box score's: its heads, the
 * scoring formats, the basis sentences' parts, the game heads, the moves' kinds, the standings'
 * tiebreak and waiver order, the platforms' names; then the Start screen's (Lane 180): the lineup's
 * strip and verb, the positions an opponent's rank is against, the move's confirmation, the in-season
 * screens' lines, a status in words and in a rank's few characters, and the figures' heads; then the
 * Matchup's (Lane 183): the words beside its box scores; then the Waivers' (Lane 186): its table, strip
 * and drop panel, the heads' basis, the Stash group, the season figures' heads and the strip's mark. */
export const TABLES: readonly TableSource[] = [
	{
		name: 'LeagueHome',
		module: HOME_MODULE,
		picks: ['HOME'],
		json: 'shared/words/league-home.json'
	},
	{ name: 'Box', module: BOX_MODULE, picks: ['BOX'], json: 'shared/words/league-box.json' },
	{
		name: 'BoxFormat',
		module: BOX_MODULE,
		picks: ['FORMAT_WORDS'],
		json: 'shared/words/league-box-format.json'
	},
	{
		name: 'Basis',
		module: BASIS_MODULE,
		picks: [
			['asOfKickoff', 'AS_OF_KICKOFF'],
			['projFinalPart', 'PROJ_FINAL_PART'],
			['noProjFinalPart', 'NO_PROJ_FINAL_PART'],
			['paceClause', 'PACE_CLAUSE'],
			['paceClauseShort', 'PACE_CLAUSE_SHORT'],
			['oppPart', 'OPP_PART'],
			['rankOppPart', 'RANK_OPP_PART'],
			['rankPart', 'RANK_PART'],
			['pickPart', 'PICK_PART'],
			['rankOppPhone', 'RANK_OPP_PHONE'],
			['oppPhone', 'OPP_PHONE'],
			['statsByWednesday', 'STATS_BY_WEDNESDAY'],
			['kickedOffPart', 'KICKED_OFF_PART'],
			['forRostered', 'FOR_ROSTERED']
		],
		json: 'shared/words/league-basis.json'
	},
	{
		name: 'BestLineupFrom',
		module: BASIS_MODULE,
		picks: ['BEST_LINEUP_FROM'],
		json: 'shared/words/league-best-lineup-from.json'
	},
	{
		name: 'Kickoff',
		module: 'web/src/lib/league/box/kickoff.ts',
		picks: ['KICKOFF'],
		json: 'shared/words/league-kickoff.json'
	},
	{
		name: 'MoveKind',
		module: HOME_MODULE,
		picks: ['KIND_WORDS', ['drop', 'DROP_WORD']],
		json: 'shared/words/league-move-kind.json'
	},
	{
		name: 'Tiebreak',
		module: HOME_MODULE,
		picks: ['TIEBREAK_WORDS'],
		json: 'shared/words/league-tiebreak.json'
	},
	{
		name: 'WaiverOrder',
		module: HOME_MODULE,
		picks: ['WAIVER_ORDER_WORDS'],
		json: 'shared/words/league-waiver-order.json'
	},
	{
		name: 'Platform',
		module: 'web/src/lib/league/names.ts',
		picks: ['HOST_WORDS'],
		json: 'shared/words/league-platform.json'
	},
	{
		name: 'Shell',
		module: 'web/src/lib/ui/shell-words.ts',
		picks: ['SHELL'],
		json: 'shared/words/shell.json'
	},
	{
		name: 'LeagueSwitch',
		module: 'web/src/lib/context/menu-words.ts',
		picks: [
			['followFirst', 'FOLLOW_FIRST'],
			['tePremium', 'TE_PREMIUM_WORDS']
		],
		json: 'shared/words/shell-league-switch.json'
	},
	{
		name: 'Scoring',
		module: 'web/src/lib/league/names.ts',
		picks: ['SCORING_WORDS'],
		json: 'shared/words/league-scoring.json'
	},
	{
		name: 'Shelf',
		module: 'web/src/lib/player/shelf.ts',
		picks: ['SHELF'],
		json: 'shared/words/player-shelf.json'
	},
	{
		name: 'Card',
		module: 'web/src/lib/player/card.ts',
		picks: ['CARD', ['none', 'NONE']],
		json: 'shared/words/player-card.json'
	},
	{
		name: 'Lineup',
		module: LINEUP_MODULE,
		picks: ['LINEUP'],
		json: 'shared/words/league-lineup.json'
	},
	{
		name: 'Against',
		module: LINEUP_MODULE,
		picks: ['AGAINST'],
		json: 'shared/words/league-against.json'
	},
	{
		name: 'Move',
		module: 'web/src/lib/league/inseason/move.ts',
		picks: ['MOVE_LINES', ['notReached', 'NOT_REACHED']],
		json: 'shared/words/league-move.json'
	},
	{
		name: 'InSeason',
		module: 'web/src/lib/league/inseason/words.ts',
		picks: ['LINES'],
		json: 'shared/words/league-inseason.json'
	},
	{
		name: 'Designation',
		module: DESIGNATION_MODULE,
		picks: ['DESIGNATION_WORDS'],
		json: 'shared/words/designation.json'
	},
	{
		name: 'DesignationRank',
		module: DESIGNATION_MODULE,
		picks: ['RANK_WORDS'],
		json: 'shared/words/designation-rank.json'
	},
	{
		name: 'Figure',
		module: 'web/src/lib/format/figure-words.ts',
		picks: ['FIGURE'],
		json: 'shared/words/figure.json'
	},
	{
		name: 'Matchup',
		module: 'web/src/lib/league/box/matchup.ts',
		picks: ['MATCHUP'],
		json: 'shared/words/league-matchup.json'
	},
	{
		name: 'Waivers',
		module: WAIVERS_MODULE,
		picks: ['WAIVERS'],
		json: 'shared/words/league-waivers.json'
	},
	{
		name: 'WaiverHeads',
		module: WAIVERS_MODULE,
		picks: ['HEAD_BASIS', ['separator', 'HEAD_SEPARATOR']],
		json: 'shared/words/league-waiver-heads.json'
	},
	{
		name: 'Stash',
		module: WAIVERS_MODULE,
		picks: ['STASH'],
		json: 'shared/words/league-stash.json'
	},
	{
		name: 'Season',
		module: 'web/src/lib/league/box/season.ts',
		picks: ['SEASON', ['gainAWeek', 'GAIN_A_WEEK']],
		json: 'shared/words/league-season.json'
	},
	{
		name: 'Strip',
		module: 'web/src/lib/league/box/strip.ts',
		picks: ['STRIP'],
		json: 'shared/words/league-strip.json'
	}
];
export const OUTPUT = {
	swift: 'apps/ios/Packages/CommishDesign/Sources/CommishDesign/Words.generated.swift',
	kotlin: 'apps/android/design/src/main/kotlin/app/trycommish/design/Words.kt'
} as const;

const SWIFT_KEYWORDS = new Set(
	`associatedtype class deinit enum extension fileprivate func import init inout internal let open
	operator private precedencegroup protocol public rethrows static struct subscript typealias var
	break case catch continue default defer do else fallthrough for guard if in repeat return throw
	switch where while Any as await false is nil self Self super throws true try`.split(/\s+/)
);
const KOTLIN_KEYWORDS = new Set(
	`as break class continue do else false for fun if in interface is null object package return
	super this throw true try typealias typeof val var when while`.split(/\s+/)
);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface Split {
	strings: [string, string][];
	functions: string[];
}

/** The table's strings and its functions' names, or an error naming the member that is neither. */
function split(table: WordTable, name: string): Split {
	const strings: [string, string][] = [];
	const functions: string[] = [];
	for (const [key, value] of Object.entries(table)) {
		if (!IDENTIFIER.test(key))
			throw new Error(`${name}.${key} is not an identifier the apps can use.`);
		if (typeof value === 'string') strings.push([key, value]);
		else if (typeof value === 'function') functions.push(key);
		else throw new Error(`${name}.${key} is a ${typeof value}, not a string or a function.`);
	}
	return { strings, functions };
}

/** One table's JSON: each string by its key, then the function members' names. */
export function renderTable(table: WordTable, name: string): { json: string } {
	const { strings, functions } = split(table, name);
	return { json: `${JSON.stringify({ ...Object.fromEntries(strings), functions }, null, '\t')}\n` };
}

const swiftKey = (key: string): string => (SWIFT_KEYWORDS.has(key) ? `\`${key}\`` : key);
const kotlinKey = (key: string): string => (KOTLIN_KEYWORDS.has(key) ? `\`${key}\`` : key);

/** Every table into one Swift file and one Kotlin file. */
export function renderWords(tables: readonly NamedTable[]): { swift: string; kotlin: string } {
	const parts = tables.map(({ name, table }) => ({ name, ...split(table, name) }));
	const swift = parts
		.map(
			({ name, strings }) =>
				`    public enum ${name} {\n${strings
					.map(
						([key, text]) =>
							`        public static let ${swiftKey(key)} = ${stringLiteral(text, 'swift')}`
					)
					.join('\n')}\n    }`
		)
		.join('\n\n');
	const kotlin = parts
		.map(
			({ name, strings }) =>
				`    object ${name} {\n${strings
					.map(
						([key, text]) =>
							`        const val ${kotlinKey(key)} = ${stringLiteral(text, 'kotlin')}`
					)
					.join('\n')}\n    }`
		)
		.join('\n\n');
	const source = tables.length === 1 ? 'the web word table' : 'the web word tables';
	return {
		swift: `// ${generatedBy(SCRIPT, source)}
// swiftlint:disable all

/// The web's words, one enum per web word table. A word built from data is a function on the web, is
/// listed under \`functions\` in shared/words, not here, and is a function in the app too.
public enum Words {
${swift}
}
`,
		kotlin: `// ${generatedBy(SCRIPT, source)}
@file:Suppress("ktlint")

package app.trycommish.design

/** The web's words, one object per web word table. A word built from data is a function on the web, is
 * listed under \`functions\` in shared/words, not here, and is a function in the app too. */
object Words {
${kotlin}
}
`
	};
}

/** One table from a module's exports by its picks, or an error naming the export that is missing,
 * not the kind its pick says, or a key given twice. */
export function gather(
	module: Readonly<Record<string, unknown>>,
	picks: readonly Pick[],
	where: string
): WordTable {
	const entries = picks.flatMap((pick): [string, unknown][] => {
		const exportName = typeof pick === 'string' ? pick : pick[1];
		if (!(exportName in module)) throw new Error(`${where} exports no ${exportName}.`);
		const value = module[exportName];
		if (typeof pick !== 'string') {
			if (typeof value !== 'string')
				throw new Error(`${where} ${exportName} is a ${typeof value}, not a string.`);
			return [[pick[0], value]];
		}
		if (typeof value !== 'object' || value === null)
			throw new Error(`${where} ${exportName} is a ${typeof value}, not a table.`);
		return Object.entries(value);
	});
	const twice = entries.find(([key], i) => entries.findIndex(([other]) => other === key) !== i);
	if (twice !== undefined) throw new Error(`${where} gives ${twice[0]} twice.`);
	return Object.fromEntries(entries);
}

async function readTable(source: TableSource): Promise<NamedTable> {
	const module = (await import(join(REPOSITORY, source.module))) as Record<string, unknown>;
	return { name: source.name, table: gather(module, source.picks, source.module) };
}

export async function generate(): Promise<Outputs> {
	const tables = await Promise.all(TABLES.map(readTable));
	const { swift, kotlin } = renderWords(tables);
	return new Map([
		...TABLES.map((source, i): [string, string] => [
			source.json,
			renderTable(tables[i]?.table ?? {}, source.name).json
		]),
		[OUTPUT.swift, swift],
		[OUTPUT.kotlin, kotlin]
	]);
}

if (import.meta.main) await writeOutputs(await generate());
