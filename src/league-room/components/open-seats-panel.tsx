import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { OpenLeagueCard } from "./open-league-card";

export interface OpenSeatsPanelProps {
  readonly leagues: readonly PublicLeagueSummary[];
  /** A quieter heading for a manager with one league and no completed draft (Step 4) — the
   *  panel still renders below the fold, it simply does not compete for the eye with the
   *  pre-draft hero above it. */
  readonly quiet?: boolean;
}

/**
 * The house shelf, on the home screen (Phase 3.6, Task 10, Step 4) — the founder's core-
 * experience ruling ("the house always has a game") made visible on the screen a manager already
 * lives on, not just on `/browse`. Renders BELOW the board always, `null` when `leagues` is
 * empty (the reconciler has not run yet), and never renders at all when `firstRun !== null`
 * (F18b) — that decision belongs to `HomeBoard`, the one place that holds `firstRun`, since
 * `FirstRunPanel`'s own three paths already open with "find an open league", which IS this
 * shelf, and showing it twice on one screen is the same offer competing with itself.
 *
 * Every card is `OpenLeagueCard` (Task 5) — the same card `/browse` and the front door render —
 * so its seat count is `SeatMeter`, never a fourth phrasing (F17); this panel writes no seat
 * sentence of its own.
 */
export function OpenSeatsPanel({ leagues, quiet = false }: OpenSeatsPanelProps) {
  if (leagues.length === 0) return null;
  const Heading = quiet ? "h3" : "h2";
  return (
    <section aria-label="Open leagues" className="flex flex-col gap-3">
      <Heading
        className={
          quiet
            ? "text-sm font-medium text-text-muted"
            : "font-display text-lg font-bold uppercase leading-display text-text-primary"
        }
      >
        Open leagues
      </Heading>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {leagues.map((league) => (
          <li key={league.id} className="min-w-0">
            <OpenLeagueCard league={league} signedIn />
          </li>
        ))}
      </ul>
      <p className="text-sm text-text-muted">The house always has a game.</p>
    </section>
  );
}
