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
	/** The screen's name, the enum and object the apps read it from (`LeagueHome`). */
	name: string;
	table: WordTable;
}

/** One table the generator reads: its module, its export and the JSON it writes. */
interface TableSource {
	name: string;
	module: string;
	exportName: string;
	json: string;
}

const SCRIPT = 'shared/scripts/gen-words.ts';
export const TABLES: readonly TableSource[] = [
	{
		name: 'LeagueHome',
		module: 'web/src/lib/league/home/home.ts',
		exportName: 'HOME',
		json: 'shared/words/league-home.json'
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
		if (!IDENTIFIER.test(key)) throw new Error(`${name}.${key} is not an identifier the apps can use.`);
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
					.map(([key, text]) => `        public static let ${swiftKey(key)} = ${stringLiteral(text, 'swift')}`)
					.join('\n')}\n    }`
		)
		.join('\n\n');
	const kotlin = parts
		.map(
			({ name, strings }) =>
				`    object ${name} {\n${strings
					.map(([key, text]) => `        const val ${kotlinKey(key)} = ${stringLiteral(text, 'kotlin')}`)
					.join('\n')}\n    }`
		)
		.join('\n\n');
	const source = tables.length === 1 ? 'the web word table' : 'the web word tables';
	return {
		swift: `// ${generatedBy(SCRIPT, source)}
// swiftlint:disable all

/// The web's words, one enum per screen. A word built from data is a function on the web and is
/// listed under \`functions\` in shared/words, not here.
public enum Words {
${swift}
}
`,
		kotlin: `// ${generatedBy(SCRIPT, source)}
@file:Suppress("ktlint")

package app.trycommish.design

/** The web's words, one object per screen. A word built from data is a function on the web and is
 * listed under \`functions\` in shared/words, not here. */
object Words {
${kotlin}
}
`
	};
}

async function readTable(source: TableSource): Promise<NamedTable> {
	const module = (await import(join(REPOSITORY, source.module))) as Record<string, unknown>;
	const table = module[source.exportName];
	if (typeof table !== 'object' || table === null)
		throw new Error(`${source.module} exports no ${source.exportName} table.`);
	return { name: source.name, table: table as WordTable };
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
