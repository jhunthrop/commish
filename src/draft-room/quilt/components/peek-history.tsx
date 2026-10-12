"use client";

import type { Position } from "@research/domain/player";
import type { PlayerSeasonSummary } from "../../contract";
import { Skeleton } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { positionStickerClass } from "@/components/ui/position-badge";
import { QUILT_CONFIG } from "../state/config";
import type { PlayerHistoryState } from "../hooks/use-player-history";

export interface PeekHistoryProps {
  readonly state: PlayerHistoryState;
  readonly position: Position;
}

/**
 * THE DENSE HALF OF THE CARD (design ruling, 2026-09-02, restoring the `PlayerCard` mock's
 * tables): LAST THREE SEASONS and the week-by-week consistency strip, rendered from stored
 * weeks and nothing else. A rookie shows nothing, a one-season player shows one row, a fetch
 * still in flight shows a quiet skeleton, and a failed fetch shows the card without this
 * section at all — every branch is an honest statement about what the stores returned.
 */
export function PeekHistory({ state, position }: PeekHistoryProps) {
  if (state.status === "absent") return null;
  if (state.status === "loading") {
    return (
      <div data-testid="peek-history-loading" className="px-0">
        <Skeleton lines={3} />
      </div>
    );
  }
  const { seasons, latestWeekly, latestWeeklySeason } = state.body;
  if (seasons.length === 0) return null;

  const overBar = latestWeekly.filter((week) => week.points >= QUILT_CONFIG.weeklyGoodPoints).length;
  const maxPoints = Math.max(...latestWeekly.map((week) => week.points), QUILT_CONFIG.weeklyGoodPoints);

  return (
    <div data-testid="peek-history" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className={`${MICRO_LABEL} text-text-faint`}>{seasons.length === 1 ? "Last season" : `Last ${seasons.length} seasons`}</p>
        <div className="grid grid-cols-[44px_repeat(5,minmax(0,1fr))] gap-x-2 gap-y-1 rounded-sm bg-surface-raised px-3 py-2">
          <span />
          {["GP", "PPG", "YDS", "TD", "Finish"].map((column) => (
            <span key={column} className={`${MICRO_LABEL} text-right text-text-faint`}>
              {column}
            </span>
          ))}
          {seasons.map((row) => (
            <SeasonRow key={row.season} row={row} />
          ))}
        </div>
      </div>

      {latestWeekly.length === 0 || latestWeeklySeason === null ? null : (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <p className={`${MICRO_LABEL} text-text-faint`}>{latestWeeklySeason} week by week</p>
            <p className="text-xs text-text-faint">
              {overBar} of {latestWeekly.length} {latestWeekly.length === 1 ? "week" : "weeks"} over {QUILT_CONFIG.weeklyGoodPoints} pts
            </p>
          </div>
          <div data-testid="peek-weekly-bars" className="flex h-9 items-end gap-0.5">
            {latestWeekly.map((week) => (
              <span
                key={week.week}
                title={`Week ${week.week}: ${week.points} pts`}
                className={`min-h-0.5 flex-1 rounded-t-xs ${week.points >= QUILT_CONFIG.weeklyGoodPoints ? positionStickerClass(position) : "bg-line"}`}
                style={{ height: `${Math.max(6, Math.round((week.points / maxPoints) * 100))}%` }}
              >
                <span className="sr-only">{`Week ${week.week}: ${week.points} points`}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SeasonRow({ row }: { readonly row: PlayerSeasonSummary }) {
  return (
    <>
      <span className="font-mono text-xs text-text-muted tabular-nums">{row.season}</span>
      <span className="text-right font-mono text-xs text-text-primary tabular-nums">{row.gamesPlayed}</span>
      <span className="text-right font-mono text-xs font-semibold text-text-primary tabular-nums">{row.pointsPerGame.toFixed(1)}</span>
      <span className="text-right font-mono text-xs text-text-primary tabular-nums">{row.totalYards.toLocaleString("en-US")}</span>
      <span className="text-right font-mono text-xs text-text-primary tabular-nums">{row.totalTouchdowns}</span>
      <span className="text-right font-mono text-xs text-positive tabular-nums">{row.positionFinish}</span>
    </>
  );
}
