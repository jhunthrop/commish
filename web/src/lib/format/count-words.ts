/** A small count in words, as a sentence says it ("two of your scoring rules"), in a file of its own
 * so only the screens that say one carry it (Lane 66w). Ten and over are figures. */
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

export function countWord(n: number): string {
	return Number.isInteger(n) && n >= 0 && n < WORDS.length ? (WORDS[n] ?? String(n)) : String(n);
}
