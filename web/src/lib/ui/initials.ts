/** A face with no headshot holds the player's initials instead of an empty circle: someone is on
 * every row (first principles P1). A defense is its club's logo, so it never reaches here. */

/** The letters drawn: the first name's and the last name's, "Ja'Marr Chase" is "JC", "Kyle Juszczyk
 * Jr." is "KJ", a one-word name is its first two letters. */
export function initialsOf(name: string): string {
	const words = name
		.split(/\s+/)
		.map((w) => w.replace(/[^\p{L}]/gu, ''))
		.filter((w) => w !== '' && !SUFFIXES.has(w.toLowerCase()));
	const first = words[0] ?? '';
	const last = words.length > 1 ? (words[words.length - 1] ?? '') : '';
	const letters = last === '' ? first.slice(0, 2) : `${first[0] ?? ''}${last[0] ?? ''}`;
	return letters.toUpperCase();
}

/** Name suffixes that are never the last name. */
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

/** The size of the letters as a share of the face's diameter. */
export const INITIALS_SCALE = 0.38;
