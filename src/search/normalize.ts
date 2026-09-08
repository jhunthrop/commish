/**
 * THE ONE SPELLING A SEARCH COMPARES ON. Every name, code and query is folded through this before
 * any matching happens, so "St. Brown", "St Brown", "Smith-Njigba" and "Smith Njigba" are the same
 * string on both sides of the comparison.
 *
 * Three folds and nothing cleverer: diacritics stripped (NFD, then the combining block removed),
 * apostrophes and periods deleted (they are typography inside a word, not a word break: "Ja'Marr"
 * is one word, "St." is one word), every other non-alphanumeric run turned into one space (a
 * hyphen IS a word break: both halves of "Smith-Njigba" are words a person types on their own).
 */

const COMBINING_MARKS = /[\u0300-\u036f]/g;
const IN_WORD_PUNCTUATION = /['’.]/g;
const WORD_BREAKS = /[^a-z0-9]+/g;

export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(IN_WORD_PUNCTUATION, "")
    .replace(WORD_BREAKS, " ")
    .trim();
}

/** The normalized words of `text`, in order. Empty for blank input. */
export function searchTokens(text: string): readonly string[] {
  const normalized = normalizeSearchText(text);
  return normalized === "" ? [] : normalized.split(" ");
}
