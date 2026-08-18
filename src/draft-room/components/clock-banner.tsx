"use client";

import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { Badge, Card } from "@/components/ui";
import { formatClockLength, formatTightening } from "../state/format";
import { playerName, teamName, teamsById } from "../lib/lookups";
import { Countdown, useCountdown } from "./countdown";

export interface ClockBannerProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly myTeamId: string | null;
  readonly playersById: ReadonlyMap<string, Player>;
}

/**
 * Whose turn it is, how long is left, and — the part that turns the auto-tightening schedule
 * from an engine feature into a product feature — when the clock next shortens.
 *
 * The ticking digits are `aria-hidden`: a number changing every second inside a live region
 * is unusable with a screen reader. The sentence beneath them says the same thing statically.
 *
 * An auction lot has no `onClockTeamId` by design — the clock belongs to everyone while
 * bidding is open, not to one team — so this never claims someone is "on the clock" during a
 * live lot. It branches on `view.format` instead: a live lot gets its own "Live bid" heading
 * naming the player and the standing bid, and an open-but-unlotted auction turn says who is
 * nominating. Only a snake draft (or an auction that hasn't started) ever says "on the clock".
 */
export function ClockBanner({ view, teams, myTeamId, playersById }: ClockBannerProps) {
  // Called unconditionally, before the early returns below — React's Rules of Hooks — even
  // though `remainingMs` is only rendered once the draft is in progress. `now` is the same
  // wall-clock reading `remainingMs` was computed from, so the tightening sentence below
  // shares this one ticking interval instead of running a second `useNow` alongside it.
  const { remainingMs, now } = useCountdown(view.deadlineAt);

  if (view.phase === "scheduled") {
    return (
      <Card as="section">
        <p className="text-md text-text-primary">This draft hasn&apos;t started yet.</p>
        <p className="text-sm text-text-muted">Your commissioner starts it when everyone is here.</p>
      </Card>
    );
  }
  if (view.phase === "complete") {
    return (
      <Card as="section">
        <p className="text-md text-text-primary">This draft is complete.</p>
        <p className="text-sm text-text-muted">Every roster below is final.</p>
      </Card>
    );
  }

  const byId = teamsById(teams);
  const clockLength = view.clockSeconds === null ? null : formatClockLength(view.clockSeconds);
  const tightening = formatTightening(view.nextTightening, now);
  const tighteningRow = tightening === null ? null : <p className="text-sm text-warning">{tightening}</p>;

  if (view.format === "auction" && view.auction?.lot !== null && view.auction?.lot !== undefined) {
    const lot = view.auction.lot;
    const lotPlayerName = playerName(playersById, lot.playerId);
    const bidderName = teamName(byId, lot.highBidTeamId, "Someone");
    return (
      <Card as="section" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="accent">Live bid</Badge>
          <span className="text-xl font-semibold text-text-primary">{lotPlayerName}</span>
          {remainingMs === null ? null : <Countdown remainingMs={remainingMs} data-testid="countdown" />}
        </div>
        <p className="text-sm text-text-muted">
          Bidding is open on {lotPlayerName}. High bid ${lot.highBid} by {bidderName}.
        </p>
        {tighteningRow}
      </Card>
    );
  }

  if (view.format === "auction") {
    const nominatorId = view.auction?.nominatingTeamId ?? null;
    const nominatorName = nominatorId === null ? "Nobody" : teamName(byId, nominatorId, "Someone");
    const isMine = nominatorId !== null && nominatorId === myTeamId;
    return (
      <Card as="section" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={isMine ? "accent" : "neutral"}>{isMine ? "You're nominating" : "Nominating"}</Badge>
          <span className="text-xl font-semibold text-text-primary">{nominatorName}</span>
        </div>
        <p className="text-sm text-text-muted">{nominatorName} is nominating.</p>
        {tighteningRow}
      </Card>
    );
  }

  const onClockTeam = view.onClockTeamId === null ? null : (byId.get(view.onClockTeamId) ?? null);
  const isMine = view.onClockTeamId !== null && view.onClockTeamId === myTeamId;
  const who = onClockTeam?.name ?? "Nobody";

  return (
    <Card as="section" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={isMine ? "accent" : "neutral"}>{isMine ? "You're on the clock" : "On the clock"}</Badge>
        <span className="text-xl font-semibold text-text-primary">{who}</span>
        {remainingMs === null ? null : <Countdown remainingMs={remainingMs} data-testid="countdown" />}
      </div>
      <p className="text-sm text-text-muted">
        {who} is on the clock.{clockLength === null ? "" : ` This round's pick clock is ${clockLength}.`}
      </p>
      {tighteningRow}
    </Card>
  );
}
