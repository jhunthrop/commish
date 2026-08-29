import type { ReactElement } from "react";
import { NOT_STARTED_DASH } from "./game-state-chip";

export interface EdgeCellProps {
  /**
   * The gap, already computed by the caller: their rank minus ours. Positive means we rate him
   * higher than they do. `null` when either side has nothing to say — see law 7.
   */
  readonly gap: number | null;
  /** Who "they" are: "the market", "expert consensus". Named, never implied. */
  readonly against: string;
  /** Decimals to print. Ranks are whole; prices carry one. */
  readonly precision?: number;
}

/**
 * SUNDAY v5, LAW 1 — every number is a delta, not a fact.
 *
 * A leaderboard has only ever shown one thing: the gap to a rival. Market rank, expert rank and
 * our rank are all quiet grey; THIS is the figure that carries chroma, because it is the only one
 * that is a comparison rather than a value. It is also the entire product thesis in one cell —
 * where we disagree with the room, and by how much.
 *
 * TWO REFUSALS, both carried from v4 and both load-bearing:
 *
 * A `null` gap renders `NOT_STARTED_DASH` and takes NO tint. An absent number must never pick up
 * a colour, because a tinted dash reads as a verdict about a thing we have not measured. Our own
 * model is unwired for the season in progress at the time of writing, so this is the common case
 * on a live board rather than an edge case.
 *
 * A zero gap is a real measurement and renders plainly. Agreeing with the market is information;
 * it is just not a verdict, so law 1 says it is grey.
 *
 * The sign is printed, not implied by colour alone — a plus or minus survives a monochrome print
 * and a screen reader, and the label says which direction is which in words.
 */
export function EdgeCell({ gap, against, precision = 1 }: EdgeCellProps): ReactElement {
  if (gap === null) {
    return (
      <span className="font-display text-lg font-bold text-text-faint" data-edge="unknown">
        <span aria-hidden="true">{NOT_STARTED_DASH}</span>
        <span className="sr-only">No comparison against {against} yet</span>
      </span>
    );
  }

  const rounded = Number(gap.toFixed(precision));
  if (rounded === 0) {
    return (
      <span className="font-display text-lg font-bold tabular-nums text-text-muted" data-edge="level">
        <span aria-hidden="true">0.0</span>
        <span className="sr-only">Level with {against}</span>
      </span>
    );
  }

  const higher = rounded > 0;
  return (
    <span
      className={`font-display text-lg font-extrabold tabular-nums ${higher ? "text-positive" : "text-negative"}`}
      data-edge={higher ? "higher" : "lower"}
    >
      <span aria-hidden="true">
        {higher ? "+" : "−"}
        {Math.abs(rounded).toFixed(precision)}
      </span>
      <span className="sr-only">
        {Math.abs(rounded).toFixed(precision)} places {higher ? "higher" : "lower"} than {against}
      </span>
    </span>
  );
}
