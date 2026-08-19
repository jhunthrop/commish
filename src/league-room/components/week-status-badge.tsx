import type { WeekStatus } from "@/league";
import { Badge } from "@/components/ui";
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
 */
export function WeekStatusBadge({ status }: WeekStatusBadgeProps) {
  const { label, tone } = COPY[status];
  return <Badge tone={tone}>{label}</Badge>;
}
