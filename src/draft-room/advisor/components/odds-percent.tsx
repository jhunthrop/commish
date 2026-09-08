import { survivalBand } from "@/domain/draft-odds";
import { Badge } from "@/components/ui";
import type { SurvivalOdds } from "@/draft-service/assistant/view";
import { oddsTooltipText, percentText } from "../format";

export interface OddsPercentProps {
  readonly odds: SurvivalOdds;
  readonly playerId: string;
}

/**
 * A pool row's next-turn odds: a right-aligned percentage at a glance, the runs behind it in the
 * tooltip and for assistive tech. Three bands (coordinator's ruling, fix round): the safe band is
 * a soft positive chip so good reads as good in both themes, the middle band is the product's
 * secondary ink (never the warning or live roles, which are the clock's alarm channel), and a
 * reach keeps the critical ink. Renders nothing for a player the odds do not cover (already
 * gone), and the caller renders nothing at all when the viewer has no next turn.
 */
export function OddsPercent({ odds, playerId }: OddsPercentProps) {
  const survived = odds.survived[playerId];
  if (survived === undefined || odds.runs === 0) return null;
  const survival = survived / odds.runs;
  const band = survivalBand(survival);
  const tooltip = oddsTooltipText(survived, odds.runs);
  const shared = { "data-testid": "advisor-odds-pct", "data-band": band, title: tooltip } as const;
  const label = (
    <>
      <span aria-hidden="true">{percentText(survival)}</span>
      <span className="sr-only">{tooltip}</span>
    </>
  );
  if (band === "safe") {
    return (
      <Badge tone="positive" soft {...shared} className="font-mono tabular-nums">
        {label}
      </Badge>
    );
  }
  return (
    <span {...shared} className={`w-10 shrink-0 text-right font-mono text-xs tabular-nums ${band === "reach" ? "text-negative" : "text-text-muted"}`}>
      {label}
    </span>
  );
}
