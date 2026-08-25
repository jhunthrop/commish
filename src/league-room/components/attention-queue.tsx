import Link from "next/link";
import type { HomeLeagueCard } from "../contract";
import { EYEBROW, buttonClassName } from "@/components/ui";
import { actionHref } from "../lib/action-href";
import { LEAGUE_ROOM_CONFIG } from "../config";
import { sortLeagues } from "./league-board";

/** One chip: a league name and the one real action it names — never a snooze or a dismiss
 *  affordance, because the chip itself is the thing that has to stop being true. */
export interface AttentionQueueItem {
  readonly leagueId: string;
  readonly leagueName: string;
  readonly label: string;
  readonly href: string;
}

/**
 * Urgency order (LED-1, founder-delegated design ruling, 2026-08-24, persona-adjudicated): a
 * live draft outranks every lineup fix — nothing else matters while a league is on the clock and
 * a seat is yours to claim right now, the same precedence `nextAction`'s own ladder
 * (`@/league/next-action.ts`) already gives `join-draft` over `fix-lineup`. Within a kind, the
 * league whose `kickoffAt` reads earliest sorts first — the one per-league clock this card
 * carries (Task 10 Step 2b); a league with no real clock (`null`) sorts last within its kind, the
 * same `Number.POSITIVE_INFINITY` convention `nearestPreDraft` (`./home-board.tsx`) already uses
 * for a missing one. Everything the first two keys leave tied falls through to `sortLeagues`
 * (`./league-board.tsx`) — THE board's own order, applied first as the base pass and left
 * standing wherever kind and kickoff do not distinguish two leagues, because `Array.prototype
 * .sort` is stable: sorting a second and third time over an already-ordered array only ever
 * refines it, never reshuffles a tie the caller did not ask to break.
 */
function urgencyOrder(leagues: readonly HomeLeagueCard[]): readonly HomeLeagueCard[] {
  const kickoffMs = (league: HomeLeagueCard): number => (league.kickoffAt === null ? Number.POSITIVE_INFINITY : Date.parse(league.kickoffAt));
  const draftFirst = (league: HomeLeagueCard): 0 | 1 => (league.nextAction?.kind === "join-draft" ? 0 : 1);

  const byBoardOrder = sortLeagues(leagues);
  const byKickoff = [...byBoardOrder].sort((a, b) => kickoffMs(a) - kickoffMs(b));
  return [...byKickoff].sort((a, b) => draftFirst(a) - draftFirst(b));
}

/**
 * The needs-you set, in the SAME two kinds the rail's own `stateFor`
 * (`@/components/app-shell/shell-data`) treats as needs-you (F1): `fix-lineup` and `join-draft`.
 * Pure and derived-only — a league drops out the instant its own `nextAction.kind` stops being
 * one of these two, never because something was dismissed. Returns every needs-you league, in
 * urgency order (`urgencyOrder`, above) — uncapped: `AttentionQueue` owns how many of these it
 * actually renders (LED-1), so this stays the one true derivation a caller can also use to know
 * the real count behind the cap.
 */
export function attentionQueueItemsFrom(leagues: readonly HomeLeagueCard[]): readonly AttentionQueueItem[] {
  const needsYou = leagues.filter((league) => league.nextAction?.kind === "fix-lineup" || league.nextAction?.kind === "join-draft");
  return urgencyOrder(needsYou).map((league) => ({ leagueId: league.id, leagueName: league.name, label: league.nextAction!.label, href: actionHref(league) }));
}

export interface AttentionQueueProps {
  readonly items: readonly AttentionQueueItem[];
}

/**
 * The needs-you chips (Phase 3.6, Task 10, Step 1; capped and ordered per LED-1, 2026-08-24).
 * No chip carries a dismiss affordance (locker-room-panel.md, HIGH): every chip is DERIVED from
 * an unfinished action (`attentionQueueItemsFrom`, above), so finishing the action — setting the
 * lineup, joining the draft — is what removes it, and an un-actionable chip never renders in the
 * first place. There is no snooze, no local storage, no seen-flag: the queue is exactly as long
 * as the list of things still genuinely unfinished, capped for display.
 *
 * The cap is THIS component's own (LED-1): the gauntlet found thirty-three chips, five rows deep,
 * above a board whose own Action column already restates every one of them — the queue is meant
 * to be the veteran's under-a-second glance, not a second board. `items` arrives already in
 * urgency order, so slicing to `LEAGUE_ROOM_CONFIG.attentionQueueCap` keeps exactly the most
 * urgent chips; the plain sentence below names the real remainder rather than a vague "more."
 *
 * S10 (Task 9, founder-delegated design ruling): the locker room's ONE ink action is this queue's
 * TOP item — the surface's genuinely most urgent act, already sorted to the front by
 * `attentionQueueItemsFrom`'s own urgency order. Every other chip, in this queue or the board
 * below, stays quiet (rule 5). Both pills route through `buttonClassName` (never a hand-rolled
 * class string) so the ink fill can never drift from the one spelling the accent-budget sweep
 * allows (`button.tsx`'s own docblock).
 */
export function AttentionQueue({ items }: AttentionQueueProps) {
  if (items.length === 0) return null;
  const shown = items.slice(0, LEAGUE_ROOM_CONFIG.attentionQueueCap);
  const remaining = items.length - shown.length;
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label="Needs you" className="flex flex-wrap gap-2">
        {shown.map((item, index) => (
          <li key={item.leagueId}>
            <Link
              href={item.href}
              aria-label={`${item.label} for ${item.leagueName}`}
              className={buttonClassName(index === 0 ? "primary" : "secondary", "sm")}
            >
              <span aria-hidden="true" className={EYEBROW}>
                {item.leagueName}
              </span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
      {remaining > 0 ? <p className="text-sm text-text-muted">{`And ${remaining} more in the board below.`}</p> : null}
    </div>
  );
}
