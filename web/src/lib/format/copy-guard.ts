/** The words the site never prints (the copy rules): the betting and trading registers, and "host"
 * (member-facing copy names the platform, never "host"), whole words, any case. One list for every
 * guard that reads the site's copy (Lane 66n re-review N5, re-review 2 F1, Lane 66q): every test and
 * shots script that guards copy reads it here. A guard with words of its own composes this list with
 * them (bannedIn), never a second list. The list itself is banned-words.json, which the research
 * writer reads too (research/capsules/site_words.py, the sweep's C7 and Y6), so prose that passes the
 * writer passes the site. */
import LIST from './banned-words.json' with { type: 'json' };

/** The one list's shape: each word a pattern fragment keyed to the word as a reader sees it, the
 * betting line with the field's own lines it spares, and the marks. */
export interface BannedList {
	bettingOnly: Readonly<Record<string, string>>;
	bettingShared: Readonly<Record<string, string>>;
	line: {
		word: string;
		shown: string;
		sparedAfter: readonly string[];
		sparedSide: readonly string[];
		sparedBefore: readonly string[];
	};
	trading: Readonly<Record<string, string>>;
	platform: Readonly<Record<string, string>>;
	marks: readonly string[];
}

/** The list the site and the writer both read. */
export const BANNED_LIST: Readonly<BannedList> = LIST;

/** "Line" as the betting word: the field's own lines (the goal line or goal-line, the offensive and
 * defensive line, the O-line and D-line, the line of scrimmage) are football and stay in the writer's
 * prose (coordinator ruling beside R3); "the line" stays caught. One lookaround a spared word, built
 * as the writer builds it. */
function fieldLine({ word, sparedAfter, sparedSide, sparedBefore }: BannedList['line']): string {
	const after = sparedAfter.map((spared) => `(?<!${spared}[ -])`).join('');
	const side = sparedSide.map((spared) => `(?<!\\b${spared}-)`).join('');
	const before = sparedBefore.map((spared) => `(?! ${spared})`).join('');
	return `${after}${side}${word}${before}`;
}

const fragments = (words: Readonly<Record<string, string>>): string[] => Object.keys(words);
/** The betting register's words that no code says: a source file may say "line" or "total" in its
 * code, never "odds". */
const BETTING_ONLY = fragments(BANNED_LIST.bettingOnly);
/** The betting register's words that are plain words in code too. */
const BETTING_SHARED = [fieldLine(BANNED_LIST.line), ...fragments(BANNED_LIST.bettingShared)];
const TRADING = fragments(BANNED_LIST.trading);
const PLATFORM = fragments(BANNED_LIST.platform);

const whole = (words: readonly string[]): RegExp => new RegExp(`\\b(${words.join('|')})\\b`, 'iu');

export const BANNED_WORDS = whole([...BETTING_ONLY, ...BETTING_SHARED, ...TRADING, ...PLATFORM]);

/** The betting register a scan of source files reads (the room's guard, comments included): the list
 * without the words code says too. */
export const BETTING_WORDS = whole(BETTING_ONLY);

/** A mark inside a character class, escaped where the class would read it as syntax. */
const classMark = (mark: string): string => mark.replace(/[\\\]^-]/gu, '\\$&');

/** The punctuation the site's copy never uses: the em dash, the en dash and the semicolon. */
export const BANNED_MARKS = new RegExp(`[${BANNED_LIST.marks.map(classMark).join('')}]`, 'u');

/** The list's words and marks as one pattern, with a guard's words of its own (a screen that also
 * never says "stock") composed with them: what a guard matches its copy against. */
export function bannedPattern(own?: RegExp): RegExp {
	const parts = [BANNED_WORDS.source, BANNED_MARKS.source, ...(own ? [own.source] : [])];
	return new RegExp(parts.join('|'), 'iu');
}

/** The first banned word or mark in a text, its own words composed (bannedPattern), null with none. */
export function bannedIn(text: string, own?: RegExp): string | null {
	return bannedPattern(own).exec(text)?.[0] ?? null;
}

/** The fields the API's answers (api/types.ts) and the run's files (run/schema.ts) carry names in: a
 * player's, a club's city and nickname, a league's, a team's and its owner's. Only their strings are
 * data; every other string an answer carries (a headline, a label, a caption, a basis) is copy. */
const NAME_FIELDS: ReadonlySet<string> = new Set([
	'name',
	'first_name',
	'last_name',
	'city',
	'nickname',
	'team_name',
	'league_name',
	'board_name',
	'owner',
	'username',
	'host_name',
	'host_username',
	'by_name',
	'placed_by_name',
	'seat_names'
]);

/** The strings a page was handed as data, from any JSON the API or the run answered: the values of
 * its name fields, at any depth (ruling R3, decided by the field, never by a string's shape). Player,
 * club and team names are the API's own words, so a page's scan skips them, while every other string
 * in the answer is copy and is always scanned. */
export function dataStrings(value: unknown, named = false): Set<string> {
	if (typeof value === 'string') {
		const text = value.trim();
		return new Set(named && text !== '' ? [text] : []);
	}
	if (Array.isArray(value))
		return new Set((value as unknown[]).flatMap((child) => [...dataStrings(child, named)]));
	if (value === null || typeof value !== 'object') return new Set();
	return new Set(
		Object.entries(value).flatMap(([field, child]) => [
			...dataStrings(child, NAME_FIELDS.has(field))
		])
	);
}

/** A socket frame's data (the room's, the sweep's C8): a JSON frame read by its fields as an answer
 * is, any other frame none. */
export function frameData(frame: string): Set<string> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(frame);
	} catch {
		return new Set();
	}
	return dataStrings(parsed);
}

/** The first banned word or mark in a page's copy, the data it was handed skipped (ruling R3): a
 * name like "Las Vegas Raiders" or "Jadarian Price" is taken out before the scan, while a data
 * string that is only a banned word ("Totals") excuses nothing, so a head the web prints is still
 * caught. Null with none. */
export function bannedInCopy(text: string, data: Iterable<string>, own?: RegExp): string | null {
	const pattern = bannedPattern(own);
	const names = [...data]
		.filter((s) => {
			const hit = pattern.exec(s)?.[0];
			return hit !== undefined && hit.length < s.length;
		})
		.sort((a, b) => b.length - a.length);
	const copy = names.reduce((left, name) => left.split(name).join(' '), text);
	return bannedIn(copy, own);
}
