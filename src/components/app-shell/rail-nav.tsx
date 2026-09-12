"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RAIL_LABEL } from "@/components/ui/config";

interface RailDestination {
  readonly href: string;
  readonly label: string;
  /** Path prefixes that light this label's here-marker beyond its own href. */
  readonly also?: readonly string[];
}

/**
 * The signed-in rail's destinations: LEAGUES, DRAFT, WALLET. Three real places, in the rail
 * register, with the amber underline marking the page under the reader's feet. Profile is
 * deliberately absent: a broadcast rail lists destinations, not settings, and the avatar beside
 * this nav is the door to who you are.
 *
 * ROOMS LEFT (the Draft area round, 2026-09-12). It named the practice lobby and, through its
 * `also`, live draft rooms — two different things under one word, and the lobby is now the Draft
 * area's own third stop, where practice belongs: beside the board and the sheet a manager
 * practices with. Draft opens on the board, which is what a reader who taps that word wants.
 *
 * THE DOOR INTO A LIVE ROOM IS NOT LOST WITH IT: `ScheduledLine` (`@/draft-hq/scheduled-line`)
 * sits on both board stops and widens to "is drafting now" for a league of yours already under
 * way, which is the reason that line widened at all.
 *
 * `/app/drafts/[draftId]` stays OFF this list on purpose: a draft room is a place you are IN,
 * reached from the league or the line that announces it, never a standing destination — and it
 * is a literal prefix away from `/app/draft`, which is the collision `pathIsUnder` exists for.
 */
const DESTINATIONS: readonly RailDestination[] = [
  { href: "/app", label: "Leagues", also: ["/app/leagues"] },
  { href: "/app/draft", label: "Draft", also: ["/app/drafts"] },
  { href: "/app/wallet", label: "Wallet" },
];

/**
 * A path is "under" a prefix only at a real segment boundary — an EXACT match, or the prefix
 * followed by `/`. Fix round 1, HIGH 1: bare `pathname.startsWith(prefix)` treats
 * `/app/drafts/abc123` as starting with `/app/draft`, one string being a character-for-character
 * prefix of the other with no `/` between them — so a live draft room lit BOTH Draft and Rooms
 * at once, breaking the v5 one-here-marker law on the product's highest-traffic page. Every
 * destination and every `also` prefix goes through this one boundary-safe check now, not just
 * the ones a reviewer happened to test.
 */
function pathIsUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Client-side only because the here-marker needs the live pathname; the list itself is static. */
export function RailNav({ className = "" }: { readonly className?: string }) {
  const pathname = usePathname();

  const activeOf = (destination: RailDestination): boolean => {
    // `usePathname()` is typed non-null but genuinely returns null outside a route context
    // (jsdom tests render this bar directly) — the same `?.` guard `LeagueRail` has always
    // carried; a bar with no pathname simply marks nothing as here.
    if (pathname === null) return false;
    // `/app` is a literal prefix of every signed-in route, so its OWN href can never use the
    // boundary-safe prefix check the way every other destination does — that would light
    // Leagues on `/app/wallet` too. It only ever matches exactly, or through its own `also` list.
    if (destination.href === "/app") {
      return pathname === "/app" || (destination.also ?? []).some((prefix) => pathIsUnder(pathname, prefix));
    }
    return pathIsUnder(pathname, destination.href) || (destination.also ?? []).some((prefix) => pathIsUnder(pathname, prefix));
  };

  return (
    <nav aria-label="Commish" className={`items-center gap-6 ${RAIL_LABEL} text-text-muted ${className}`}>
      {DESTINATIONS.map((destination) => {
        const active = activeOf(destination);
        return (
          <Link
            key={destination.href}
            href={destination.href}
            aria-current={active ? "page" : undefined}
            className={`pb-0.5 transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              active ? "text-text-primary shadow-[inset_0_-2px_0_0_var(--commish-color-accent)]" : ""
            }`}
          >
            {destination.label}
          </Link>
        );
      })}
    </nav>
  );
}
