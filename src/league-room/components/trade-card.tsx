"use client";

import { useState } from "react";
import { Badge, Button, Card, Modal, PositionBadge, Sticker } from "@/components/ui";
import { describeAsset, type TradeAsset } from "@/trades/assets";
import type { TradeProposalView, TradeSideView } from "@/trades/contract";
import type { ValuedPlayer } from "@/trades/fairness";
import { formatWeek } from "../lib/format";
import { TradeVerdict, type TradeAssessmentSummary } from "./trade-verdict";

export interface TradeCardProps {
  readonly trade: TradeProposalView;
  /** The viewer's own team id, from `useTrades`' `meTeamId` — never the proposer's or the
   *  counterparty's assumed identity, since a league history card can belong to neither. */
  readonly meTeamId: string;
  /** Every team's current roster, flattened and keyed by player id, so a bare `TradeAsset` can be
   *  turned into a name and a position through `describeAsset` (`@/trades/assets`) — the one
   *  function this codebase permits to switch on `TradeAssetKind` at all. Built once, upstream,
   *  from the same read `TradeComposer`'s pickers use (`TradeRoomContext.rostersByTeamId`). */
  readonly playersById: Readonly<Record<string, ValuedPlayer>>;
  /** The viewer's own advisory read on an OPEN, answerable offer — present only once `useTrades`'
   *  `assess` call for this card has resolved. `undefined` while it hasn't been asked for yet,
   *  `null` while it's in flight; either way `TradeCard` renders the accept control without
   *  waiting on it, because the verdict sits BESIDE the decision, never gates it. */
  readonly assessment?: TradeAssessmentSummary | null;
  readonly onAccept?: (tradeId: string) => void;
  readonly onDecline?: (tradeId: string) => void;
  readonly onWithdraw?: (tradeId: string) => void;
  /** True while an action for THIS card is in flight — disables its own buttons without
   *  reaching into a sibling card's state. */
  readonly busy?: boolean;
}

function AssetList({ heading, assets, playersById }: { readonly heading: string; readonly assets: readonly TradeAsset[]; readonly playersById: Readonly<Record<string, ValuedPlayer>> }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <h3 className="text-sm font-medium text-text-muted">{heading}</h3>
      <ul className="flex flex-col gap-2">
        {assets.map((asset, index) => {
          const described = describeAsset(asset, playersById);
          return (
            <li key={`${asset.kind}:${asset.kind === "player" ? asset.playerId : index}`}>
              {described.position === null ? (
                <span className="text-sm text-text-primary">{described.label}</span>
              ) : (
                <Sticker position={described.position} className="flex items-center gap-2 px-2 py-1">
                  <PositionBadge position={described.position} size="sm" />
                  <span className="min-w-0 break-words text-sm font-medium">{described.label}</span>
                </Sticker>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What the card says about a trade that is no longer answerable, and whether "Accept"/"Decline"
 *  belong on it at all. `null` copy means the open, answerable band below renders instead. */
function settledCopy(trade: TradeProposalView, meTeamId: string): string | null {
  if (trade.status === "open") return null;
  if (trade.status === "accepted") {
    return trade.reversedAt === null
      ? "Both rosters changed when this trade was accepted."
      : "An operator put this trade back. Both rosters moved back to how they were.";
  }
  if (trade.status === "rejected") return "Declined.";
  if (trade.status === "withdrawn") {
    return trade.from.teamId === meTeamId ? "You took this offer back." : "They took this offer back.";
  }
  if (trade.status === "expired") return "This offer expired without an answer.";
  // superseded
  return "This offer can't be answered anymore. One of these players moved to another team in a different trade.";
}

function myAndTheirSides(trade: TradeProposalView, meTeamId: string): { readonly mine: TradeSideView; readonly theirs: TradeSideView } | null {
  if (trade.from.teamId === meTeamId) return { mine: trade.from, theirs: trade.to };
  if (trade.to.teamId === meTeamId) return { mine: trade.to, theirs: trade.from };
  return null;
}

/**
 * One stored proposal, in whatever state it's in. Two asset lists framed as "you give"/"you get"
 * when the viewer is a party to the trade, or plainly by team name in the league's shared history
 * when they aren't. The accept/decline pair is the one irreversible control pair in this product
 * (`Modal` confirms Accept, never Decline), so it renders ONLY for the counterparty of an OPEN
 * offer — everyone else sees a settled state's own sentence instead.
 */
export function TradeCard({ trade, meTeamId, playersById, assessment, onAccept, onDecline, onWithdraw, busy = false }: TradeCardProps) {
  const [confirmingAccept, setConfirmingAccept] = useState(false);
  const sides = myAndTheirSides(trade, meTeamId);
  const iAmProposer = trade.from.teamId === meTeamId;
  const iAmCounterparty = trade.to.teamId === meTeamId;
  const isAnswerable = trade.status === "open" && iAmCounterparty;
  const isMineWaiting = trade.status === "open" && iAmProposer;
  const settled = settledCopy(trade, meTeamId);

  const givingSide = sides?.mine ?? trade.from;
  const gettingSide = sides?.theirs ?? trade.to;
  const givingHeading = sides === null ? `${trade.from.teamName} gives` : "You give";
  const gettingHeading = sides === null ? `${trade.to.teamName} gives` : "You get";
  const counterpartyName = sides === null ? null : sides.theirs.teamName;
  const cardLabel = counterpartyName === null ? `Trade between ${trade.from.teamName} and ${trade.to.teamName}` : `Trade with ${counterpartyName}`;

  return (
    <Card as="article" aria-label={cardLabel}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-text-muted">{formatWeek(trade.weekNumber)}</p>
          {isAnswerable ? <Badge tone="accent">Needs your answer</Badge> : null}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <AssetList heading={givingHeading} assets={givingSide.assets} playersById={playersById} />
          <AssetList heading={gettingHeading} assets={gettingSide.assets} playersById={playersById} />
        </div>

        {trade.note === null ? null : <p className="break-words text-sm italic text-text-muted">{`"${trade.note}"`}</p>}

        {settled === null ? null : <p className="text-sm text-text-primary">{settled}</p>}

        {isAnswerable ? (
          <div className="flex flex-col gap-3">
            {assessment !== null && assessment !== undefined ? <TradeVerdict assessment={assessment} /> : null}
            {/* `gap-4`, never a tighter value: the one irreversible button pair in this product
                sits side by side, so the gap between them is a deliberate choice rather than
                whatever a flex row defaults to. */}
            <div className="flex flex-wrap gap-4">
              <Button onClick={() => setConfirmingAccept(true)} disabled={busy}>
                Accept
              </Button>
              <Button variant="secondary" onClick={() => onDecline?.(trade.id)} disabled={busy}>
                Decline
              </Button>
            </div>
          </div>
        ) : null}

        {isMineWaiting ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-text-muted">Waiting for a reply.</p>
            <div>
              <Button variant="secondary" onClick={() => onWithdraw?.(trade.id)} disabled={busy}>
                Withdraw
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <Modal
        open={confirmingAccept}
        title="Accept this trade?"
        onClose={() => setConfirmingAccept(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmingAccept(false)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={busy}
              onClick={() => {
                onAccept?.(trade.id);
                setConfirmingAccept(false);
              }}
            >
              Confirm accept
            </Button>
          </>
        }
      >
        <p>Both rosters change as soon as you accept. You can&apos;t undo it.</p>
      </Modal>
    </Card>
  );
}
