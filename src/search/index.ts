import type { SearchResult } from "./contract";
import type { SearchEntry } from "./entries";
import { compareMatches, matchAgainst, type MatchStrength } from "./match";
import { searchTokens } from "./normalize";

/**
 * THE IN-MEMORY INDEX AND THE ONE FUNCTION THAT SEARCHES IT. Pure: built once from entries
 * (`entries.ts`), searched on every query with no I/O, which is what lets the endpoint answer from
 * memory and the tests run without a database.
 *
 * A LINEAR SCAN, DELIBERATELY. The universe is a few hundred board rows and 32 teams; scoring every
 * entry against a query is microseconds, and a trie or an n-gram table would be a second data
 * structure to keep correct for no measurable gain. `size` is reported so the round's measurements
 * can say how big the thing in memory actually is.
 */

export interface SearchIndex {
  readonly entries: readonly SearchEntry[];
  /** How many entries the index holds, for the measurement report. */
  readonly size: number;
}

export function buildSearchIndex(entries: readonly SearchEntry[]): SearchIndex {
  return { entries, size: entries.length };
}

interface Scored {
  readonly entry: SearchEntry;
  readonly strength: MatchStrength;
}

function compareScored(a: Scored, b: Scored): number {
  return compareMatches(a.strength, b.strength) || a.entry.order - b.entry.order;
}

/** The strongest `limit` matches for `query`, strongest first; empty for a blank query. */
export function searchIndex(index: SearchIndex, query: string, limit: number): readonly SearchResult[] {
  const words = searchTokens(query);
  if (words.length === 0 || limit <= 0) return [];
  const scored: Scored[] = [];
  for (const entry of index.entries) {
    const strength = matchAgainst(words, entry.fields);
    if (strength !== null) scored.push({ entry, strength });
  }
  return scored
    .sort(compareScored)
    .slice(0, limit)
    .map((hit) => hit.entry.result);
}
