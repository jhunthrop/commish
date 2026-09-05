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
 * The signed-in rail's destinations (Sunday v5, founder-set 2026-08-28): LEAGUES, ROOMS,
 * WALLET. Three real places, in the rail register, with the amber underline marking the page
 * under the reader's feet.
 *
 * THE BOARD joins this list the day the public rankings page ships and not before — the nav
 * never advertises an empty room (the D3 rule Reviews already follows). Profile is deliberately
 * absent: a broadcast rail lists destinations, not settings, and the avatar beside this nav is
 * the door to who you are.
 *
 * THE BOARD JOINED THIS LIST (Draft HQ phase 1, 2026-09-04): `DRAFT` sits between Leagues and
 * Rooms — prepare in Draft, perform in Rooms — and the day named above has come. It is not an
 * empty room: HQ, The Board and My Sheet are real, league-aware surfaces from the day this
 * lands (`docs/superpowers/specs/2026-09-04-draft-hq-design.md`); the Simulator/Assistant/
 * Market/Playbook links behind it render an honest "arriving soon" state rather than fabricated
 * content, which is what keeps this addition inside the D3 rule rather than breaking it.
 *
 * ROOMS names where drafting happens — the practice lobby now, live rooms when you are in one.
 */
const DESTINATIONS: readonly RailDestination[] = [
  { href: "/app", label: "Leagues", also: ["/app/leagues"] },
  { href: "/app/draft", label: "Draft" },
  { href: "/app/mock-drafts", label: "Rooms", also: ["/app/drafts"] },
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
