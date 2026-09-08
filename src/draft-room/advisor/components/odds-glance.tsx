import { survivalBand } from "@/domain/draft-odds";
import { Badge } from "@/components/ui";
import type { SurvivalOdds } from "@/draft-service/assistant/view";
import { oddsTooltipText, percentText, runsOverRuns } from "../format";

/** `percent` is a pool row's glance ("46%"), `runs` is the advisor's own row ("57 of 200"). */
export type OddsGlanceForm = "percent" | "runs";

export interface OddsGlanceProps {
  readonly odds: SurvivalOdds;
  readonly playerId: string;
  /** @default "percent" */
  readonly form?: OddsGlanceForm;
}

const TEST_ID: Readonly<Record<OddsGlanceForm, string>> = { percent: "advisor-odds-pct", runs: "advisor-odds-runs" };

/**
 * A player's next-turn odds at a glance, in one of two forms, with the runs behind it in the
 * tooltip and for assistive tech. Three bands (coordinator's ruling, fix round): the safe band is
 * a soft positive chip so good reads as good in both themes, the middle band is the product's
 * secondary ink (never the warning or live roles, which are the clock's alarm channel), and a
 * reach keeps the critical ink. Renders nothing for a player the odds do not cover (already
 * gone), and the caller renders nothing at all when the viewer has no next turn.
 */
export function OddsGlance({ odds, playerId, form = "percent" }: OddsGlanceProps) {
  const survived = odds.survived[playerId];
  if (survived === undefined || odds.runs === 0) return null;
  const survival = survived / odds.runs;
  const band = survivalBand(survival);
  const tooltip = oddsTooltipText(survived, odds.runs);
  const shared = { "data-testid": TEST_ID[form], "data-band": band, title: tooltip } as const;
  const label = (
    <>
      <span aria-hidden="true">{form === "percent" ? percentText(survival) : runsOverRuns(survived, odds.runs)}</span>
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
  const width = form === "percent" ? "w-10" : "w-20";
  return (
    <span {...shared} className={`${width} shrink-0 text-right font-mono text-xs tabular-nums ${band === "reach" ? "text-negative" : "text-text-muted"}`}>
      {label}
    </span>
  );
}
