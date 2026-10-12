import type { PullFigure } from "../artifacts";

/** A figure worth printing large: a percent, or a number with a decimal point ("29%", "49.7%",
 *  "16.8"). Whole numbers are left in the prose: they are counts and ranks, read in passing. */
const FIGURE_PATTERN = /(?<![\w.])-?\d{1,3}(?:,\d{3})*(?:\.\d+%?|%)(?![\w])/g;

function sentencesOf(prose: string): readonly string[] {
  return prose
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * THE PULL FIGURES (the approved player page, "three pull figures"): the first `count` distinct
 * figures in the order the prose prints them, each lifted VERBATIM with the sentence it sits in, so
 * the large number beside the capsule is always a number the capsule itself says, word for word.
 * Fewer than `count` when the prose prints fewer; none for prose with no figure at all.
 */
export function pullFiguresOf(prose: string, count: number): readonly PullFigure[] {
  const figures: PullFigure[] = [];
  const seen = new Set<string>();
  for (const sentence of sentencesOf(prose)) {
    for (const match of sentence.matchAll(FIGURE_PATTERN)) {
      const text = match[0];
      if (seen.has(text)) continue;
      seen.add(text);
      figures.push({ text, sentence });
      if (figures.length === count) return figures;
    }
  }
  return figures;
}
