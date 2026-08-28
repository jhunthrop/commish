import type { ReactNode } from "react";
import { Stat, type StatComparison } from "./stat";

/**
 * What the delta is measured in, and the label the inline `Stat` announces beside it. A constant
 * rather than a prop: every row in every feed in this product is points, and a per-row unit would
 * be an invitation to render a mixed column nobody can read down.
 */
export const DELTA_UNIT_LABEL = "pts";

/**
 * A points delta as display text, sign always attached: "+6.0", "-2.0", "+0.0".
 *
 * THE SIGN IS THE COLOURBLIND CHANNEL, so it can never be left to a caller's `toFixed`. Roughly
 * one man in twelve has deuteranopia and this audience is overwhelmingly men; a feed that says
 * "this event helped you" only in green tells one manager in twelve nothing at all. A leading `+`
 * or `-` is text, survives being read aloud, survives being copied, and survives a monochrome
 * screen — which is the whole point.
 *
 * The value is rounded BEFORE its sign is read, so a `-0.04` that displays as `0.0` cannot render
 * as "-0.0" — a negative zero is a number nobody has ever scored. ASCII hyphen-minus rather than
 * the typographic minus sign, deliberately: this glyph exists to be announced and copied, and the
 * ASCII one is the one every screen reader and every clipboard handles the same way.
 */
export function signedPoints(points: number, digits = 1): string {
  const rounded = Number(points.toFixed(digits));
  return `${rounded < 0 ? "-" : "+"}${Math.abs(rounded).toFixed(digits)}`;
}

export interface EventFeedRowProps {
  /** The clock this happened on, already formatted: "1:42", "Q3 8:42". Fixed-width and mono in
   *  the layout below, so a column of them is a column rather than a ragged edge. */
  readonly time: string;
  /** What happened, in a manager's words: "Bijan Robinson 12 yd rushing TD". */
  readonly children: ReactNode;
  /** The points this event moved, WITH its sign — `signedPoints` above is how a caller gets one
   *  that cannot be missing. */
  readonly delta: string;
  /** Whether this event happened to the reader's own team. */
  readonly mine: boolean;
  /** The population this delta is judged against, if the caller genuinely has one ("scoring
   *  plays this week"). Omitted, the delta renders as plain ink — see the component docblock. */
  readonly comparison?: StatComparison;
  readonly className?: string;
}

/**
 * MY ROW versus everybody else's, in two channels that are both structural rather than tinted.
 *
 * A left rule and a raised ground: the border is the scanning channel (the eye finds the ruled
 * rows down a fast-moving column without reading a word) and the ground is the confirming one.
 * Neither is a hue, so neither depends on colour vision, and neither spends one of law 1's six
 * meanings on a distinction that is about WHOSE row this is rather than what state it is in.
 *
 * Both branches carry the same 2px rule so the description column starts at the same x on every
 * row: a border that only exists on some rows shifts the text under it, and a feed whose rows do
 * not line up cannot be scanned at all.
 */
const OWNERSHIP = {
  mine: "border-edge bg-surface-raised",
  theirs: "border-transparent",
} as const;

/**
 * One line of the heartbeat.
 *
 * Gameday's own list of what makes a screen feel like a sports app puts this second: *"An event
 * feed is the heartbeat. A number that jumps with no explanation is unsettling; the same jump
 * with '12 yd rushing TD' beside it is a moment."* The scoreboard above answers "what is the
 * score"; this answers "why did it just change", and without it a live score is a number that
 * moves on its own.
 *
 * **THE DELTA ALWAYS GOES THROUGH `Stat`, comparison or not.** One code path, not two: a `Stat`
 * with no `comparison` renders `neutral`, which IS `textPrimary` — a plain, uncoloured, unweighted
 * number with no caret ("we do not colour a number for looking big", `stat.tsx`). So the
 * uncompared row and the compared row are typographically identical apart from the tint the
 * comparison earned, which is the only difference that should exist between them. Rendering
 * "plain ink" by hand instead would mean a second copy of `Stat`'s number treatment drifting
 * beside the first, and — since `Stat` is the only file allowed to name a magnitude colour
 * (`magnitude-budget.source.test.ts`) — a compared delta could not live in that copy anyway.
 *
 * `inline` orientation because a feed row is a single line: the stacked pairing needs vertical
 * room this layout does not have, and a block-level chip would break the row's line box.
 *
 * Truncation is on the DESCRIPTION and nowhere else. The timestamp and the delta are fixed and
 * `shrink-0`; when a long play description arrives, the sentence loses its tail and both numbers
 * survive intact, because a clipped number is a wrong number.
 */
export function EventFeedRow({ time, children, delta, mine, comparison, className = "" }: EventFeedRowProps) {
  return (
    <div data-mine={mine} className={`flex items-baseline gap-3 border-l-2 py-1 pl-2 text-sm ${mine ? OWNERSHIP.mine : OWNERSHIP.theirs} ${className}`}>
      <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-text-faint">{time}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <Stat label={DELTA_UNIT_LABEL} value={delta} size="sm" orientation="inline" comparison={comparison} className="shrink-0" />
    </div>
  );
}
