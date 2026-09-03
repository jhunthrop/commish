import { Badge } from "@/components/ui";
import type { LeagueHomeBody } from "../contract";
import { formatRecord, formatWeek, ordinal } from "../lib/format";

export interface RoomWeekStripProps {
  readonly home: LeagueHomeBody;
  /** How many cards the attention stage is dealing — 0 hides the chip. */
  readonly attentionCount: number;
  /** Games not yet final while the week is live; null outside a live week. */
  readonly gamesLive: number | null;
}

/**
 * THE LEAGUE'S SLIM CLOCK — the one strip that persists across every stage and drawer height.
 * League name, the week and its state, the viewer's own seat, and the one amber chip that says
 * how many things need them. Facts only, every one already computed server-side.
 */
export function RoomWeekStrip({ home, attentionCount, gamesLive }: RoomWeekStripProps) {
  const live = home.weekStatus === "in_progress";
  const myRow = home.standings.find((row) => row.teamId === home.myTeamId) ?? null;
  const played = myRow !== null && myRow.wins + myRow.losses + myRow.ties > 0;

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface-elevated px-4 py-2">
      <h1 className="font-display text-lg font-semibold tracking-tight text-text-primary">{home.name}</h1>
      <Badge tone="neutral">{formatWeek(home.currentWeek)}</Badge>
      {live ? (
        <Badge tone="warning" glow>
          {gamesLive === null || gamesLive === 0 ? "Live" : `Live · ${gamesLive} ${gamesLive === 1 ? "game" : "games"}`}
        </Badge>
      ) : (
        <span className="hidden text-xs text-text-faint sm:inline">Lineups lock at each kickoff</span>
      )}
      <div className="ml-auto flex items-center gap-3">
        {myRow !== null && played ? (
          <span className="font-mono text-sm text-text-muted">
            {ordinal(myRow.rank)} of {home.teamCount} · {formatRecord(myRow)}
          </span>
        ) : null}
        {attentionCount > 0 && !live ? (
          <Badge tone="accent" glow>
            {attentionCount === 1 ? "1 thing needs you" : `${attentionCount} things need you`}
          </Badge>
        ) : null}
      </div>
    </header>
  );
}
