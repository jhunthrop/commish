import { shortNameFor } from "./crest";

/** The tile's own cap — `shortNameFor`'s stated three-character limit, shared so a candidate
 *  this module derives can never overflow the same 40px chip. */
const MARK_MAX_CHARS = 3;

/** Small roman numerals a league series actually uses ("Dev Season League II"). Uppercase only:
 *  a lowercase "iv" mid-sentence is a word, not a series marker. */
const ROMAN_VALUES: ReadonlyMap<string, number> = new Map([
  ["II", 2],
  ["III", 3],
  ["IV", 4],
  ["V", 5],
  ["VI", 6],
  ["VII", 7],
  ["VIII", 8],
  ["IX", 9],
  ["X", 10],
]);

/** "DS" + 2 → "DS2"; when the suffix would overflow three characters, the prefix shrinks
 *  rather than the number ("D12") — the digit is the identity, the same priority
 *  `shortNameFor`'s trailing-number rule already gives it. `null` once even a one-character
 *  prefix cannot fit the number. */
function withDigit(preferred: string, n: number): string | null {
  const digits = String(n);
  const room = MARK_MAX_CHARS - digits.length;
  if (room < 1) return null;
  return `${preferred.slice(0, Math.min(2, room))}${digits}`;
}

/** The word-skip form: first letters of the first three letter-starting words ("The Longest
 *  Shot" → "TLS"), or `null` for a name without a third word to skip to. Mirrors
 *  `shortNameFor`'s own "words that start with a letter" filter so "12-team" can never
 *  contribute. */
function wordSkip(name: string): string | null {
  const lettered = name
    .trim()
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word));
  if (lettered.length < 3) return null;
  return lettered
    .slice(0, 3)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
}

/** The series form: a name whose LAST word is a small roman numeral takes that numeral's value
 *  as its digit ("Dev Season League II" → "DS2") — identity by construction from the name
 *  itself, before any counter is invented. `null` for every other name (a trailing arabic
 *  number is already `shortNameFor`'s own rule 1). */
function seriesForm(name: string, preferred: string): string | null {
  const words = name.trim().split(/\s+/);
  const last = words[words.length - 1];
  if (last === undefined) return null;
  const value = ROMAN_VALUES.get(last);
  if (value === undefined) return null;
  return withDigit(preferred, value);
}

/** Every candidate for one name, most-preferred first: the product's one crest mark
 *  (`shortNameFor`), then the series form, then the word-skip form, then counter digits. A
 *  generator so the counter tail never materializes unless the collision actually reaches it. */
function* candidatesFor(name: string): Generator<string> {
  const preferred = shortNameFor(name);
  yield preferred;
  const series = seriesForm(name, preferred);
  if (series !== null) yield series;
  const skip = wordSkip(name);
  if (skip !== null && skip.length <= MARK_MAX_CHARS) yield skip;
  for (let n = 2; n <= 99; n += 1) {
    const counter = withDigit(preferred, n);
    if (counter !== null) yield counter;
  }
}

/**
 * LAW 1, IDENTITY BY CONSTRUCTION (the rail redesign, 2026-09-03): monograms are unique across
 * one user's leagues. `shortNameFor` (`./crest.ts`) stays the product's ONE mark rule — this
 * function never invents a different preferred form, it only resolves collisions among the
 * caller's own list, which is a fact about a SET of names no single-name rule can know.
 *
 * The ladder, per name: the ordinary mark first; a trailing roman numeral's own number next
 * ("Dev Season League II" → "DS2" — the name already carries its digit); then the word-skip
 * letters ("The Longest Shot" → "TLS"); then an appended counter ("Dark Skies" second in line
 * behind "Dire Straits" → "DS2"). First unclaimed candidate wins. Everything stays within
 * `shortNameFor`'s own three-character cap.
 *
 * THE STABILITY RULE, deterministic and documented: assignment runs in the input list's order,
 * and the caller passes leagues in the shell read's own stable order (`myLeaguesOverview`:
 * `leagues.createdAt` asc — join order, untouched by urgency sorting). The function is pure
 * over the current list, so when a sibling leaves, every remaining league re-derives against
 * the smaller set: a league whose preferred form that departure freed UPGRADES to it ("DS2"
 * becomes "DS"), and a league whose candidates the departure never touched keeps its monogram
 * byte-identically, because both its ladder and its position among its own collisions are
 * unchanged.
 *
 * The counter tail is finite (2..99), so a pathological list can exhaust it; the preferred form
 * is returned un-deduplicated in that case rather than overflowing the tile — with two-letter
 * prefixes and two-digit counters that takes over a hundred same-initial leagues, past any real
 * account.
 */
export function monogramsFor(names: readonly string[]): readonly string[] {
  const claimed = new Set<string>();
  return names.map((name) => {
    for (const candidate of candidatesFor(name)) {
      if (!claimed.has(candidate)) {
        claimed.add(candidate);
        return candidate;
      }
    }
    return shortNameFor(name);
  });
}
