import Link from "next/link";
import type { HomeLeagueCard } from "../contract";
import { EYEBROW } from "@/components/ui";
import { actionHref } from "../lib/action-href";

/** One chip: a league name and the one real action it names — never a snooze or a dismiss
 *  affordance, because the chip itself is the thing that has to stop being true. */
export interface AttentionQueueItem {
  readonly leagueId: string;
  readonly leagueName: string;
  readonly label: string;
  readonly href: string;
}

/**
 * The needs-you set, in the SAME two kinds the rail's own `stateFor`
 * (`@/components/app-shell/shell-data`) treats as needs-you (F1): `fix-lineup` and `join-draft`.
 * Pure and derived-only — a league drops out the instant its own `nextAction.kind` stops being
 * one of these two, never because something was dismissed.
 */
export function attentionQueueItemsFrom(leagues: readonly HomeLeagueCard[]): readonly AttentionQueueItem[] {
  return leagues
    .filter((league) => league.nextAction?.kind === "fix-lineup" || league.nextAction?.kind === "join-draft")
    .map((league) => ({ leagueId: league.id, leagueName: league.name, label: league.nextAction!.label, href: actionHref(league) }));
}

export interface AttentionQueueProps {
  readonly items: readonly AttentionQueueItem[];
}

/**
 * The needs-you chips (Phase 3.6, Task 10, Step 1). No chip carries a dismiss affordance
 * (locker-room-panel.md, HIGH): every chip is DERIVED from an unfinished action
 * (`attentionQueueItemsFrom`, above), so finishing the action — setting the lineup, joining the
 * draft — is what removes it, and an un-actionable chip never renders in the first place. There
 * is no snooze, no local storage, no seen-flag: the queue is exactly as long as the list of
 * things still genuinely unfinished.
 */
export function AttentionQueue({ items }: AttentionQueueProps) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Needs you" className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item.leagueId}>
          <Link
            href={item.href}
            aria-label={`${item.label} for ${item.leagueName}`}
            className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface-elevated px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span aria-hidden="true" className={EYEBROW}>
              {item.leagueName}
            </span>
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
