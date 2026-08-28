import { NOT_STARTED_DASH } from "./game-state-chip";
import { Stat, type StatComparison } from "./stat";

export interface SourceValue {
  /** The source's own name, printed inline as the number's eyebrow: "Market", "Experts", "PPG". */
  readonly label: string;
  /**
   * The number, already formatted, or `null` for a source this product cannot currently reach.
   * `null` is the ONLY spelling of "we do not have this" — see the component's docblock. Never a
   * zero, never a guess, never a value borrowed from a neighbouring source.
   */
  readonly value: string | null;
  /** Omit for a number with no stated population. A `null` value is never compared, whatever a
   *  caller passes — the strip drops it rather than trusting the call site. */
  readonly comparison?: StatComparison;
}

export interface SourceStripProps {
  readonly sources: readonly SourceValue[];
  /** Named for assistive tech only. There is no visible heading and there must never be one. */
  readonly label: string;
  readonly className?: string;
}

/**
 * SEVERAL INDEPENDENT SOURCES' NUMBERS FOR ONE PLAYER, SIDE BY SIDE, IN ONE ROW.
 *
 * The device is borrowed from the reference product the founder named, where a player's panel
 * opens with `RB 1 | Sleeper 1.3 | ESPN 1.4 | Yahoo 1.4 | PPG 21.6` and no heading, no legend and
 * no caption anywhere near it. The platform names ARE the legend, and the row is comprehensible
 * in about a second because of it. Ours holds the same shape and better material: theirs compares
 * three aggregations of the same crowd, ours puts the market beside the experts beside our own
 * model, which is a disagreement somebody can actually be right or wrong about.
 *
 * **NO HEADING, NO LEGEND, NO CAPTION.** `label` is `aria-label` and nothing else. A strip that
 * needs a sentence above it explaining that it compares sources has already failed at the one
 * thing it was built to do.
 *
 * **A SOURCE WE CANNOT REACH PRINTS A DASH AND SAYS NOTHING.** `value: null` renders
 * `NOT_STARTED_DASH` — the same glyph and the same ruling as the wallet's uncommitted figures
 * (`wallet-panel.tsx`): a dash is not a zero, and an absent number is never invented. It also
 * drops any `comparison` the caller passed, so a missing number can never pick up a tint: a
 * colour is a claim about where a value sits in a population, and there is no value.
 *
 * Every cell is a `Stat`, which is not a stylistic choice — `Stat` is the only file in the product
 * permitted to name a magnitude colour (`magnitude-budget.source.test.ts`), so a strip that wants
 * one number tinted has to be built out of them.
 */
export function SourceStrip({ sources, label, className = "" }: SourceStripProps) {
  return (
    // A single row that scrolls rather than wraps: the whole argument of the device is that the
    // sources are COMPARABLE AT A GLANCE, and a strip that breaks onto a second line at 360px has
    // put two of its sources somewhere the eye does not compare them.
    <div role="group" aria-label={label} className={`flex items-end gap-4 overflow-x-auto sm:gap-6 ${className}`}>
      {sources.map((source) => (
        <Stat
          key={source.label}
          size="md"
          label={source.label}
          value={source.value ?? NOT_STARTED_DASH}
          comparison={source.value === null ? undefined : source.comparison}
          className="shrink-0"
        />
      ))}
    </div>
  );
}
