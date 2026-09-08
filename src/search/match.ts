import { SEARCH_CONFIG } from "./config";

/**
 * HOW STRONGLY A QUERY MATCHES ONE ENTRY. Pure, over strings `normalize.ts` has already folded.
 *
 * FOUR TIERS, IN THE ORDER A PERSON MEANS THEM: a query word that IS a word of the entry (exact),
 * one that starts a word (prefix), the whole query somewhere inside the name (substring), and one
 * word off by a single edit (fuzzy). The tier is the WEAKEST tier any query word needed, so a
 * two-word query is only as strong as its worse word.
 *
 * THREE PRIORITIES, BY WHICH FIELD ANSWERED: the entry's own name (0), a player's team code, city or
 * nickname (1), his position (2). "Lions" on a Lions receiver is a team match and ranks under the
 * Lions themselves; "wr" alone is a position match and lists receivers in board order. A team
 * entity (`entries.ts`) carries its city, nickname AND code as its NAME words and no team field, so
 * "det" on the Lions page is priority 0 and "det" on a Lions player is priority 1.
 *
 * WORDS CROSS FIELDS. "det wr" is one word answered by the team and one by the position, and the
 * priority reported is the best field any word used, so the row still sorts as a team match.
 *
 * NOTHING IS INVENTED. There is no initialism table: "JC" matches nobody because no stored word
 * starts with, equals, or is one edit from "jc". A position matches as a whole word only.
 */

export type MatchTier = "exact" | "prefix" | "substring" | "fuzzy";

/** The field group that answered, lower is stronger. */
export type MatchPriority = 0 | 1 | 2;

export interface MatchFields {
  /** The normalized display name. */
  readonly name: string;
  /** Normalized team words: the code, the city, the nickname. Empty for a free agent. */
  readonly team: readonly string[];
  /** The normalized position, or `null` for an entry that has none (a team). */
  readonly position: string | null;
}

export interface MatchStrength {
  readonly tier: MatchTier;
  readonly priority: MatchPriority;
}

const TIER_ORDER: Readonly<Record<MatchTier, number>> = { exact: 0, prefix: 1, substring: 2, fuzzy: 3 };

const PRIORITY = { name: 0, team: 1, position: 2 } as const satisfies Record<string, MatchPriority>;

/** Damerau-Levenshtein distance at most one: a substitution, an insertion, a deletion or a swap. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const gap = a.length - b.length;
  if (gap > 1 || gap < -1) return false;
  if (gap === 0) return oneSubstitutionOrSwap(a, b);
  const [shorter, longer] = gap < 0 ? [a, b] : [b, a];
  return oneInsertion(shorter, longer);
}

function oneSubstitutionOrSwap(a: string, b: string): boolean {
  let first = -1;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    if (first === -1) {
      first = i;
      continue;
    }
    // A second mismatch is only a single edit when it is the swap partner of the first.
    const isSwap = i === first + 1 && a[first] === b[i] && a[i] === b[first];
    if (!isSwap) return false;
    return a.slice(i + 1) === b.slice(i + 1);
  }
  return true;
}

function oneInsertion(shorter: string, longer: string): boolean {
  for (let i = 0; i < shorter.length; i += 1) {
    if (shorter[i] !== longer[i]) return shorter.slice(i) === longer.slice(i + 1);
  }
  return true;
}

/** A single query word against a single entry word: its tier, or `null`. */
function wordTier(query: string, word: string): MatchTier | null {
  if (query === word) return "exact";
  if (word.startsWith(query)) return "prefix";
  if (query.length < SEARCH_CONFIG.fuzzyMinLength) return null;
  // A typo inside a prefix ("jamer" for "jamarr") or inside the whole word ("chsae" for "chase").
  if (withinOneEdit(query, word.slice(0, query.length)) || withinOneEdit(query, word)) return "fuzzy";
  return null;
}

interface FieldWords {
  readonly priority: MatchPriority;
  readonly words: readonly string[];
  /** A position matches as a whole word only. */
  readonly exactOnly: boolean;
}

function fieldsOf(entry: MatchFields): readonly FieldWords[] {
  const fields: FieldWords[] = [{ priority: PRIORITY.name, words: entry.name.split(" "), exactOnly: false }];
  if (entry.team.length > 0) fields.push({ priority: PRIORITY.team, words: entry.team.flatMap((team) => team.split(" ")), exactOnly: false });
  if (entry.position !== null) fields.push({ priority: PRIORITY.position, words: [entry.position], exactOnly: true });
  return fields;
}

/** The best (tier, priority) one query word earns across every field of the entry. */
function bestForWord(query: string, fields: readonly FieldWords[]): MatchStrength | null {
  let best: MatchStrength | null = null;
  for (const field of fields) {
    for (const word of field.words) {
      const tier = wordTier(query, word);
      if (tier === null || (field.exactOnly && tier !== "exact")) continue;
      const candidate = { tier, priority: field.priority };
      if (best === null || compareMatches(candidate, best) < 0) best = candidate;
    }
  }
  return best;
}

/** Sort order for strengths: tier first, then priority. Zero for equal strengths. */
export function compareMatches(a: MatchStrength, b: MatchStrength): number {
  return TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.priority - b.priority;
}

/**
 * The strength of `queryWords` against `entry`, or `null` when it does not match. The tier is the
 * weakest any word needed; the priority is the strongest field any word used; at most one word
 * may be fuzzy. When the words do not all land, the whole query is tried as a substring of the
 * name, which is what catches a query typed from the middle of a name.
 */
export function matchAgainst(queryWords: readonly string[], entry: MatchFields): MatchStrength | null {
  if (queryWords.length === 0) return null;
  const fields = fieldsOf(entry);
  let weakest: MatchTier = "exact";
  let strongestPriority: MatchPriority = PRIORITY.position;
  let fuzzyWords = 0;
  let allLanded = true;
  for (const word of queryWords) {
    const best = bestForWord(word, fields);
    if (best === null) {
      allLanded = false;
      break;
    }
    if (best.tier === "fuzzy") fuzzyWords += 1;
    if (TIER_ORDER[best.tier] > TIER_ORDER[weakest]) weakest = best.tier;
    if (best.priority < strongestPriority) strongestPriority = best.priority;
  }
  if (allLanded && fuzzyWords <= 1) return { tier: weakest, priority: strongestPriority };
  return entry.name.includes(queryWords.join(" ")) ? { tier: "substring", priority: PRIORITY.name } : null;
}
