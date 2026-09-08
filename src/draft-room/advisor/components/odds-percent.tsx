import { survivalBand, type SurvivalBand } from "@/domain/draft-odds";
import type { SurvivalOdds } from "@/draft-service/assistant/view";
import { oddsTooltipText, percentText } from "../format";

export interface OddsPercentProps {
  readonly odds: SurvivalOdds;
  readonly playerId: string;
}

/** The three bands through the existing semantic inks: safe, the middle, a reach. */
const BAND_INK: Readonly<Record<SurvivalBand, string>> = {
  safe: "text-positive",
  middle: "text-warning",
  reach: "text-negative",
};

/**
 * A pool row's next-turn odds: a right-aligned percentage at a glance, the runs behind it in the
 * tooltip and for assistive tech. Renders nothing for a player the odds do not cover (already
 * gone), and the caller renders nothing at all when the viewer has no next turn.
 */
export function OddsPercent({ odds, playerId }: OddsPercentProps) {
  const survived = odds.survived[playerId];
  if (survived === undefined || odds.runs === 0) return null;
  const survival = survived / odds.runs;
  const band = survivalBand(survival);
  return (
    <span data-testid="advisor-odds-pct" data-band={band} title={oddsTooltipText(survived, odds.runs)} className={`w-10 shrink-0 text-right font-mono text-xs tabular-nums ${BAND_INK[band]}`}>
      <span aria-hidden="true">{percentText(survival)}</span>
      <span className="sr-only">{oddsTooltipText(survived, odds.runs)}</span>
    </span>
  );
}
