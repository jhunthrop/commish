"use client";

import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { Badge, Card } from "@/components/ui";
import { playerName, teamName, teamsById } from "../lib/lookups";
import { Countdown, useCountdown } from "./countdown";

export interface AuctionLotPanelProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
}

/** The lot everyone is watching: who is up, the standing bid, who holds it, and how long is left. */
export function AuctionLotPanel({ view, teams, playersById }: AuctionLotPanelProps) {
  // Called unconditionally, before the early return below — React's Rules of Hooks — even
  // though `remainingMs` is only rendered once a lot exists.
  const { remainingMs } = useCountdown(view.deadlineAt);
  const byId = teamsById(teams);
  const nameOf = (teamId: string | null) => (teamId === null ? "Someone" : teamName(byId, teamId, "Someone"));
  const lot = view.auction?.lot ?? null;

  if (lot === null) {
    return (
      <Card as="section">
        <p className="text-md text-text-primary">{nameOf(view.auction?.nominatingTeamId ?? null)} is choosing who goes up next.</p>
      </Card>
    );
  }

  const player = playersById.get(lot.playerId);
  const name = playerName(playersById, lot.playerId);

  return (
    <Card as="section" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-xl font-semibold text-text-primary">{name}</span>
        {player === undefined ? null : <Badge tone="neutral">{player.position}</Badge>}
        {lot.autoNominated ? <Badge tone="warning">Auto-nominated</Badge> : null}
        {remainingMs === null ? null : <Countdown remainingMs={remainingMs} data-testid="lot-countdown" />}
      </div>
      <p className="flex flex-wrap items-baseline gap-2 text-md text-text-primary">
        <span className="text-2xl font-semibold">${lot.highBid}</span>
        <span className="text-text-muted">high bid —</span>
        <span className="font-medium">{nameOf(lot.highBidTeamId)}</span>
      </p>
      <p className="text-sm text-text-muted">
        {name} is up for bid at ${lot.highBid}, held by {nameOf(lot.highBidTeamId)}.
      </p>
    </Card>
  );
}
