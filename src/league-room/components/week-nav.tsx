import Link from "next/link";
import { formatWeek } from "../lib/format";

/** Previous / next week links, clamped to the season. Plain links — no client state needed. */
export function WeekNav({ leagueId, weekNumber, totalWeeks }: { readonly leagueId: string; readonly weekNumber: number; readonly totalWeeks: number }) {
  const href = (week: number) => `/app/leagues/${leagueId}/matchups/${week}`;
  return (
    <nav className="flex items-center gap-3 text-sm" aria-label="Weeks">
      {weekNumber > 1 ? (
        <Link className="text-accent underline" href={href(weekNumber - 1)}>
          {`← ${formatWeek(weekNumber - 1)}`}
        </Link>
      ) : null}
      <span className="text-text-muted">{`${formatWeek(weekNumber)} of ${totalWeeks}`}</span>
      {weekNumber < totalWeeks ? (
        <Link className="text-accent underline" href={href(weekNumber + 1)}>
          {`${formatWeek(weekNumber + 1)} →`}
        </Link>
      ) : null}
    </nav>
  );
}
