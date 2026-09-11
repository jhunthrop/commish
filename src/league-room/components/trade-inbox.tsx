"use client";

import { useState } from "react";
import { Button, ButtonLink, EmptyState, ErrorState, EYEBROW, LowerThird, Skeleton } from "@/components/ui";
import { ChapterBand, type ChapterBandTone } from "@/components/ui/chapter-band";
import type { TradeProposalView } from "@/trades/contract";
import type { ValuedPlayer } from "@/trades/fairness";
import type { TradeRosterPlayer, TradeRoomContext } from "../contract";
import { useTrades, type TradeDecision } from "../hooks/use-trades";
import { TradeCard, type TradeCardProps } from "./trade-card";
import { TradeComposer } from "./trade-composer";
import type { TradeAssessmentSummary } from "./trade-verdict";

export interface TradeInboxProps {
  readonly leagueId: string;
  readonly context: TradeRoomContext;
}

type AssessmentStatus = NonNullable<TradeCardProps["assessmentStatus"]>;

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

/**
 * THE SAME ROSTERS, KEYED BY PLAYER ID, KEEPING THE FIELDS `ValuedPlayer` DELIBERATELY DROPS.
 *
 * `flattenPlayers` above narrows every roster player down to the fairness engine's currency
 * (`ValuedPlayer` — id, name, position, an average), which is correct for valuation and useless
 * for drawing one. Law 3 needs a club and a face, and those belong nowhere near a collusion
 * sweep's input type, so the card takes two lookups over the same list rather than one widened
 * one: `describeAsset` still owns the LABEL (it is the only function permitted to switch on
 * `TradeAssetKind` at all) and this owns the OBJECT.
 */
function flattenRoster(rostersByTeamId: TradeRoomContext["rostersByTeamId"]): Readonly<Record<string, TradeRosterPlayer>> {
  const byId: Record<string, TradeRosterPlayer> = {};
  for (const roster of Object.values(rostersByTeamId)) {
    for (const player of roster) byId[player.playerId] = player;
  }
  return byId;
}

/**
 * SUNDAY v5, LAW 5 — the three bands become chapter markers.
 *
 * They were three sentence-case eyebrows over three stacks of cards, which is a hairline's problem
 * in another costume: the label names the chapter and says nothing about what being in it MEANS.
 * A trade inbox is exactly the list that needs the difference stated, because the three states
 * differ entirely in who is expected to do something — you, them, or nobody ever again — and that
 * is not recoverable from "Offers you have out".
 *
 * The `act` tone on the first band is amber, which is law 4's furniture-and-you channel spent
 * precisely: this band is the "you" one.
 */
function Band({
  leagueId,
  marker,
  consequence,
  tone,
  anchorId,
  trades,
  meTeamId,
  playersById,
  rosterById,
  managersByTeamId,
  leagueName,
  assessmentStatusById,
  assessments,
  onRequestAssessment,
  busyTradeId,
  onAccept,
  onDecline,
  onWithdraw,
}: {
  readonly leagueId: string;
  readonly marker: string;
  readonly consequence: string;
  readonly tone: ChapterBandTone;
  /** Where the lower third's verb lands when this band is the one waiting on the reader. */
  readonly anchorId?: string;
  readonly trades: readonly TradeProposalView[];
  readonly meTeamId: string;
  readonly playersById: Readonly<Record<string, ValuedPlayer>>;
  readonly rosterById: Readonly<Record<string, TradeRosterPlayer>>;
  readonly managersByTeamId: TradeRoomContext["managersByTeamId"];
  readonly leagueName: string;
  readonly assessmentStatusById: Readonly<Record<string, AssessmentStatus>>;
  readonly assessments: Readonly<Record<string, TradeAssessmentSummary>>;
  readonly onRequestAssessment: (tradeId: string) => void;
  readonly busyTradeId: string | null;
  readonly onAccept: (tradeId: string) => void;
  readonly onDecline: (tradeId: string) => void;
  readonly onWithdraw: (tradeId: string) => void;
}) {
  if (trades.length === 0) return null;
  return (
    <section id={anchorId} className="flex flex-col gap-3" aria-label={marker}>
      <ChapterBand name={marker} consequence={consequence} tone={tone} />
      <div className="flex flex-col gap-3">
        {trades.map((trade) => (
          <TradeCard
            key={trade.id}
            leagueId={leagueId}
            trade={trade}
            meTeamId={meTeamId}
            playersById={playersById}
            rosterById={rosterById}
            managersByTeamId={managersByTeamId}
            leagueName={leagueName}
            assessmentStatus={assessmentStatusById[trade.id] ?? "idle"}
            assessment={assessments[trade.id]}
            onRequestAssessment={onRequestAssessment}
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
 * The trade room: three bands (offers to answer, offers sent, and trade history), the propose
 * flow, and every action a manager takes on a stored offer. Owns `useTrades` itself, the same
 * shape `NoticeInbox`/`LeagueChat` already use for a room that fetches its own data rather than
 * being handed it — the composing/browsing toggle lives here too, since "read the inbox" and
 * "build an offer" are the same room, never two routes.
 *
 * An OPEN, answerable (inbound) offer's advisory read is asked for, never fetched on mount — fix
 * round 1, F4. This is the second caller `POST /api/leagues/[leagueId]/advisor/trade` gets in
 * this task, beside `TradeComposer`'s own pre-send preview, but it follows `AdvisorPanel`'s exact
 * shape: nothing is asked for until a manager clicks to see it, so an inbox holding any number of
 * open offers can never burst the shared advisor rate limiter (`ADVISOR_CONFIG`, 20 requests/60s
 * across every advisor route a session touches) the way fetching every card's verdict on mount
 * could. `assessmentStatusById` tracks each card's own request independently — `"idle"` until
 * asked, `"loading"` while in flight, `"ready"`/`"error"` once it resolves — so a failed request
 * renders an honest state on its own card instead of silently missing a verdict panel.
 */
export function TradeInbox({ leagueId, context }: TradeInboxProps) {
  const { inbox, outbox, history, meTeamId, status, error, refetch, propose, decide, assess } = useTrades(leagueId);
  const [composing, setComposing] = useState(false);
  const [busyTradeId, setBusyTradeId] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [assessments, setAssessments] = useState<Readonly<Record<string, TradeAssessmentSummary>>>({});
  const [assessmentStatusById, setAssessmentStatusById] = useState<Readonly<Record<string, AssessmentStatus>>>({});

  const playersById = flattenPlayers(context.rostersByTeamId);
  const rosterById = flattenRoster(context.rostersByTeamId);

  const requestAssessment = (tradeId: string): void => {
    // A second click while a request is already in flight (or once it's already answered) is a
    // no-op — this is what keeps ONE click a ONE request, retryable only from an error.
    if (assessmentStatusById[tradeId] === "loading" || assessmentStatusById[tradeId] === "ready") return;
    const trade = [...inbox, ...outbox, ...history].find((row) => row.id === tradeId);
    if (trade === undefined) return;
    setAssessmentStatusById((current) => ({ ...current, [tradeId]: "loading" }));
    const give = trade.to.assets.filter((asset) => asset.kind === "player").map((asset) => asset.playerId);
    const receive = trade.from.assets.filter((asset) => asset.kind === "player").map((asset) => asset.playerId);
    void assess({ weekNumber: trade.weekNumber, counterpartyTeamId: trade.from.teamId, give, receive }).then((result) => {
      if (!result.ok) {
        setAssessmentStatusById((current) => ({ ...current, [tradeId]: "error" }));
        return;
      }
      setAssessments((current) => ({
        ...current,
        [tradeId]: { verdict: result.data.verdict, givingValue: result.data.givingValue, receivingValue: result.data.receivingValue },
      }));
      setAssessmentStatusById((current) => ({ ...current, [tradeId]: "ready" }));
    });
  };

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
        leagueId={leagueId}
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
        title="We could not load your trades."
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
    leagueId,
    meTeamId: meTeamId ?? "",
    playersById,
    rosterById,
    managersByTeamId: context.managersByTeamId,
    leagueName: context.leagueName,
    assessmentStatusById,
    assessments,
    onRequestAssessment: requestAssessment,
    busyTradeId,
    onAccept: (tradeId: string) => void decideAndRefresh(tradeId, "accept"),
    onDecline: (tradeId: string) => void decideAndRefresh(tradeId, "reject"),
    onWithdraw: (tradeId: string) => void decideAndRefresh(tradeId, "withdraw"),
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Fix round 1, F6 (LOW): two different verbs for the identical action of opening the
          composer used to sit on the same page. Rather than showing both at once with the same
          label once they agree (which would leave two identically-named buttons on screen), this
          header control renders ONLY once the empty state's own — the brief's pinned copy — has
          nothing left to show, so there is always exactly one way to start an offer, named the
          same way everywhere it appears. */}
      {nothingHere ? null : (
        // Sits on the page's own top line rather than in a `justify-end` strip of its own, which
        // spent 60px of vertical on one button and left it floating over nothing (law 4: space
        // separates kinds of information, it never exists to calm). It is this page's ONE
        // ceremonial ink pill; every Accept below it is a `verb` — see `TradeCard`.
        <div className="flex items-center justify-between gap-3">
          <h2 className={`${EYEBROW} text-text-muted`}>Your trades</h2>
          {/* QUIET, since law 6 (Sunday v5). The loud act on this page is answering an offer
              somebody is waiting on, and it lives in the lower third at the foot. Starting a new
              offer is still one press from the top of the page — it is just no longer competing
              with the decision the room is actually holding open. */}
          <Button variant="secondary" onClick={() => setComposing(true)}>Put an offer together</Button>
        </div>
      )}

      {decisionError === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {decisionError}
        </p>
      )}

      {nothingHere ? (
        <EmptyState
          title="No trades yet."
          description="Build an offer to a leaguemate."
          action={<Button onClick={() => setComposing(true)}>Put an offer together</Button>}
        />
      ) : (
        <>
          <Band
            marker="Needs your answer"
            consequence="They proposed it · nothing moves until you accept or decline"
            tone="act"
            anchorId="trades-to-answer"
            trades={inbox}
            {...bandProps}
          />
          <Band
            marker="Waiting on them"
            consequence="Yours until they answer · withdraw any time before that"
            tone="quiet"
            trades={outbox}
            {...bandProps}
          />
          {/* Fix round 1, F1: this band is no longer only completed trades — it also carries the
              caller's own dead offers (rejected/withdrawn/expired/superseded on either side),
              which `tradesQuery`'s `history` box now includes so the two managers who negotiated
              a trade that fell through keep their own copy of it. "Trade history" covers both. */}
          <Band
            marker="Settled"
            consequence="Accepted, declined, or run out of time · nothing left to do"
            tone="quiet"
            trades={history}
            {...bandProps}
          />

          {/*
            LAW 6 — the trade room's lower third. The three counts are the room's own state and the
            verb is the one thing anybody is waiting on: an offer sitting in your inbox stops both
            rosters until you answer it.

            NOTHING PENDING RENDERS NOTHING. With an empty inbox there is no act this page is
            holding open — an offer you sent is somebody else's decision and a settled trade is
            nobody's — so the strip carries the facts and no verb at all. That is law 6's own
            diagnostic rather than a gap in it: a screen with no lower-third verb either needs no
            decision, or is hiding one, and this is the first case.
          */}
          <LowerThird
            cells={[
              { label: "Needs you", value: inbox.length },
              { label: "Waiting on them", value: outbox.length },
              { label: "Settled", value: history.length },
            ]}
            action={
              inbox.length === 0 ? undefined : (
                <ButtonLink href="#trades-to-answer" variant="verb" size="sm">
                  {inbox.length === 1 ? "Answer the offer" : "Answer the offers"}
                </ButtonLink>
              )
            }
          />
        </>
      )}
    </div>
  );
}
