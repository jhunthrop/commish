import type { MatchupSummary } from "../contract";
import { Card, EYEBROW } from "@/components/ui";
import { formatPoints } from "../lib/format";
import { WeekStatusBadge } from "./week-status-badge";

export interface MatchupScoreboardProps {
  readonly matchup: MatchupSummary;
  readonly myTeamId: string | null;
}

/**
 * The scoreboard poster — the league room's hero shape, shared by the league home and the
 * weekly matchup page so a score always looks like a score. Names in the display face,
 * numerals big and tabular; once a matchup is final the winner keeps full ink and the loser
 * recedes. Your own side carries the same "You" mark the draft board's column header wears
 * (Task 9: the caps charter treats DOM text as data, not CSS, so this was the one literal
 * left shouting after Task 3's class-level sweep — respelled sentence-case here to match).
 */
export function MatchupScoreboard({ matchup, myTeamId }: MatchupScoreboardProps) {
  const decided = matchup.final && matchup.homeScore !== null && matchup.awayScore !== null;
  const homeWon = decided && matchup.homeScore! > matchup.awayScore!;
  const awayWon = decided && matchup.awayScore! > matchup.homeScore!;

  const side = (name: string, score: number | null, teamId: string, won: boolean) => (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
      {/* `w-full`: this `<p>` sits in a `flex-col items-center` parent, whose cross-axis default
          (`align-items: center`) sizes flex children to their own content instead of stretching
          them — so `truncate`'s `overflow-hidden`/`ellipsis` never had a constrained box to clip
          against, and a long team name pushed the page wider at narrow viewports. `w-full` gives
          it the parent's actual (already-shrunk, `min-w-0 flex-1`) width to truncate against. */}
      <p className={`w-full truncate font-display text-xl font-semibold leading-display ${decided && !won ? "text-text-muted" : "text-text-primary"}`}>
        {name}
        {teamId === myTeamId ? <span className="ml-1.5 align-middle text-xs font-semibold text-accent">You</span> : null}
      </p>
      <p className={`font-display text-display-lg font-semibold tabular-nums leading-display ${decided && !won ? "text-text-muted" : "text-text-primary"}`}>
        {score === null ? "—" : formatPoints(score)}
      </p>
    </div>
  );

  return (
    // The week itself is NOT repeated here: every context that renders a scoreboard already
    // carries a week heading above it, and saying it twice reads like a template.
    <Card
      as="section"
      aria-label={`${matchup.homeTeamName} versus ${matchup.awayTeamName}`}
      className="flex flex-col gap-3"
    >
      <div className="flex items-center justify-end">
        {/* `weekStatus`, never `matchup.final`: a week can be `in_progress` for hours before
            `final` flips, and `final` alone can't tell that apart from `scheduled`. */}
        <WeekStatusBadge status={matchup.weekStatus} />
      </div>
      <div className="flex items-center gap-4">
        {side(matchup.homeTeamName, matchup.homeScore, matchup.homeTeamId, homeWon)}
        <span aria-hidden="true" className={`${EYEBROW} shrink-0`}>
          vs
        </span>
        {side(matchup.awayTeamName, matchup.awayScore, matchup.awayTeamId, awayWon)}
      </div>
    </Card>
  );
}
