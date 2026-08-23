import type { WeekStatus } from "@/league";
import { StatPill } from "@/components/ui";
import type { BadgeTone } from "@/components/ui/badge";

const COPY: Readonly<Record<WeekStatus, { readonly label: string; readonly tone: BadgeTone }>> = {
  scheduled: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "accent" },
  final: { label: "Final", tone: "positive" },
};

export interface WeekStatusBadgeProps {
  readonly status: WeekStatus;
}

/**
 * The one place a week's status becomes a badge. Live scoring exists now, so a week is one of
 * three honest states rather than a page-local `final ? "Final" : "Not scored yet"` ternary —
 * every context that shows a week's state (the scoreboard, and Task 9's cross-league home card)
 * renders THIS, so the two can never quietly disagree about what a week looks like.
 *
 * Built on `StatPill` (Phase 3.6, Task 3) rather than `Badge` directly: an in-progress week IS a
 * live pill, and `glow` gives it the same tinted ring the rest of the product's live states get.
 */
export function WeekStatusBadge({ status }: WeekStatusBadgeProps) {
  const { label, tone } = COPY[status];
  return <StatPill tone={tone} label={label} glow={status === "in_progress"} />;
}
