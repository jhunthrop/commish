import { EYEBROW, UI_CONFIG } from "./config";
import { type MagnitudeStep } from "@/design/tokens";

/**
 * The comparison set a number is judged against. Both fields are required and neither has a
 * default, which is the whole design: a `Stat` cannot be tinted without a caller naming a real
 * population and a real position inside it.
 */
export interface StatComparison {
  /** Where the value falls in `population`, 0..1, where 1 is the best in the set. */
  readonly percentile: number;
  /** The population, in the words a manager would use: "running backs this week". */
  readonly population: string;
}

/**
 * The display steps a `Stat` may take — the whole display scale, because this primitive IS the
 * pairing the scale exists for: a huge number over a tiny label. Range comes from size and only
 * from size; the ≤600 weight cap never moves. `3xl` is a TV board or a matchup hero, so a caller
 * steps down responsively for a phone (`text-display-lg sm:text-display-3xl` is the idiom) rather
 * than shipping 116px at 360px.
 */
export type StatSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

/**
 * Which way the number-over-label pairing runs.
 *
 * `stacked` is the shape the display scale exists for and stays the default: a huge number over a
 * tiny label, which is where the ~10x of dynamic range actually gets spent.
 *
 * `inline` turns it on its side for a chip in a row — the fun pass's verdict chip ("+11 steal"),
 * which has to be a `Stat` because `Stat` is the only file allowed to name a magnitude colour
 * (`magnitude-budget.source.test.ts`), but renders in a dense pool row, a one-line pick wire and
 * a tabular pick log, none of which have room for a stacked pairing. It renders a `<span>` rather
 * than a `<div>` for the wire specifically: that band is a single truncating line of inline
 * items, and a block-level chip inside it breaks the line box.
 */
export type StatOrientation = "stacked" | "inline";

export interface StatProps {
  /** What the number is. Always announced; on screen unless `srOnlyLabel` says a column already
   *  prints it. */
  readonly label: string;
  /**
   * Drop the visible label, keeping it for assistive tech. For ONE situation: a table cell, where
   * the column's own `<th>` is already the label on screen and in the accessibility tree for
   * every number beneath it. Printing "Points" again under each of eighteen rows is the document
   * grammar the fun pass exists to undo, and dropping the label entirely would leave a screen
   * reader a bare number with no name.
   *
   * Never a general "quieter Stat" switch: outside a labelled column, a number with no visible
   * name is the thing this primitive was built to stop shipping.
   */
  readonly srOnlyLabel?: boolean;
  /**
   * The number, already formatted. This primitive never decides how many decimals a score has:
   * a projection, a margin and a verdict round differently and the surface that owns the fact
   * owns its precision.
   */
  readonly value: string;
  /** Omit and the number renders as ordinary ink. There is no other way to get a neutral. */
  readonly comparison?: StatComparison;
  readonly size?: StatSize;
  readonly orientation?: StatOrientation;
  readonly className?: string;
}

/** A comparison is usable only if it is genuine: a named population and a percentile on the
 *  scale. Anything else is a caller bug, and tinting on a caller bug is the precise failure
 *  the magnitude amendment exists to avoid. */
function isStated(comparison: StatComparison | undefined): comparison is StatComparison {
  if (comparison === undefined) return false;
  const { percentile, population } = comparison;
  return Number.isFinite(percentile) && percentile >= 0 && percentile <= 1 && population.trim() !== "";
}

/**
 * Where a value lands on the ramp — the one place a percentile becomes a colour. Pure and
 * exported so a surface can ask the question without rendering (the draft room's verdict chip
 * will), and so the "no comparison, no colour" rule has a single home.
 */
export function magnitudeStep(comparison: StatComparison | undefined): MagnitudeStep {
  if (!isStated(comparison)) return "neutral";
  const floors = UI_CONFIG.stat.percentileFloors;
  const { percentile } = comparison;
  if (percentile >= floors.strong) return "strong";
  if (percentile >= floors.good) return "good";
  if (percentile >= floors.neutral) return "neutral";
  if (percentile >= floors.weak) return "weak";
  return "bad";
}

/** "Top 8% of running backs this week." — the population, stated, in the register the product
 *  already speaks (expanded, sentence case, no em-dashes). A percentile of exactly 0 or 1 floors
 *  at one percent rather than claiming a nonsense "Top 0%". */
function comparisonSentence({ percentile, population }: StatComparison): string {
  const side = percentile >= 0.5 ? "Top" : "Bottom";
  const share = Math.max(1, Math.round((percentile >= 0.5 ? 1 - percentile : percentile) * 100));
  return `${side} ${share}% of ${population}.`;
}

/** The ink. Named only here — `magnitude-budget.source.test.ts` fails any other file that does. */
const MAGNITUDE_INK: Readonly<Record<MagnitudeStep, string>> = {
  strong: "text-mag-strong",
  good: "text-mag-good",
  neutral: "text-mag-neutral",
  weak: "text-mag-weak",
  bad: "text-mag-bad",
};

/**
 * The second channel: which side of the population the value fell on. A text caret rather than
 * an `Icon`, deliberately — a `Stat` renders between 20px and the top of the display scale, and a
 * glyph that is part of the text run scales with the number it annotates, where an SVG at a fixed
 * `size` would drift from tiny to lost. It is `aria-hidden`: the sentence below says the same
 * thing in words, and a screen reader should hear the words.
 */
const MAGNITUDE_CARET: Readonly<Record<MagnitudeStep, string | null>> = {
  strong: "▲",
  good: "▲",
  neutral: null,
  weak: "▼",
  bad: "▼",
};

/**
 * The third channel: how far from the middle. Capped at 600 — rule 2 does not move, and dynamic
 * range comes from `SIZE_CLASS` below, never from a heavier face.
 */
const MAGNITUDE_WEIGHT: Readonly<Record<MagnitudeStep, string>> = {
  strong: "font-semibold",
  good: "font-medium",
  neutral: "",
  weak: "font-medium",
  bad: "font-semibold",
};

const SIZE_CLASS: Readonly<Record<StatSize, string>> = {
  sm: "text-display-sm",
  md: "text-display-md",
  lg: "text-display-lg",
  xl: "text-display-xl",
  "2xl": "text-display-2xl",
  "3xl": "text-display-3xl",
};

/**
 * A number that knows where it stands — the heat map's one renderer, and the vocabulary the rest
 * of the fun pass is built out of (`docs/design/2026-08-27-fun-pass-spec.md`).
 *
 * The founder's complaint was that the product reads as a contract, and the largest single cause
 * was that every number in it was the same colour. This is the fix, with the two guardrails that
 * make a heat map honest rather than merely lively:
 *
 * **A number is never coloured for looking big.** `comparison` is the only route to a tint, it
 * carries a named population and a percentile, and a comparison that is missing, unnamed or off
 * the scale renders `neutral` — which IS `textPrimary`, so an uncompared number is visually a
 * plain number and nothing else.
 *
 * **Colour is never the only channel.** Green versus red is the worst pair for deuteranopia and
 * this audience is overwhelmingly men, so a heat map that leans on hue silently misinforms one
 * manager in twelve, which is worse than no heat map at all. Three channels ship together here:
 * the value reads plainly as its own number in every state, a caret says which side of the
 * population it fell on, and a weight step says how far. Strip the colour entirely and the
 * column still ranks correctly. `stat.test.tsx` is the gate, and `tokens.test.ts` adds a fourth
 * for good measure by ordering the ramp's own pigments by luminance rather than hue.
 *
 * The population is stated to assistive tech in one sentence; a surface with room states it
 * visibly in its own column header, which is where a sports table has always put it.
 */
export function Stat({ label, value, comparison, size = "md", orientation = "stacked", srOnlyLabel = false, className = "" }: StatProps) {
  const step = magnitudeStep(comparison);
  const caret = MAGNITUDE_CARET[step];
  const inline = orientation === "inline";
  const Root = inline ? "span" : "div";
  const number = (
    // `items-baseline`: the caret sits on the number's own baseline at eyebrow size, so it
    // annotates the value without competing with it at `display-xl`.
    <span className={`flex items-baseline gap-1 font-display leading-display tabular-nums ${SIZE_CLASS[size]} ${MAGNITUDE_INK[step]} ${MAGNITUDE_WEIGHT[step]}`}>
      {caret === null ? null : (
        <span aria-hidden="true" className="text-xs">
          {caret}
        </span>
      )}
      <span>{value}</span>
    </span>
  );
  // `srOnlyLabel` for the caller whose surrounding markup ALREADY names this number — a table
  // cell under its own `<th>`. Printing "Points" beneath each of eighteen numbers is exactly the
  // document grammar this pass exists to undo. The label still ships to assistive tech, and all
  // three colourblind channels are untouched, so the accessibility contract is unchanged.
  const eyebrow = <span className={srOnlyLabel ? "sr-only" : `${EYEBROW} text-text-faint`}>{label}</span>;
  return (
    // `relative` is LOAD-BEARING and cost a full e2e cycle to find. The population sentence
    // below is `sr-only`, which is `position: absolute` — and an absolutely positioned box whose
    // ancestors are all `position: static` takes the INITIAL containing block, which means every
    // `overflow: hidden` between it and the page clips it for PAINT but not for the document's
    // scrollable area. Sixty verdict chips in the draft room's scrolling player pool therefore
    // extended the root scroll area to the pool's full 5,363px content height, breaking that
    // room's own law that the page never scrolls at desktop (`e2e/mock-draft.spec.ts`). One
    // positioned ancestor makes the sentence belong to its own `Stat` again, and the clip that
    // was always meant to apply does.
    //
    // Inline reads value-then-label ("+11 steal"), which is the order the phrase is spoken in;
    // stacked reads label-then-value, because a column header sits above its column.
    <Root data-magnitude={step} className={`relative ${inline ? "inline-flex items-baseline gap-1.5" : "flex flex-col gap-1"} ${className}`}>
      {inline ? number : eyebrow}
      {inline ? eyebrow : number}
      {isStated(comparison) ? <span className="sr-only">{comparisonSentence(comparison)}</span> : null}
    </Root>
  );
}
