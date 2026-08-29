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
 * ROOMS names where drafting happens — the practice lobby now, live rooms when you are in one.
 */
const DESTINATIONS: readonly RailDestination[] = [
  { href: "/app", label: "Leagues", also: ["/app/leagues"] },
  { href: "/app/mock-drafts", label: "Rooms", also: ["/app/drafts"] },
  { href: "/app/wallet", label: "Wallet" },
];

/** Client-side only because the here-marker needs the live pathname; the list itself is static. */
export function RailNav({ className = "" }: { readonly className?: string }) {
  const pathname = usePathname();

  const activeOf = (destination: RailDestination): boolean => {
    if (destination.href === "/app") {
      return pathname === "/app" || (destination.also ?? []).some((prefix) => pathname.startsWith(prefix));
    }
    return pathname.startsWith(destination.href) || (destination.also ?? []).some((prefix) => pathname.startsWith(prefix));
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
