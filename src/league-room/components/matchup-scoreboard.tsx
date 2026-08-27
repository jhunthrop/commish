import type { MatchupSummary } from "../contract";
import { Card, EYEBROW } from "@/components/ui";
import { formatPoints } from "../lib/format";
import { WeekStatusBadge } from "./week-status-badge";

export interface MatchupScoreboardProps {
  readonly matchup: MatchupSummary;
  readonly myTeamId: string | null;
  /** E1(a)/(c): the week's own games-final count, folded from the live socket
   *  (`use-live-scores.ts`) upstream — optional so `HomeLeagueCard`/`LeagueHome`, the scoreboard's
   *  other two callers, are unaffected; the matchup page (`MatchupPanel`) always supplies both. */
  readonly gamesFinal?: number;
  readonly gamesTotal?: number;
}

/** E1(a)+(c): "You are up 7.40. 6 of 13 games final." — the two facts the review named
 *  (`docs/research/2026-08-27-competition-review.md`, D2/E3) composed into one sentence, from
 *  data already on the wire: the margin is a plain subtraction of the two scores already on
 *  screen (the same arithmetic `league-board.tsx`'s own Margin column does), and the games-final
 *  count is the SAME pair `ScoreUpdatePayload` carries on every live frame. `null` when either
 *  score is not in yet — a margin needs two real numbers, never a guess against a `—`. */
function honestLine(matchup: MatchupSummary, myTeamId: string | null, gamesFinal: number | undefined, gamesTotal: number | undefined): string | null {
  const { homeScore, awayScore, homeTeamId, awayTeamId, homeTeamName, awayTeamName } = matchup;
  if (homeScore === null || awayScore === null) return null;
  const margin = formatPoints(Math.abs(homeScore - awayScore));
  const iAmHome = myTeamId === homeTeamId;
  const iAmAway = myTeamId === awayTeamId;

  let lead: string;
  if (homeScore === awayScore) {
    lead = iAmHome || iAmAway ? `You are tied at ${formatPoints(homeScore)}.` : `Tied at ${formatPoints(homeScore)} apiece.`;
  } else {
    const homeLeads = homeScore > awayScore;
    if (iAmHome || iAmAway) {
      const winning = (iAmHome && homeLeads) || (iAmAway && !homeLeads);
      lead = winning ? `You are up ${margin}.` : `You are down ${margin}.`;
    } else {
      lead = `${homeLeads ? homeTeamName : awayTeamName} leads by ${margin}.`;
    }
  }

  // `gamesTotal === 0` reads the same as "not provided" — a week with no `stat_weeks` row yet
  // has nothing honest to say about how many of zero games are final.
  if (gamesTotal === undefined || gamesTotal === 0) return lead;
  return `${lead} ${gamesFinal ?? 0} of ${gamesTotal} games final.`;
}

/**
 * The scoreboard poster — the league room's hero shape, shared by the league home and the
 * weekly matchup page so a score always looks like a score. Names in the display face,
 * numerals big and tabular; once a matchup is final the winner keeps full ink and the loser
 * recedes. Your own side carries the same "You" mark the draft board's column header wears
 * (Task 9: the caps charter treats DOM text as data, not CSS, so this was the one literal
 * left shouting after Task 3's class-level sweep — respelled sentence-case here to match).
 */
export function MatchupScoreboard({ matchup, myTeamId, gamesFinal, gamesTotal }: MatchupScoreboardProps) {
  const decided = matchup.final && matchup.homeScore !== null && matchup.awayScore !== null;
  const homeWon = decided && matchup.homeScore! > matchup.awayScore!;
  const awayWon = decided && matchup.awayScore! > matchup.homeScore!;
  const honest = honestLine(matchup, myTeamId, gamesFinal, gamesTotal);

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
      {/* E1(a)+(c) (D2/E3, competition review): the margin and the games-final count — both
          already on the wire, neither printed before this. Mono/tabular, no color: a record
          carries typographic weight, never a hue (the same register `league-board.tsx`'s own
          Margin column already keeps). */}
      {honest === null ? null : <p className="text-center text-sm font-mono tabular-nums text-text-muted">{honest}</p>}
    </Card>
  );
}
