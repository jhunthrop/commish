import { Button, Card } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { PendingWaiverClaim } from "@/league-service/claims";
import type { TradeProposalView } from "@/trades/contract";
import type { LeagueHomeBody, TradeRoomContext } from "../contract";
import { formatWeekdayClock, ordinal } from "../lib/format";
import type { LineupFixPlan } from "../lib/lineup-problems";
import { problemEvidence, problemHeadline, tradeEvidence, tradeHeadline } from "../lib/moment-copy";

export interface MomentVerbProps {
  readonly home: Pick<LeagueHomeBody, "rosterSlots">;
  readonly plans: readonly LineupFixPlan[];
  readonly inboxTrades: readonly TradeProposalView[];
  readonly tradeContext: TradeRoomContext | null;
  readonly pendingClaims: readonly PendingWaiverClaim[];
  readonly onFixLineup: (plan: LineupFixPlan) => void;
  readonly onViewTrade: (trade: TradeProposalView) => void;
}

/** The one act, decided the way the stage always has: an unlocked lineup problem outranks a
 *  trade offer, because a slot decays to zero at kickoff and an offer waits for its deadline. */
export function momentFor(plans: readonly LineupFixPlan[], inboxTrades: readonly TradeProposalView[]) {
  const plan = plans[0];
  if (plan !== undefined) return { kind: "lineup" as const, plan };
  const trade = inboxTrades[0];
  if (trade !== undefined) return { kind: "trade" as const, trade };
  return null;
}

function moreLine(plans: readonly LineupFixPlan[], inboxTrades: readonly TradeProposalView[], kind: "lineup" | "trade"): string | null {
  const otherSlots = kind === "lineup" ? plans.length - 1 : 0;
  const offers = kind === "lineup" ? inboxTrades.length : inboxTrades.length - 1;
  const parts = [
    otherSlots > 0 ? `${otherSlots} more ${otherSlots === 1 ? "slot" : "slots"} to fix` : null,
    offers > 0 ? `${offers} ${offers === 1 ? "trade offer" : "trade offers"} waiting` : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : `Then ${parts.join(" and ")}.`;
}

/**
 * ONE ACTION PER MOMENT (P3): the single solid Court blue pill on the league's front page, and
 * the sentence that earns it. Set your lineup when a slot is empty, on bye or ruled out; respond
 * to the offer when a trade is waiting on you. A claim already filed needs nothing, so it is a
 * quiet line. When nothing needs you the card does not render, and the stream's own Send is the
 * page's act.
 */
export function MomentVerb({ home, plans, inboxTrades, tradeContext, pendingClaims, onFixLineup, onViewTrade }: MomentVerbProps) {
  const moment = momentFor(plans, inboxTrades);
  if (moment === null && pendingClaims.length === 0) return null;
  return (
    <Card as="section" aria-label="What needs you" data-testid="moment-verb" className={`flex flex-col gap-3 ${moment === null ? "" : "self-wash"}`.trimEnd()}>
      {moment === null ? null : (
        <>
          <div className="flex flex-col gap-1">
            <p className={`${MICRO_LABEL} text-self-ink`}>Needs you</p>
            <p className="font-display text-lg font-bold leading-tight text-text-primary">
              {moment.kind === "lineup" ? problemHeadline(moment.plan, home) : tradeHeadline(moment.trade, tradeContext)}
            </p>
            <p className="text-sm text-text-muted">{moment.kind === "lineup" ? problemEvidence(moment.plan) : tradeEvidence(moment.trade, tradeContext)}</p>
          </div>
          {moment.kind === "lineup" ? (
            <Button variant="verb" className="self-start" onClick={() => onFixLineup(moment.plan)}>
              Set your lineup
            </Button>
          ) : (
            <Button variant="verb" className="self-start" onClick={() => onViewTrade(moment.trade)}>
              Respond to the offer
            </Button>
          )}
          {(() => {
            const more = moreLine(plans, inboxTrades, moment.kind);
            return more === null ? null : <p className="text-xs text-text-faint">{more}</p>;
          })()}
        </>
      )}
      {pendingClaims.map((claim) => (
        <p key={claim.claimId} className="text-sm text-text-muted">
          Your claim on <span className="font-display font-bold text-text-primary">{claim.playerName}</span> is {ordinal(claim.queuePosition)} in line and
          clears {formatWeekdayClock(claim.clearsAt)}. Nothing to do until then.
        </p>
      ))}
    </Card>
  );
}
