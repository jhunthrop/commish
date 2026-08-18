"use client";

import type { TeamCard } from "@/domain/league";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import { Badge } from "@/components/ui";
import { formatClockLength, formatTightening } from "../state/format";
import { playerName, teamName, teamsById } from "../lib/lookups";
import { Countdown, useCountdown } from "./countdown";

export type RoomHeaderVariant = "room" | "tv";

export interface RoomHeaderProps {
  readonly leagueName: string;
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly myTeamId: string | null;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly variant?: RoomHeaderVariant;
}

const FORMAT_LABEL: Readonly<Record<DraftStateView["format"], string>> = {
  snake: "Snake draft",
  auction: "Auction draft",
};

const LEAGUE_TEXT: Readonly<Record<RoomHeaderVariant, string>> = {
  room: "text-display-lg",
  tv: "text-display-xl",
};

/**
 * Which round the board is on: how many picks the team on the clock already owns, plus one —
 * the same "your next empty row" derivation `DraftBoard` uses. Falls back to the round of the
 * last completed pick, and to round 1 on an untouched board. Nothing here restates a turn-order
 * rule; it counts what already happened.
 */
function currentRound(view: DraftStateView): number {
  if (view.onClockTeamId !== null) {
    return view.picks.filter((pick) => pick.teamId === view.onClockTeamId).length + 1;
  }
  return view.picks[view.picks.length - 1]?.round ?? 1;
}

/** The one-line "where are we" label. An auction has lots, not rounds. */
function turnLabel(view: DraftStateView): string | null {
  if (view.phase !== "in_progress") return null;
  if (view.format === "auction") return `Lot ${view.pickNumber}`;
  return `Round ${currentRound(view)} · Pick ${view.pickNumber}`;
}

interface ClockBlockProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly myTeamId: string | null;
  readonly playersById: ReadonlyMap<string, Player>;
}

/** The status line ("On the clock", "Live bid", …) and the team or player it names. */
function Turn({ label, subject, mine }: { readonly label: string; readonly subject: string; readonly mine: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="font-display text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <span className={`font-display text-display-md font-bold leading-display ${mine ? "text-accent" : "text-text-primary"}`}>{subject}</span>
    </div>
  );
}

/**
 * Whose turn it is, how long is left, and — the part that turns the auto-tightening schedule
 * from an engine feature into a product feature — when the clock next shortens.
 *
 * The ticking digits are `aria-hidden`: a number changing every second inside a live region is
 * unusable with a screen reader. The sentence beneath them says the same thing statically.
 *
 * An auction lot has no `onClockTeamId` by design — the clock belongs to everyone while
 * bidding is open, not to one team — so this never claims someone is "on the clock" during a
 * live lot. It branches on `view.format` instead: a live lot gets its own "Live bid" heading
 * naming the player and the standing bid, and an open-but-unlotted auction turn says who is
 * nominating. Only a snake draft (or an auction that hasn't started) ever says "on the clock".
 */
function ClockBlock({ view, teams, myTeamId, playersById }: ClockBlockProps) {
  // Called unconditionally, before the early returns below — React's Rules of Hooks — even
  // though `remainingMs` is only rendered once the draft is in progress. `now` is the same
  // wall-clock reading `remainingMs` was computed from, so the tightening sentence below
  // shares this one ticking interval instead of running a second `useNow` alongside it.
  const { remainingMs, now } = useCountdown(view.deadlineAt);

  if (view.phase === "scheduled") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-md text-text-primary">This draft hasn&apos;t started yet.</p>
        <p className="text-sm text-text-muted">Your commissioner starts it when everyone is here.</p>
      </div>
    );
  }
  if (view.phase === "complete") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-md text-text-primary">This draft is complete.</p>
        <p className="text-sm text-text-muted">Every roster below is final.</p>
      </div>
    );
  }

  const byId = teamsById(teams);
  const clockLength = view.clockSeconds === null ? null : formatClockLength(view.clockSeconds);
  const tightening = formatTightening(view.nextTightening, now);
  const tighteningRow = tightening === null ? null : <p className="text-sm text-warning">{tightening}</p>;
  const digits = remainingMs === null ? null : <Countdown remainingMs={remainingMs} size="lg" data-testid="countdown" />;

  if (view.format === "auction" && view.auction?.lot !== null && view.auction?.lot !== undefined) {
    const lot = view.auction.lot;
    const lotPlayerName = playerName(playersById, lot.playerId);
    const bidderName = teamName(byId, lot.highBidTeamId, "Someone");
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Turn label="Live bid" subject={lotPlayerName} mine={false} />
          {digits}
        </div>
        <p className="text-sm text-text-muted">
          Bidding is open on {lotPlayerName}. High bid ${lot.highBid} by {bidderName}.
        </p>
        {tighteningRow}
      </div>
    );
  }

  if (view.format === "auction") {
    const nominatorId = view.auction?.nominatingTeamId ?? null;
    const nominatorName = nominatorId === null ? "Nobody" : teamName(byId, nominatorId, "Someone");
    const isMine = nominatorId !== null && nominatorId === myTeamId;
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Turn label={isMine ? "You're nominating" : "Nominating"} subject={nominatorName} mine={isMine} />
          {digits}
        </div>
        <p className="text-sm text-text-muted">{nominatorName} is nominating.</p>
        {tighteningRow}
      </div>
    );
  }

  const onClockTeam = view.onClockTeamId === null ? null : (byId.get(view.onClockTeamId) ?? null);
  const isMine = view.onClockTeamId !== null && view.onClockTeamId === myTeamId;
  const who = onClockTeam?.name ?? "Nobody";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Turn label={isMine ? "You're on the clock" : "On the clock"} subject={who} mine={isMine} />
        {digits}
      </div>
      <p className="text-sm text-text-muted">
        {who} is on the clock.{clockLength === null ? "" : ` This round's pick clock is ${clockLength}.`}
      </p>
      {tighteningRow}
    </div>
  );
}

/**
 * The board's masthead: which league this is, what kind of draft it is, where the board is
 * (round and pick), which team is yours, and the clock. One header instead of the page title
 * plus a floating clock card, so a manager who just opened the tab knows all five at a glance.
 *
 * The clock lives here rather than in a component of its own: there was exactly one clock in
 * the room, and splitting it across two surfaces is what made the old room confusing.
 */
export function RoomHeader({ leagueName, view, teams, myTeamId, playersById, variant = "room" }: RoomHeaderProps) {
  const byId = teamsById(teams);
  const myTeamName = myTeamId === null ? null : teamName(byId, myTeamId, "Your team");
  const turn = turnLabel(view);

  return (
    <header className="flex flex-col gap-3 rounded-lg border border-border bg-surface-elevated p-4 shadow-card">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h2 className={`font-display font-bold leading-display text-text-primary ${LEAGUE_TEXT[variant]}`}>{leagueName}</h2>
        <Badge tone="neutral">{FORMAT_LABEL[view.format]}</Badge>
        {turn === null ? null : (
          <span data-testid="turn-label" className="font-display text-display-sm font-semibold uppercase leading-display tracking-wide text-text-muted">
            {turn}
          </span>
        )}
        {myTeamName === null ? null : <span className="ml-auto text-sm text-text-muted">Your team: {myTeamName}</span>}
      </div>
      <div className="border-t border-border pt-3">
        <ClockBlock view={view} teams={teams} myTeamId={myTeamId} playersById={playersById} />
      </div>
    </header>
  );
}
