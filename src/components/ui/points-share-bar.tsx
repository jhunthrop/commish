import { NOT_STARTED_DASH } from "./game-state-chip";

export interface PointsShareBarProps {
  /** Your side's name, as a manager would say it: "You", "Bay Bandits". */
  readonly mineLabel: string;
  readonly theirsLabel: string;
  /** Points scored so far. Already-scored REAL points, never a projection — see the component's
   *  docblock for why this bar refuses to be a win probability. */
  readonly mine: number;
  readonly theirs: number;
  readonly className?: string;
}

/**
 * The two shares, as whole percentages, or `null` for both when there is nothing to divide.
 *
 * `null` rather than `0` is the same ruling `NOT_STARTED_DASH` makes next door: before either
 * side has scored, neither owns 0% of the points — there are no points, and a share of nothing is
 * undefined, not zero. Printing "0% / 0%" at 12:55pm would be a claim about a division nobody has
 * performed.
 *
 * Negative running totals floor at zero for the arithmetic. A team total CAN go negative (a
 * fumble-heavy defence, a quarterback's interceptions), and there is no honest way to draw a
 * negative share of a bar; flooring keeps the two segments summing to the track's full width and
 * the printed numbers agreeing with what is drawn.
 *
 * `theirs` is derived as `100 - mine` rather than rounded independently, so the two numbers
 * always sum to 100. Two independent roundings produce "51% / 50%", which a reader correctly
 * reads as a bug.
 */
export function pointsShare(mine: number, theirs: number): { readonly minePct: number | null; readonly theirsPct: number | null } {
  const mineFloor = Math.max(0, mine);
  const total = mineFloor + Math.max(0, theirs);
  if (total <= 0) return { minePct: null, theirsPct: null };
  const minePct = Math.round((mineFloor / total) * 100);
  return { minePct, theirsPct: 100 - minePct };
}

/** A share as text: "54%", or the not-yet dash. One formatter for the two sides so they can
 *  never disagree about how a missing share is spelled. */
function shareText(pct: number | null): string {
  return pct === null ? NOT_STARTED_DASH : `${pct}%`;
}

/**
 * The two-sided points-share bar from the matchup hero: one rounded track split by who has
 * actually scored the points on the board so far.
 *
 * **IT IS ARITHMETIC, NOT A FORECAST.** This is the distinction the whole component turns on.
 * `mine / (mine + theirs)` is a fact — those points are on the board, the division is exact, and
 * nothing about it is modelled. A win probability is not: it needs per-player distributions,
 * game-script correlation and time remaining, and Gameday's honesty clause ("no invented data, no
 * tint without a stated population") forbids drawing one until the product can actually compute
 * it. The two are the same SHAPE on screen, which is exactly why this file says so out loud: the
 * next author to look at a split bar in a matchup hero will assume it is a win probability, and
 * the label under each segment is what stops them.
 *
 * **IT STATES ITS OWN NUMBERS.** `meter.tsx` documents the contract this inherits: *"never
 * renders a bar without its number, because a bar alone makes people estimate."* The bar is the
 * glance and the number is the decision, so the number is not optional and there is no prop to
 * turn it off. That is also the accessibility story: the track itself is `aria-hidden`, since the
 * two labelled percentages beneath it already say everything the geometry says, and a screen
 * reader should hear "You 54%" rather than a graphic with an invented description.
 *
 * **LAW 1, ONE MEANING PER CHANNEL.** Neither segment is money-green: green means money and seats
 * filling in this product, and a points share is neither. Your side takes the strong ink, theirs
 * the hairline — an ordering a monochrome eye reads correctly, with the percentage beneath each
 * segment as the channel that never depends on pigment at all.
 */
export function PointsShareBar({ mineLabel, theirsLabel, mine, theirs, className = "" }: PointsShareBarProps) {
  const { minePct, theirsPct } = pointsShare(mine, theirs);
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div aria-hidden="true" className="flex h-1.5 w-full overflow-hidden rounded-pill bg-surface-inset">
        {/* A width has to reach the DOM as a style: it is a runtime number, and Tailwind's
            scanner cannot see a class it never wrote down. Both segments read from the SAME
            rounded percentages the labels print, so the drawn bar and the stated number can
            never disagree by a pixel a reader would have to reconcile. */}
        <div className="h-full bg-text-muted" style={{ width: `${minePct ?? 0}%` }} />
        <div className="h-full bg-line" style={{ width: `${theirsPct ?? 0}%` }} />
      </div>
      <div className="flex items-baseline justify-between gap-3 text-xs text-text-muted">
        <ShareLabel label={mineLabel} pct={minePct} />
        <ShareLabel label={theirsLabel} pct={theirsPct} />
      </div>
    </div>
  );
}

/** One side's "name 54%" pair. The name truncates and the number never does — `meter.tsx`'s own
 *  LED-11 lesson: a decision that breaks across two lines mid-number reads as a rendering bug,
 *  and the label is the half that can afford to lose characters. */
function ShareLabel({ label, pct }: { readonly label: string; readonly pct: number | null }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="truncate">{label}</span>
      <span className="shrink-0 whitespace-nowrap font-mono font-medium tabular-nums text-text-primary">{shareText(pct)}</span>
    </span>
  );
}
