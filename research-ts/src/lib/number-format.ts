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

/**
 * A points delta as display text, sign always attached: "+6.0", "-2.0", "+0.0".
 *
 * THE SIGN IS THE COLOURBLIND CHANNEL, so it can never be left to a caller's `toFixed`. Roughly
 * one man in twelve has deuteranopia and this audience is overwhelmingly men; a feed that says
 * "this event helped you" only in green tells one manager in twelve nothing at all. A leading `+`
 * or `-` is text, survives being read aloud, survives being copied, and survives a monochrome
 * screen — which is the whole point.
 *
 * The value is rounded BEFORE its sign is read, so a `-0.04` that displays as `0.0` cannot render
 * as "-0.0" — a negative zero is a number nobody has ever scored. ASCII hyphen-minus rather than
 * the typographic minus sign, deliberately: this glyph exists to be announced and copied, and the
 * ASCII one is the one every screen reader and every clipboard handles the same way.
 */
export function signedPoints(points: number, digits = 1): string {
  const rounded = Number(points.toFixed(digits));
  return `${rounded < 0 ? "-" : "+"}${Math.abs(rounded).toFixed(digits)}`;
}
