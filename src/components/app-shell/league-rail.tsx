"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { Crest } from "@/components/ui/crest";
import { UI_CONFIG } from "@/components/ui/config";
import { NEXT_ACTION_COPY } from "@/league";
import type { RailLeague, RailLeagueState } from "./shell-data";

/**
 * `"live"`'s accessible-name fragment, reusing `NEXT_ACTION_COPY` (`@/league/next-action.ts`)
 * rather than typing a second copy of the same words — C2's "one string COPY owns" rule applies
 * here exactly as it does to the board cell. `"needs-you"` is NOT in this map: it can mean either
 * of two kinds (`"fix-lineup"` or `"join-draft"`, Task 10 Step 1b, F1) and a fixed one-sentence
 * map cannot tell them apart — `labelFor`, below, reads `league.needsYouKind` for that state
 * instead (fix round 1, H1: this map used to hardcode `"needs-you"` to `NEXT_ACTION_COPY["join-
 * draft"]`, so a manager whose lineup was unset heard "Join the draft" — false).
 */
const STATE_LABEL: Readonly<Partial<Record<RailLeagueState, string>>> = {
  live: NEXT_ACTION_COPY["watch-scores"],
};

/** The dot's own color — `aria-hidden` always, per Step 3: a colored dot with no sentence
 *  behind it is never rendered, and the sentence lives in the link's accessible name instead. */
const DOT_CLASS: Readonly<Partial<Record<RailLeagueState, string>>> = {
  "needs-you": "bg-warning",
  live: "bg-positive",
};

/** `"needs-you"`'s own accessible-name fragment: `league.needsYouKind` names WHICH of the two
 *  facts is true for this league, and `NEXT_ACTION_COPY` owns both sentences (C2) — never a
 *  second, narrower copy of either typed here. */
function labelFor(league: RailLeague): string | undefined {
  if (league.state === "needs-you") {
    return league.needsYouKind === null ? undefined : NEXT_ACTION_COPY[league.needsYouKind];
  }
  return STATE_LABEL[league.state];
}

/** "Bay Bandits" (quiet) → "Bay Bandits". "Volt Kings" (needs-you, fix-lineup) → "Volt Kings.
 *  Fix your lineup." — the accessible name is the league's real name, never its initials (Step
 *  1's own test): the crest tile's two-letter text is `aria-hidden`, so only this string is
 *  announced. */
function accessibleNameFor(league: RailLeague): string {
  const label = labelFor(league);
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
      // lg: the rail scrolls INSIDE itself, capped at the viewport and stuck to it (lobby
      // review E11): unbounded, a long account's rail dragged the whole document thousands of
      // px past the page's own content — the void below every short page. Sticky keeps the
      // rail in reach while the main column scrolls, the same scroll-inside rule every other
      // outgrowing region already keeps.
      className={`flex flex-row items-center gap-2 overflow-x-auto border-b border-line bg-surface px-3 py-2 lg:sticky lg:top-0 lg:max-h-dvh lg:flex-col lg:items-stretch lg:self-start lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-2 lg:py-4 ${className}`}
    >
      {leagues.map((league) => {
        const isCurrent = pathname?.startsWith(`/app/leagues/${league.id}`) ?? false;
        return (
          <Link
            key={league.id}
            href={`/app/leagues/${league.id}`}
            aria-current={isCurrent ? "page" : undefined}
            aria-label={accessibleNameFor(league)}
            // D4: the one persistent navigation in the product had no visual "you are here" —
            // `aria-current="page"` was set but every tile shared one class string. The current
            // tile now carries the product's own selected idiom (`ThemeSwitcher`'s checked chip,
            // `src/account-room/components/theme-switcher.tsx`: `ring-1 ring-edge` plus a surface
            // step the tile itself cannot swallow), an `<Crest>`-sized ring rather than a change
            // to `Crest`'s own tone fill, which stays the league's deterministic color either way.
            className={`relative flex shrink-0 items-center justify-center self-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              isCurrent ? "ring-2 ring-edge ring-offset-2 ring-offset-surface" : ""
            }`}
            style={tileStyle}
          >
            <Crest id={league.id} name={league.name} size={crestSize} />
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
