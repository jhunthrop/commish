import type { ReactElement } from "react";
import { MICRO_LABEL } from "./config";

export type TowerFigureSize = "md" | "lg" | "xl";

const SIZE_CLASS: Readonly<Record<TowerFigureSize, string>> = {
  md: "text-display-md",
  lg: "text-display-lg",
  xl: "text-display-xl",
};

export interface TowerFigureProps {
  /** The shouted key beside the number — the one sanctioned all-caps register. */
  readonly label: string;
  /** Already formatted by the caller. This primitive never decides a precision or a currency. */
  readonly value: string;
  readonly size?: TowerFigureSize;
  /**
   * Present when the figure is an ABSENCE rather than a measurement — pass the sentence a screen
   * reader should hear instead ("No balance yet."). The glyph then renders faint and
   * `aria-hidden`, because a dash drawn in ordinary ink at display scale is not a dash: it is a
   * solid bar the width of an em, and on the light theme it reads as a redaction over the
   * reader's own number.
   */
  readonly absent?: string;
  readonly className?: string;
}

/**
 * SUNDAY v5 — A HERO FIGURE WITH NOTHING TO COMPARE IT TO.
 *
 * Law 1 says every number is a delta and facts are grey; law 7 says we never draw a number we
 * cannot stand behind. This primitive is what those two leave over: the figure a screen genuinely
 * exists to answer, printed in the condensed face at hero scale under the micro-label register,
 * carrying **no chroma at all** because there is no population behind it.
 *
 * **WHY THIS IS NOT `Stat`.** `Stat` is the heat map's renderer — its whole contract is the
 * `comparison` seam and the three colourblind channels that hang off it. Three figures in this
 * product are hero-scale and can NEVER take a comparison, and each one had hand-rolled its own
 * pairing to say so:
 *
 * - **a wallet balance** — "top 12% of balances" is a population this product does not hold and
 *   would be a judgement about a person's money besides;
 * - **seasons finished** — the population is "every manager on Commish", which the account room
 *   does not read and would be inventing (ruling 30);
 * - **reconciliation drift** — a drift has no population, and green-for-zero would be a verdict
 *   the `Badge` beside it already states in a word.
 *
 * Passing `comparison={undefined}` to `Stat` gets the same ink, but it leaves the seam open at
 * three call sites where the correct answer is that the seam must not exist. This primitive
 * cannot be tinted, so the refusal is structural rather than a habit.
 *
 * **THE REGISTER IS `MICRO_LABEL`, NOT `EYEBROW`** (v5, law 3). An eyebrow is a sentence-case
 * label above a BLOCK; this is a shouted key beside DATA, which is the one place every sports
 * interface has always put capitals, and it is what makes a figure read as a tower reading rather
 * than a form field.
 */
export function TowerFigure({ label, value, size = "lg", absent, className = "" }: TowerFigureProps): ReactElement {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <span className={`${MICRO_LABEL} text-text-faint`}>{label}</span>
      <span
        aria-hidden={absent === undefined ? undefined : "true"}
        className={`font-display leading-display font-bold tabular-nums ${SIZE_CLASS[size]} ${
          absent === undefined ? "text-text-primary" : "text-text-faint"
        }`}
      >
        {value}
      </span>
      {absent === undefined ? null : <span className="sr-only">{absent}</span>}
    </div>
  );
}
