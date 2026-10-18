/** The words the site never prints (the copy rules): the betting and trading registers, and "host"
 * (member-facing copy names the platform, never "host"), whole words, any case. One list for every
 * guard that reads the site's copy (Lane 66n re-review N5, re-review 2 F1, Lane 66q): every test and
 * shots script that guards copy reads it here. A guard with words of its own composes this list with
 * them (bannedIn), never a second list. */

/** The betting register's words that no code says: a source file may say "line" or "total" in its
 * code, never "odds". */
const BETTING_ONLY = [
	'favou?red',
	'favou?rites?',
	'underdogs?',
	'odds',
	'over\\/under',
	'bets?',
	'betting',
	'wagers?',
	'parlays?',
	'vegas',
	'sportsbooks?'
];
/** The betting register's words that are plain words in code too. */
const BETTING_SHARED = ['lines?', 'spreads?', 'totals?'];
const TRADING = ['markets?', 'prices?', 'buy', 'sell'];
const PLATFORM = ['hosts?'];

const whole = (words: readonly string[]): RegExp => new RegExp(`\\b(${words.join('|')})\\b`, 'iu');

export const BANNED_WORDS = whole([...BETTING_ONLY, ...BETTING_SHARED, ...TRADING, ...PLATFORM]);

/** The betting register a scan of source files reads (the room's guard, comments included): the list
 * without the words code says too. */
export const BETTING_WORDS = whole(BETTING_ONLY);

/** The punctuation the site's copy never uses: the em dash and the semicolon. */
export const BANNED_MARKS = /[—;]/u;

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
