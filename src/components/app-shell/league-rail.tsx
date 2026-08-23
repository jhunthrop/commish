"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { UI_CONFIG } from "@/components/ui/config";
import type { AvatarTone } from "@/identity/avatars";
import { NEXT_ACTION_COPY } from "@/league";
import type { RailLeague, RailLeagueState } from "./shell-data";

/**
 * Each non-`"quiet"` state's accessible-name fragment, reusing `NEXT_ACTION_COPY` (`@/league/
 * next-action.ts`) rather than typing a second copy of the same words — C2's "one string COPY
 * owns" rule applies here exactly as it does to the board cell.
 *
 * `"needs-you"` can only mean `"join-draft"` today, because `"fix-lineup"` does not exist until
 * Task 10 Step 1b (F1). Once it does, TWO kinds will share this one state, and this fixed
 * one-sentence map will need to become kind-aware — flagged here for whoever lands that task,
 * since a `"needs-you"` league will then need `nextAction.kind` carried alongside `state`,
 * which `RailLeague` deliberately does not do yet.
 */
const STATE_LABEL: Readonly<Partial<Record<RailLeagueState, string>>> = {
  "needs-you": NEXT_ACTION_COPY["join-draft"],
  live: NEXT_ACTION_COPY["watch-scores"],
};

/** The dot's own color — `aria-hidden` always, per Step 3: a colored dot with no sentence
 *  behind it is never rendered, and the sentence lives in the link's accessible name instead. */
const DOT_CLASS: Readonly<Partial<Record<RailLeagueState, string>>> = {
  "needs-you": "bg-warning",
  live: "bg-positive",
};

/**
 * A tone's tile classes — the same five-role mapping `Avatar`'s own `TONE` const uses for a
 * preset fill, reproduced here rather than imported: Task 3's `Crest` primitive is the real,
 * shared version of this tile (it grows `AvatarTone` to six and becomes the one crest renderer
 * for both a league and a member); this is the interim until that task lands.
 */
const CREST_TONE_CLASS: Readonly<Record<AvatarTone, string>> = {
  accent: "bg-accent text-accent-text",
  negative: "bg-negative text-negative-text",
  positive: "bg-surface-elevated text-positive",
  warning: "bg-surface-elevated text-warning",
  neutral: "bg-surface-elevated text-text-muted",
};

/** "Bay Bandits" (quiet) → "Bay Bandits". "Volt Kings" (needs-you) → "Volt Kings. Join the
 *  draft." — the accessible name is the league's real name, never its initials (Step 1's own
 *  test): the crest tile's two-letter text is `aria-hidden`, so only this string is announced. */
function accessibleNameFor(league: RailLeague): string {
  const label = STATE_LABEL[league.state];
  return label === undefined ? league.name : `${league.name}. ${label}.`;
}

export interface LeagueRailProps {
  readonly leagues: readonly RailLeague[];
  readonly className?: string;
}

/**
 * The league rail: one `<nav>`, one tile per league plus a trailing "join or create another
 * league" control (Step 6's `plus` icon). A client component because `aria-current` is read off
 * `usePathname()` (ruling 8, as amended) — the fact a layout cannot otherwise have without a
 * per-page `currentLeagueId` prop, and the reason the shell can live in a layout at all.
 *
 * Always `overflow-x-auto` and never `hidden` at any breakpoint (Step 1's 360px test): below
 * `lg` this is a horizontal scrolling strip; at `lg` it becomes the vertical rail, the same
 * markup re-flowed rather than a second, narrower copy of it.
 */
export function LeagueRail({ leagues, className = "" }: LeagueRailProps) {
  const pathname = usePathname();
  const crestSize = UI_CONFIG.shell.crestSizePx;
  const tileStyle = { width: crestSize, height: crestSize };

  return (
    <nav
      aria-label="Your leagues"
      data-testid="league-rail"
      className={`flex flex-row items-center gap-2 overflow-x-auto border-b border-line bg-surface px-3 py-2 lg:flex-col lg:items-stretch lg:overflow-visible lg:border-b-0 lg:border-r lg:px-2 lg:py-4 ${className}`}
    >
      {leagues.map((league) => {
        const isCurrent = pathname?.startsWith(`/app/leagues/${league.id}`) ?? false;
        return (
          <Link
            key={league.id}
            href={`/app/leagues/${league.id}`}
            aria-current={isCurrent ? "page" : undefined}
            aria-label={accessibleNameFor(league)}
            className="relative flex shrink-0 items-center justify-center self-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={tileStyle}
          >
            <span
              aria-hidden="true"
              className={`flex size-full items-center justify-center rounded-md border border-line font-display text-xs font-semibold uppercase ${CREST_TONE_CLASS[league.tone]}`}
            >
              {league.shortName}
            </span>
            {league.state === "quiet" ? null : (
              <span aria-hidden="true" className={`absolute -right-0.5 -top-0.5 size-2.5 rounded-pill border border-surface ${DOT_CLASS[league.state]}`} />
            )}
          </Link>
        );
      })}
      <Link
        href="/app#create-league"
        aria-label="Join or create another league"
        className="flex shrink-0 items-center justify-center self-center rounded-md border border-dashed border-line text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        style={tileStyle}
      >
        <Icon name="plus" size={18} />
      </Link>
    </nav>
  );
}
