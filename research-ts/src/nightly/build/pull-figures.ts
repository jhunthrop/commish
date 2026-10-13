import type { BoardRow } from "@research-ts/board/service";
import type { PullFigure } from "../artifacts";

/** One number the player page prints, with the label it prints beside it. */
export interface PageNumber {
  readonly label: string;
  readonly value: number;
}

/**
 * THE NUMBERS THE PAGE PRINTS, in the order the page leads with them: the projection and its range
 * of outcomes, the value over replacement, the drop to the next tier and where drafters take him,
 * all from the page's own board row. A pull figure can only ever be one of these.
 */
export function pageNumbersOf(row: BoardRow): readonly PageNumber[] {
  const candidates: readonly (readonly [string, number | null])[] = [
    ["projected points", row.projectedPoints],
    ["ceiling", row.ceilingPoints],
    ["floor", row.floorPoints],
    ["median", row.medianPoints],
    ["points over replacement", row.valueOverReplacement],
    ["drop to the next tier", row.dropToNextTier],
    ["ADP", row.marketAdp],
  ];
  return candidates.flatMap(([label, value]) => (value === null || !Number.isFinite(value) ? [] : [{ label, value }]));
}

/** Below this a whole-number rendering ("3") is too common a token to say the prose quoted the page. */
const WHOLE_NUMBER_FLOOR = 10;

/** How a page number can be printed in prose: to the tenth as the page prints it, or to the whole
 *  point as the writer rounds it ("about 274 points"). */
function renderingsOf(value: number): readonly string[] {
  const tenth = value.toFixed(1);
  return Math.abs(value) >= WHOLE_NUMBER_FLOOR ? [tenth, String(Math.round(value))] : [tenth];
}

function sentencesOf(prose: string): readonly string[] {
  return prose
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `text` as a standalone figure in `sentence`: not inside a longer number ("274" in "1274" or
 *  "274.5"), and not a thousands group. */
function printsFigure(sentence: string, text: string): boolean {
  return new RegExp(`(?<![\\d.,])${escapeForPattern(text)}(?![\\d]|[.,]\\d)`).test(sentence);
}

/**
 * THE PULL FIGURES (the approved player page shows three beside the capsule): the page's own
 * numbers, in the page's order, that the capsule prose prints, each with the prose's own rendering
 * and the sentence it sits in. The figure comes from the board row, never from the prose, so a
 * capsule quoting a number the page does not show (the stale "32nd overall" the mocks caught) can
 * never become a pull figure, and a capsule that quotes none of its page's numbers has none, which
 * the capsule gate names.
 */
export function pullFiguresOf(prose: string, numbers: readonly PageNumber[], count: number): readonly PullFigure[] {
  const sentences = sentencesOf(prose);
  const figures: PullFigure[] = [];
  for (const number of numbers) {
    for (const text of renderingsOf(number.value)) {
      // One figure per printed number: a median that rounds to the projection is the same "236".
      if (figures.some((figure) => figure.text === text)) continue;
      const sentence = sentences.find((candidate) => printsFigure(candidate, text));
      if (sentence === undefined) continue;
      figures.push({ text, label: number.label, value: number.value, sentence });
      break;
    }
    if (figures.length === count) break;
  }
  return figures;
}

/** Whether `figure.text` is `figure.value` at the precision the text prints. */
export function figureMatchesValue(figure: PullFigure): boolean {
  const decimals = figure.text.includes(".") ? figure.text.split(".")[1]!.length : 0;
  return Number(figure.text) === Number(figure.value.toFixed(decimals));
}
