import { CAPSULE_CONFIG } from "./config";
import { sentencesOf, sentencesVerbatim, type NarrativeSlots } from "./narrative-slots";

/**
 * ALIVE, NOT STOCK (founder amendment 2026-09-07) — the check that keeps the narrative from
 * quietly becoming a second template.
 *
 * A model asked the same question about six hundred players will find a phrasing it likes and
 * reuse it. Nothing about one page shows that; only the board does. So the sweep counts every
 * narrative SENTENCE across every player it has stored, normalized (`normalizeSentence`), and any
 * sentence appearing on more than `CAPSULE_CONFIG.repetition.maxShare` of them is stock: those
 * players are queued for regeneration and the sentence is quoted into the next run's prompt as one
 * not to write again.
 *
 * SENTENCES, NOT SLOTS. A slot may hold two sentences and only the second may be the stock one, so
 * counting whole slots would miss exactly the case that matters. It also means a genuinely
 * repeated SHORT sentence ("He is a rookie.") is caught, which is correct: if it is worth saying
 * on thirteen pages in identical words, it is a template sentence and the template should say it.
 *
 * PURE. The sweep does the reading and the writing; this file decides nothing but what repeats.
 */

/** One player's stored narrative, the only shape this check needs. */
export interface NarrativeRow {
  readonly playerId: string;
  readonly narrative: NarrativeSlots | null;
}

export interface StockSentence {
  /** The normalized form, which is what the COUNT is over: two sentences differing only in a
   *  comma are the same stock sentence to a reader. */
  readonly sentence: string;
  /**
   * One player's own words for it, verbatim (review, MINOR). The prompt quotes THIS, because
   * "do not write: he is the engine of that offense every single week" — lowercase, unpunctuated —
   * reads to a model as an approximation it can dance around, where its own sentence handed back
   * with its capital and its full stop is unmistakable.
   */
  readonly example: string;
  /** Every player currently saying it, in the order the rows were read. */
  readonly playerIds: readonly string[];
  readonly share: number;
}

/** Every sentence in one player's narrative, deduplicated: a player who says the same thing in two
 *  slots counts once toward the board's share (that repetition is a per-player problem the prompt
 *  already forbids, not evidence of a stock sentence). */
function sentencesForPlayer(narrative: NarrativeSlots | null): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  if (narrative === null) return out;
  for (const value of Object.values(narrative)) {
    if (typeof value !== "string") continue;
    const normalized = sentencesOf(value);
    const verbatim = sentencesVerbatim(value);
    normalized.forEach((sentence, index) => {
      if (!out.has(sentence)) out.set(sentence, verbatim[index] ?? sentence);
    });
  }
  return out;
}

/**
 * The stock sentences on a board, worst first. `maxShare` defaults to the configured threshold;
 * a board with no narratives at all has no stock sentences rather than a division by nothing.
 */
export function stockSentences(rows: readonly NarrativeRow[], maxShare: number = CAPSULE_CONFIG.repetition.maxShare): readonly StockSentence[] {
  const withNarrative = rows.filter((row) => row.narrative !== null);
  if (withNarrative.length === 0) return [];

  const players = new Map<string, string[]>();
  const examples = new Map<string, string>();
  for (const row of withNarrative) {
    for (const [sentence, verbatim] of sentencesForPlayer(row.narrative)) {
      if (!examples.has(sentence)) examples.set(sentence, verbatim);
      const list = players.get(sentence);
      if (list === undefined) players.set(sentence, [row.playerId]);
      else list.push(row.playerId);
    }
  }

  const findings: StockSentence[] = [];
  for (const [sentence, playerIds] of players) {
    const share = playerIds.length / withNarrative.length;
    // Strictly greater: a sentence exactly at the share is at the line, not over it.
    if (share > maxShare && playerIds.length > 1) findings.push({ sentence, example: examples.get(sentence) ?? sentence, playerIds, share });
  }
  return findings.sort((a, b) => b.playerIds.length - a.playerIds.length || a.sentence.localeCompare(b.sentence));
}

/** Every player who says any stock sentence, once each — the sweep's own regeneration queue. */
export function playersSayingStock(findings: readonly StockSentence[]): readonly string[] {
  return [...new Set(findings.flatMap((finding) => finding.playerIds))];
}

/** The sentences the next run's prompt quotes as ones not to write, worst first and capped, in
 *  the words a player actually carries rather than in the normalized form the count uses. */
export function sentencesToAvoid(findings: readonly StockSentence[]): readonly string[] {
  return findings.slice(0, CAPSULE_CONFIG.repetition.maxQuotedSentences).map((finding) => finding.example);
}
