import type { RailLeagueState } from "@/league-room/lib/rail-line";

/**
 * THE RAIL'S ONE ROW MODEL, law 3 (the rail redesign, 2026-09-03): a chip, the full name, one
 * state line in words. The flyout (`league-rail.tsx`) and the `/app` full-page rows
 * (`@/league-room/components/league-rows`) both compose these exact pieces around a `Crest`
 * chip, so the two sizes can never drift into two row designs. The collapsed chip is this row
 * minus its words — the caller controls visibility through `className`, because "when the words
 * show" is the one thing the sizes genuinely differ on (the flyout reveals them on open, the
 * page always shows them).
 */
export interface RailWordsProps {
  readonly name: string;
  readonly stateLine: string;
  readonly state: RailLeagueState;
  /** Extra detail beside the name — the page row's "8-6 · 4th of 12". The flyout passes none. */
  readonly nameDetail?: string;
  readonly className?: string;
}

/**
 * The words half of a rail row: the league's real name over its one state line. `aria-hidden`
 * always — in the flyout the row link's `aria-label` carries the same words as its accessible
 * name (so the collapsed rail loses nothing to a screen reader), and on the page the row's own
 * link names the league; either way these spans are for eyes, never a second announcement.
 *
 * The line's ink keeps the channel law (law 2): amber for a league that is yours to act on,
 * quiet muted ink for everything else — including live margins, whose channel is the DOT's red;
 * a red sentence would shout on every open.
 */
export function RailWords({ name, stateLine, state, nameDetail, className = "" }: RailWordsProps) {
  return (
    <span aria-hidden="true" className={`min-w-0 flex-col ${className}`}>
      <span className={`truncate font-display text-sm font-semibold ${state === "quiet" ? "text-text-muted" : "text-text-primary"}`}>
        {name}
        {nameDetail === undefined ? null : <span className="ml-2 font-body text-xs font-normal tabular-nums text-text-muted">{nameDetail}</span>}
      </span>
      <span className={`truncate text-xs ${state === "needs-you" ? "text-accent" : "text-text-muted"}`}>{stateLine}</span>
    </span>
  );
}

/** The dot's own color — `aria-hidden` always: a colored dot with no sentence behind it is never
 *  rendered, the sentence lives in the row's accessible name. LAW 1, COLOUR IS A LEGEND
 *  (Gameday, 2026-08-28): amber is yours to act on, red is live now — see the original rail's
 *  docblock for the full ruling; the values moved here unchanged when the row model extracted. */
const DOT_CLASS: Readonly<Partial<Record<RailLeagueState, string>>> = {
  "needs-you": "bg-accent",
  live: "bg-negative",
};

export interface RailDotProps {
  readonly state: RailLeagueState;
  /** LAW 6, MOTION REPORTS: only the live dot breathes, and only for a reader who has not asked
   *  for reduced motion — a needs-you dot is a standing fact and never moves. */
  readonly reducedMotion: boolean;
}

/** The typed dot on a chip's corner, or nothing for a quiet league. */
export function RailDot({ state, reducedMotion }: RailDotProps) {
  if (state === "quiet") return null;
  return (
    <span
      aria-hidden="true"
      className={`absolute -right-0.5 -top-0.5 size-2.5 rounded-pill border border-surface ${DOT_CLASS[state]} ${
        state === "live" && !reducedMotion ? "animate-pulse-live" : ""
      }`}
    />
  );
}
