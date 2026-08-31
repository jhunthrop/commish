import Link from "next/link";
import { Crest } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { MatchupDetail } from "../contract";
import { formatPoints } from "../lib/format";

/**
 * AROUND THE LEAGUE (the tab loop, 2026-08-30: "maximize the space and make the best possible
 * UX"). Every OTHER matchup this week as a row of mini score bugs under the viewer's own game —
 * the strip every incumbent runs, because a fantasy week is a slate, not one fixture. Real
 * scores off the same read the slate already paid for; the winner's figure is the bright one,
 * a scoreless game prints dashes, and every bug links to the full matchup page.
 */
export function WeekSlateStrip({
  matchups,
  myTeamId,
  leagueId,
}: {
  readonly matchups: readonly MatchupDetail[];
  readonly myTeamId: string | null;
  readonly leagueId: string;
}) {
  const others = matchups.filter((game) => game.home.teamId !== myTeamId && game.away.teamId !== myTeamId);
  if (others.length === 0) return null;
  return (
    <section aria-label="Around the league" className="flex flex-col gap-2">
      <h3 className={`${MICRO_LABEL} text-text-faint`}>Around the league</h3>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {others.map((game) => {
          const decided = game.home.score !== null && game.away.score !== null;
          const homeWon = decided && game.home.score! > game.away.score!;
          const awayWon = decided && game.away.score! > game.home.score!;
          const sideRow = (side: MatchupDetail["home"], won: boolean) => (
            <span className="flex min-w-0 items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <Crest id={side.teamId} name={side.teamName} size={22} />
                <span className={`truncate text-sm ${won ? "font-semibold text-text-primary" : "text-text-muted"}`}>{side.teamName}</span>
              </span>
              <span className={`shrink-0 font-display tabular-nums ${won ? "text-lg font-bold text-text-primary" : "text-base font-semibold text-text-muted"}`}>
                {side.score === null ? "\u2014" : formatPoints(side.score)}
              </span>
            </span>
          );
          return (
            <Link
              key={`${game.home.teamId}-${game.away.teamId}`}
              href={`/app/leagues/${leagueId}/matchups/${game.weekNumber}`}
              className="flex flex-col gap-1.5 rounded-md border border-line bg-surface-elevated px-3 py-2.5 transition-colors hover:border-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {sideRow(game.home, homeWon)}
              {sideRow(game.away, awayWon)}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
