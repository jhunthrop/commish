import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { LeagueRow, LeagueRowsHeader } from "./league-row";
import { OpenLeagueCard } from "./open-league-card";

export interface OpenSeatsPanelProps {
  readonly leagues: readonly PublicLeagueSummary[];
  /** A quieter heading for a manager with one league and no completed draft (Step 4) — the
   *  panel still renders below the fold, it simply does not compete for the eye with the
   *  pre-draft hero above it. */
  readonly quiet?: boolean;
  /** D1/E7: the signed-in member's own stored preference, threaded from the home page's
   *  `readPreferences` read — a guided-preference member keeps inline captions on the CARD
   *  form; the row form never prints a caption inline (Task 13's rule, unchanged here). */
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
 * ROWS ON lg+, CARDS BELOW (Phase 3.7, Task 12 — persona-checkpoint adjudication, delegated):
 * the founder's rows order ("horizontal row elements instead of these cards - my eyes don't
 * know where to focus", 2026-08-24) named the card-grid FORM at desktop widths, not the page it
 * happened to be on — and this panel sits under a league TABLE, where a card grid is the same
 * focus failure twice over. Both forms come from `open-league-shared.tsx` via `LeagueRow` /
 * `OpenLeagueCard` (Task 13's one-source split), so this panel writes no seat sentence and no
 * derived fact of its own (F17). One deliberate difference from `OpenLeagueShelf`: NO featured
 * league — rule 5 gives this view's one ink action to the attention queue's top item (S10), so
 * every CTA here is the quiet pill in both renderings.
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
            : "font-display text-lg font-semibold leading-display text-text-primary"
        }
      >
        Open leagues
      </Heading>
      <div data-testid="league-rows" className="hidden lg:block">
        <LeagueRowsHeader />
        <ul className="flex flex-col">
          {leagues.map((league, index) => (
            <li key={league.id}>
              {/* Ordered the same way the storefront board is: this panel's caller already sorts
                  by seats remaining, so the first row is the room closest to firing and takes
                  the amber wash. The position NUMERAL left with P1 (`LEAGUE_ROW_GRID`). */}
              <LeagueRow league={league} signedIn emphasis="quiet" leader={index === 0 && league.filledTeams > 0} />
            </li>
          ))}
        </ul>
      </div>
      {/* Below lg the ledger card IS the form (Task 13) — a six-column row cannot fit 360px.
          The old lg:grid-cols-3 tier left with the rows ruling: this grid never renders at lg+. */}
      <ul data-testid="league-cards" className="grid gap-3 sm:grid-cols-2 lg:hidden">
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
