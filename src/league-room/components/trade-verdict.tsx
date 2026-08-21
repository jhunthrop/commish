import type { TradeVerdict as TradeVerdictUnion } from "@/trades/fairness";
import { formatPoints } from "../lib/format";

/** The slice of `TradeAssessmentBody`/`TradeBalance` this component needs — structurally
 *  satisfied by both `POST /api/leagues/[leagueId]/advisor/trade`'s response (`TradeAssessmentBody`,
 *  `../contract`) and `POST /api/leagues/[leagueId]/trades`'s own propose-time `verdict`
 *  (`TradeBalance`, `@/trades/fairness`) — the two moments this plan's own docblock says the
 *  advisor route finally has a caller for, so one component renders both without either caller
 *  reshaping its response first. */
export interface TradeAssessmentSummary {
  readonly verdict: TradeVerdictUnion;
  readonly givingValue: number;
  readonly receivingValue: number;
}

export interface TradeVerdictProps {
  readonly assessment: TradeAssessmentSummary;
}

/**
 * ONE sentence per verdict, written here rather than left to the advisor's own LLM prose
 * (`TradeAssessmentBody.headline`/`.reasoning`, shown separately in `TradeComposer`) — the
 * platform's own fairness read is a fixed, deterministic vocabulary
 * (`tradeBalance`, `@/trades/fairness`) and a member-facing surface says so in the same words
 * every time, never the raw `TradeFlag` names (`value_gap_over_threshold` and friends) a
 * member has no reason to see — those stay the operator's own vocabulary (Task 6's detector
 * reads the identical `tradeBalance` output and keeps its words to itself).
 */
const VERDICT_SUMMARY: Readonly<Record<TradeVerdictUnion, string>> = {
  even: "This is close to even in weekly production.",
  favors_proposer: "This favors what you would get back, in weekly production.",
  favors_receiver: "This favors what you would give up, in weekly production.",
  lopsided: "This is a long way from even in weekly production.",
};

/**
 * The platform's own advisory fairness read, rendered where a manager can act on it — beside the
 * accept control, never instead of it (`TradeCard`). Advisory only: nothing here disables
 * anything, which is what keeps the model in "writes prose about a decision `tradeBalance`
 * already computed" rather than making the decision itself (strategy doc §4.1,
 * `advisory-only.test.ts`).
 */
export function TradeVerdict({ assessment }: TradeVerdictProps) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-elevated p-3">
      <p className="text-sm font-medium text-text-primary">{VERDICT_SUMMARY[assessment.verdict]}</p>
      <p className="text-sm text-text-muted">
        {`${formatPoints(assessment.givingValue)} points a week going out, ${formatPoints(assessment.receivingValue)} points a week coming back.`}
      </p>
      <p className="text-xs text-text-muted">Advice only. You decide.</p>
    </div>
  );
}
