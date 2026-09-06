import type { PlayerFactsRankedStat, PlayerFactsTrend, PlayerFactsUsage } from "@/capsules/facts";
import type { Position } from "@/domain/player";
import { Card, Stat } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";

export interface RoleModuleProps {
  /** Not part of the dossier plan's own two-prop shorthand, but required by the format it binds
   *  ("{POS}{rank} of {n}") — a share rank carries no position of its own, only his. Added here
   *  rather than assumed from context, since a presentational module should own every fact its
   *  own copy states. */
  readonly position: Position;
  /** `null` for a player the prior-season usage store carries nothing for (a rookie, most often)
   *  — every share row then reads "not tracked for him", the identical text an individually
   *  absent share already prints. */
  readonly usage: PlayerFactsUsage | null;
  readonly trend: PlayerFactsTrend | null;
}

interface ShareRow {
  readonly key: string;
  readonly label: string;
  readonly share: number | null;
  readonly rank: PlayerFactsRankedStat | null;
}

function shareRows(usage: PlayerFactsUsage | null): readonly ShareRow[] {
  return [
    { key: "snap", label: "Snap share", share: usage?.snapShare ?? null, rank: usage?.snapShareRank ?? null },
    { key: "target", label: "Target share", share: usage?.targetShare ?? null, rank: usage?.targetShareRank ?? null },
    { key: "redzone", label: "Red-zone share", share: usage?.redZoneShare ?? null, rank: usage?.redZoneShareRank ?? null },
  ];
}

/** "62% · RB4 of 32", or the honest "not tracked for him" — never a bar with no number beside it
 *  (`meter.tsx`'s own rule, kept here by hand since this is not a `Meter`). A share with no real
 *  rank (the store has the share itself but never ranked it) still states the raw percentage. */
function shareValueText(position: Position, share: number | null, rank: PlayerFactsRankedStat | null): string {
  if (share === null) return "not tracked for him";
  const pct = Math.round(share * 100);
  return rank === null ? `${pct}%` : `${pct}% · ${position}${rank.positionRank} of ${rank.qualifierCount}`;
}

/**
 * THE TREND SENTENCE — "18.1 a game in 2024 fell to 14.3 in 2025, down 3.8. A real move, not
 * noise." Rendered ONLY when `trend.pointsPerGame` is both present and `material` (`trend.ts`'s
 * own honesty rule: a delta this small against the position's real spread is noise, and this
 * sentence exists specifically to state the ones that are not). The delta figure is the ONE
 * number on this module carrying the magnitude channel — routed through `Stat`, the only file
 * this product lets name a `-mag-` colour (`magnitude-budget.source.test.ts`), never a hand-rolled
 * class here. `percentile` is chosen to land the rise/decline cleanly inside `Stat`'s own "good"
 * (rise) or "weak" (decline) bands rather than "strong"/"bad" — a year-over-year move earns
 * attention, not the ramp's most extreme step, which this module has no evidence to claim.
 */
function trendSentence(priorSeason: number, priorValue: number, recentSeason: number, recentValue: number, delta: number) {
  const rising = delta > 0;
  const direction = rising ? "up" : "down";
  const verb = rising ? "rose" : "fell";
  return {
    // The direction word rides INSIDE the tinted `Stat` value (`${direction} ${delta}`, "down
    // 3.8") rather than sitting in this plain-text lead-in — `Stat` always prefixes a caret to a
    // non-neutral value, and splitting the word from its number would put that caret between
    // "down" and "3.8" in the rendered text, breaking the phrase a reader (or a screen reader)
    // sees as one unit.
    before: `${priorValue} a game in ${priorSeason} ${verb} to ${recentValue} in ${recentSeason},`,
    delta: `${direction} ${Math.abs(delta)}`,
    percentile: rising ? 0.75 : 0.25,
  };
}

/**
 * THE ROLE MODULE (dossier plan, Task 4) — last season's usage, plain: a share bar per metric,
 * each stating its own percentage and position rank with the rank's own qualifier count, and the
 * year-over-year trend sentence when the store has one worth stating.
 *
 * ABSENCE IS A ROW, NOT A GAP — a share the store never tracked prints "not tracked for him" in
 * the same slot a real number would occupy, so the module's shape never depends on which shares
 * happen to exist. The trend line is genuinely absent (no row at all) when there is nothing
 * material to say, matching every other "nothing to say" surface on this product.
 */
export function RoleModule({ position, usage, trend }: RoleModuleProps) {
  const pointsPerGame = trend?.pointsPerGame ?? null;
  const trendMetric = pointsPerGame !== null && pointsPerGame.material ? pointsPerGame : null;

  return (
    <Card as="section" aria-label="Role" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {shareRows(usage).map((row) => {
          const pct = row.share === null ? 0 : Math.round(row.share * 100);
          return (
            <div key={row.key} className="flex flex-col gap-1" data-role-share={row.key}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className={`${MICRO_LABEL} text-text-faint`}>{row.label}</span>
                <span className="tabular-nums text-text-muted">{shareValueText(position, row.share, row.rank)}</span>
              </div>
              <div className="h-1.5 w-full rounded-pill bg-surface-inset">
                <div className="h-full rounded-pill bg-text-muted" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      {trendMetric === null ? null : (
        <p className="flex flex-wrap items-baseline gap-1 text-sm text-text-muted" data-role="trend">
          {(() => {
            const { before, delta, percentile } = trendSentence(trendMetric.priorSeason, trendMetric.priorValue, trendMetric.recentSeason, trendMetric.recentValue, trendMetric.delta);
            return (
              <>
                <span>{before}</span>
                <Stat
                  label="Year-over-year change"
                  srOnlyLabel
                  value={delta}
                  orientation="inline"
                  size="sm"
                  comparison={{ percentile, population: "the position's own year-over-year spread" }}
                />
                <span>. A real move, not noise.</span>
              </>
            );
          })()}
        </p>
      )}
    </Card>
  );
}
