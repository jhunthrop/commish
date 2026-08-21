"use client";

import { useEffect, useRef, useState } from "react";
import { Button, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import type { TradeProposalView } from "@/trades/contract";
import type { ValuedPlayer } from "@/trades/fairness";
import type { TradeRoomContext } from "../contract";
import { useTrades, type TradeDecision } from "../hooks/use-trades";
import { TradeCard } from "./trade-card";
import { TradeComposer } from "./trade-composer";
import type { TradeAssessmentSummary } from "./trade-verdict";

export interface TradeInboxProps {
  readonly leagueId: string;
  readonly context: TradeRoomContext;
}

function flattenPlayers(rostersByTeamId: TradeRoomContext["rostersByTeamId"]): Readonly<Record<string, ValuedPlayer>> {
  const byId: Record<string, ValuedPlayer> = {};
  for (const roster of Object.values(rostersByTeamId)) {
    for (const player of roster) {
      // `averagePoints` is never read by `describeAsset` for display (`label`/`position` only)
      // and `TradeRosterPlayer` carries no such figure of its own — `matchupWeek`'s roster read
      // gives a single week's actual points, not a season average, and reusing it here would
      // mislabel one for the other. 0 is an inert placeholder, not a claim about this player.
      byId[player.playerId] = { playerId: player.playerId, name: player.name, position: player.position, averagePoints: 0 };
    }
  }
  return byId;
}

function Band({
  title,
  trades,
  meTeamId,
  playersById,
  assessments,
  assessing,
  busyTradeId,
  onAccept,
  onDecline,
  onWithdraw,
}: {
  readonly title: string;
  readonly trades: readonly TradeProposalView[];
  readonly meTeamId: string;
  readonly playersById: Readonly<Record<string, ValuedPlayer>>;
  readonly assessments: Readonly<Record<string, TradeAssessmentSummary>>;
  readonly assessing: ReadonlySet<string>;
  readonly busyTradeId: string | null;
  readonly onAccept: (tradeId: string) => void;
  readonly onDecline: (tradeId: string) => void;
  readonly onWithdraw: (tradeId: string) => void;
}) {
  if (trades.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="text-lg font-medium text-text-primary">{title}</h2>
      <div className="flex flex-col gap-3">
        {trades.map((trade) => (
          <TradeCard
            key={trade.id}
            trade={trade}
            meTeamId={meTeamId}
            playersById={playersById}
            assessment={assessing.has(trade.id) ? null : (assessments[trade.id] ?? undefined)}
            busy={busyTradeId === trade.id}
            onAccept={onAccept}
            onDecline={onDecline}
            onWithdraw={onWithdraw}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * The trade room: three bands (offers to answer, offers sent, the league's settled history),
 * the propose flow, and every action a manager takes on a stored offer. Owns `useTrades` itself,
 * the same shape `NoticeInbox`/`LeagueChat` already use for a room that fetches its own data
 * rather than being handed it — the composing/browsing toggle lives here too, since "read the
 * inbox" and "build an offer" are the same room, never two routes.
 *
 * Every OPEN, answerable (inbound) offer gets its own advisory read the moment it's on screen —
 * `assess`, called once per trade id and cached in `assessments`, from the viewer's OWN
 * perspective (never the proposer's private propose-time read, which `proposeTrade` never stores
 * or shows the counterparty in the first place). This is the second caller `POST /api/leagues/
 * [leagueId]/advisor/trade` gets in this task, beside `TradeComposer`'s own pre-send preview.
 */
export function TradeInbox({ leagueId, context }: TradeInboxProps) {
  const { inbox, outbox, history, meTeamId, status, error, refetch, propose, decide, assess } = useTrades(leagueId);
  const [composing, setComposing] = useState(false);
  const [busyTradeId, setBusyTradeId] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [assessments, setAssessments] = useState<Readonly<Record<string, TradeAssessmentSummary>>>({});
  const askedRef = useRef(new Set<string>());
  const [assessingIds, setAssessingIds] = useState<ReadonlySet<string>>(new Set());

  const playersById = flattenPlayers(context.rostersByTeamId);

  useEffect(() => {
    if (meTeamId === null) return;
    const answerable = inbox.filter((trade) => trade.status === "open" && trade.to.teamId === meTeamId);
    for (const trade of answerable) {
      if (askedRef.current.has(trade.id)) continue;
      askedRef.current.add(trade.id);
      setAssessingIds((current) => new Set(current).add(trade.id));
      const give = trade.to.assets.filter((asset) => asset.kind === "player").map((asset) => asset.playerId);
      const receive = trade.from.assets.filter((asset) => asset.kind === "player").map((asset) => asset.playerId);
      void assess({ weekNumber: trade.weekNumber, counterpartyTeamId: trade.from.teamId, give, receive }).then((result) => {
        setAssessingIds((current) => {
          const next = new Set(current);
          next.delete(trade.id);
          return next;
        });
        if (!result.ok) return;
        setAssessments((current) => ({
          ...current,
          [trade.id]: { verdict: result.data.verdict, givingValue: result.data.givingValue, receivingValue: result.data.receivingValue },
        }));
      });
    }
  }, [inbox, meTeamId, assess]);

  const decideAndRefresh = async (tradeId: string, action: TradeDecision): Promise<void> => {
    setBusyTradeId(tradeId);
    setDecisionError(null);
    const result = await decide(tradeId, action);
    setBusyTradeId(null);
    if (!result.ok) setDecisionError(result.error);
  };

  if (composing) {
    return (
      <TradeComposer
        context={context}
        onAssess={assess}
        onPropose={propose}
        onDone={() => setComposing(false)}
        onCancel={() => setComposing(false)}
      />
    );
  }

  if (status === "loading") {
    return <Skeleton className="h-48" />;
  }

  if (status === "error") {
    return (
      <ErrorState
        title="We couldn't load your trades."
        description={error ?? undefined}
        action={
          <Button variant="secondary" onClick={() => void refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  const nothingHere = inbox.length === 0 && outbox.length === 0 && history.length === 0;

  // One set of handlers shared by every band: `TradeCard` itself decides which of them apply
  // to a given status (`isAnswerable`/`isMineWaiting`), so a settled-history card is handed the
  // same three callbacks as an open one and simply never calls them.
  const bandProps = {
    meTeamId: meTeamId ?? "",
    playersById,
    assessments,
    assessing: assessingIds,
    busyTradeId,
    onAccept: (tradeId: string) => void decideAndRefresh(tradeId, "accept"),
    onDecline: (tradeId: string) => void decideAndRefresh(tradeId, "reject"),
    onWithdraw: (tradeId: string) => void decideAndRefresh(tradeId, "withdraw"),
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button onClick={() => setComposing(true)}>Propose a trade</Button>
      </div>

      {decisionError === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {decisionError}
        </p>
      )}

      {nothingHere ? (
        <EmptyState
          title="No trades yet."
          description="Build an offer to a leaguemate whenever you're ready."
          action={<Button onClick={() => setComposing(true)}>Put an offer together</Button>}
        />
      ) : (
        <>
          <Band title="Offers to answer" trades={inbox} {...bandProps} />
          <Band title="Offers you have out" trades={outbox} {...bandProps} />
          <Band title="Completed trades" trades={history} {...bandProps} />
        </>
      )}
    </div>
  );
}
