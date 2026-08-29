"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RAIL_LABEL } from "@/components/ui/config";

export type LeagueTab = "matchup" | "standings" | "team" | "trades" | "activity";

/**
 * THE LEAGUE'S OWN RAIL (founder, 2026-08-28: "the center viewport should be a tab based
 * approach with standings, rosters, free agents, matchup").
 *
 * Tabs are ROUTES, not client state: deep-linkable, back-button honest, and walkable by the page
 * audit — every incumbent converged on this IA because a league is a multi-room product, and one
 * long scroll page made every visit pay for every room. The register is the top rail's own
 * (`RAIL_LABEL`, amber here-marker), one level down, so the two rails read as one chrome system
 * at two scopes.
 *
 * TWO ABSENCES ARE DECISIONS. Chat is not a tab — it is ambient life and lives in the persistent
 * right rail on every tab. FREE AGENTS is not here because free agency does not exist yet: the
 * player pool is real, waiver claims are not, and the nav never advertises an empty room (the D3
 * rule Reviews and The Board already follow). It takes its place in this list the day the claim
 * flow ships.
 *
 * "My team" and not "Roster": the manager's word for the thing, and the page carries the lineup
 * editor — which is a decision surface, not a list.
 */
const TABS: readonly { readonly tab: LeagueTab; readonly label: string; readonly segment: string }[] = [
  { tab: "matchup", label: "Matchup", segment: "" },
  { tab: "standings", label: "Standings", segment: "/standings" },
  { tab: "team", label: "My team", segment: "/team" },
  { tab: "trades", label: "Trades", segment: "/trades" },
  { tab: "activity", label: "Activity", segment: "/activity" },
];

export function LeagueTabs({ leagueId, active }: { readonly leagueId: string; readonly active: LeagueTab }) {
  // `usePathname` keeps the here-marker honest even where a caller forgets to update `active`
  // after a route move — the pathname wins a disagreement, since it cannot be stale.
  const pathname = usePathname();
  const base = `/app/leagues/${leagueId}`;
  return (
    <nav aria-label="League" className={`flex flex-wrap items-center gap-5 border-b border-line pb-2 ${RAIL_LABEL} text-text-muted`}>
      {TABS.map(({ tab, label, segment }) => {
        const href = `${base}${segment}`;
        const current = pathname === href || (segment === "" && pathname.startsWith(`${base}/matchups`)) || tab === active && pathname === href;
        return (
          <Link
            key={tab}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`pb-1 transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              current ? "text-text-primary shadow-[inset_0_-2px_0_0_var(--commish-color-accent)]" : ""
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
