"use client";

import { useRouter } from "next/navigation";
import { SegmentGroup } from "@/components/ui";

/**
 * THE PLAYER CARD'S SEASON SWITCHER (2026-09-04 widening: "make sure our player cards show prior
 * year data when the season hasn't started"). One segment per season `playerSeason` says it has
 * data for, newest first — the same `SegmentGroup` rail every other "pick one of a few" surface in
 * this product uses (`SegmentGroup`'s own docblock), never a hand-rolled second copy.
 *
 * PRESENTATIONAL ONLY. `onSelect` is the caller's business: the bottom-sheet peek
 * (`player-peek.tsx`) already holds client state and a fetch effect, so it wires this straight to
 * a `setState`; the full page is a Server Component and instead reaches for `PlayerPageSeasonSwitcher`
 * below, which owns the one thing a plain component cannot — a `router.push` across a server/client
 * boundary — and renders this underneath it.
 */
export function SeasonSwitcher({
  seasons,
  season,
  onSelect,
  className = "",
}: {
  readonly seasons: readonly number[];
  readonly season: number;
  readonly onSelect: (season: number) => void;
  readonly className?: string;
}) {
  return (
    <SegmentGroup
      label="Season"
      labelled={false}
      className={className}
      options={seasons.map((year) => ({ value: String(year), label: String(year) }))}
      value={String(season)}
      onChange={(value) => onSelect(Number(value))}
    />
  );
}

/**
 * THE FULL PAGE'S OWN WIRING — a Server Component (`players/[playerId]/page.tsx`) cannot hand a
 * Client Component a function prop, so the routing lives here instead of at the call site. Picking
 * a season replaces the `?season=` query param, which is what re-renders the server page with the
 * new season's `playerSeason` read; `router.push` (not `replace`) so the back button retraces a
 * manager's season browsing the same way it retraces everything else in this app.
 */
export function PlayerPageSeasonSwitcher({
  leagueId,
  playerId,
  seasons,
  season,
  className = "",
}: {
  readonly leagueId: string;
  readonly playerId: string;
  readonly seasons: readonly number[];
  readonly season: number;
  readonly className?: string;
}) {
  const router = useRouter();
  return (
    <SeasonSwitcher
      seasons={seasons}
      season={season}
      onSelect={(next) => router.push(`/app/leagues/${leagueId}/players/${playerId}?season=${next}`)}
      className={className}
    />
  );
}
