/**
 * HOW THIS PRODUCT WRITES A NUMBER, in the layer every surface can reach.
 *
 * These three lived in `league-room/lib/format.ts` (dossier-voice round §3.4, the founder's "up
 * 12.440000000000001"), which the shared UI primitives may not import from: `src/components/ui`
 * sits UNDER the room, and a chip that needs one decimal cannot reach up into a feature folder for
 * it. They move here and `league-room/lib/format.ts` re-exports them, so there is still exactly one
 * definition of what one decimal means and every existing caller keeps its import.
 */

/**
 * ONE DECIMAL, ALWAYS. A number that reaches a sentence through a subtraction carries the whole of
 * binary floating point with it, and a module that interpolates it raw prints all seventeen digits.
 */
export function formatTenth(value: number): string {
  return value.toFixed(1);
}

/**
 * A BOOK'S OWN LINE — one decimal with a bare `.0` trimmed: a win total of 9.5 is 9.5 and a win
 * total of 10 is 10, never "10.0". The books post halves, so the half has to survive, and a whole
 * number nobody hung a half on should not grow a decimal it never had.
 */
export function formatLine(value: number): string {
  const rounded = Number(value.toFixed(1));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** A counted quantity a person says whole: yards, snaps, attempts. */
export function formatWhole(value: number): string {
  return String(Math.round(value));
}

/** Counts a sentence speaks rather than spells in digits — "Two left in his tier", "Ten laws
 *  together". Past twelve a figure reads as a figure again, and the counts these sentences carry
 *  are small by construction. */
const COUNT_WORDS: readonly string[] = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
];

export function countWord(count: number): string {
  return COUNT_WORDS[count] ?? String(count);
}

/** `countWord` with its first letter capitalized, for a count that opens a sentence. */
export function countWordCapitalized(count: number): string {
  const word = countWord(count);
  return word.charAt(0).toUpperCase() + word.slice(1);
}
