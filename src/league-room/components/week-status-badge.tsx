import type { WeekStatus } from "@/league";
import { StatPill } from "@/components/ui";
import { LiveChip } from "@/components/ui/live-chip";

const SETTLED_LABEL: Readonly<Record<Exclude<WeekStatus, "in_progress">, string>> = {
  scheduled: "Not started",
  final: "Final",
};

export interface WeekStatusBadgeProps {
  readonly status: WeekStatus;
}

/**
 * The one place a week's status becomes a mark on a screen. Every context that shows a week's
 * state (the league home's week band, the matchup panel, the leagues board) renders THIS, so the
 * three can never quietly disagree about what a live week looks like.
 *
 * SUNDAY v5, THE LIVE CHANNEL SPLIT. A week in progress used to be a `negative`-toned pill with a
 * `negative/25` glow ring, because through v4 one red family carried both "happening now" and
 * "this failed". Law 4 splits them: `live` is its own channel and means nothing else ever, and
 * `negative` is left to the verdict and the failure. A live week is the most-seen live fact in the
 * product, so it is the one that had to move first.
 *
 * IT ALSO STOPPED BEING A PILL. A bordered chip is a LABEL — a state a row happens to be in. The
 * two settled states genuinely are labels and keep the chip. A live week is the one thing on the
 * screen still moving, and `LiveChip` is the tower's answer to that: a breathing dot beside the
 * word, in the live ink, with nothing boxing it in. The asymmetry is the information.
 */
export function WeekStatusBadge({ status }: WeekStatusBadgeProps) {
  if (status === "in_progress") return <LiveChip>Live</LiveChip>;
  return <StatPill tone="neutral" label={SETTLED_LABEL[status]} />;
}
