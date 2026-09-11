"use client";

import { useState } from "react";
import { BigNumber, Button, EYEBROW, Manager, MessageBubble, Modal, PlayerRow, PositionBadge } from "@/components/ui";
import type { Player } from "@/domain/player";
import { describeAsset, type TradeAsset } from "@/trades/assets";
import { TRADE_CONFIG } from "@/trades/config";
import type { TradeProposalView, TradeSideView } from "@/trades/contract";
import type { TradeManager, TradeRosterPlayer } from "../contract";
import type { ValuedPlayer } from "@/trades/fairness";
import { isExpired } from "@/trades/lifecycle";
import { LEAGUE_ROOM_CONFIG } from "../config";
import { useNow } from "../hooks/use-now";
import { daysUntil, formatDate, formatExpired, formatWeek } from "../lib/format";
import { HeldTradeBanner } from "./held-trade-banner";
import { PlayerName } from "./player-peek";
import { TradeVerdict, type TradeAssessmentSummary } from "./trade-verdict";

/** The full window a fresh offer stands for, in days — the basis every day count on this card
 *  names, read off `TRADE_CONFIG` rather than restated as a numeral (P2, P11). */
const PROPOSAL_TTL_DAYS = Math.round(TRADE_CONFIG.proposalTtlHours / 24);

export interface TradeCardProps {
  readonly leagueId: string;
  readonly trade: TradeProposalView;
  /** The viewer's own team id, from `useTrades`' `meTeamId` — never the proposer's or the
   *  counterparty's assumed identity, since a league history card can belong to neither. */
  readonly meTeamId: string;
  /** Every team's current roster, flattened and keyed by player id, so a bare `TradeAsset` can be
   *  turned into a name and a position through `describeAsset` (`@/trades/assets`) — the one
   *  function this codebase permits to switch on `TradeAssetKind` at all. Built once, upstream,
   *  from the same read `TradeComposer`'s pickers use (`TradeRoomContext.rostersByTeamId`). */
  readonly playersById: Readonly<Record<string, ValuedPlayer>>;
  /**
   * The same rosters, keyed the same way, keeping the fields `ValuedPlayer` deliberately drops —
   * see `flattenRoster` (`./trade-inbox.tsx`) for why the card takes two lookups over one list
   * rather than one widened valuation type. Optional, defaulting to empty: an asset naming a
   * player no longer on anybody's roster resolves to nothing and renders no face, which is the
   * same "we do not know" branch `PlayerFace` already takes rather than a placeholder person.
   */
  readonly rosterById?: Readonly<Record<string, TradeRosterPlayer>>;
  /**
   * THE PEOPLE ON BOTH SIDES (P1), keyed by team id — `TradeRoomContext.managersByTeamId`. A
   * trade is a conversation between two managers, and this card used to render it as a
   * negotiation between two brand names because the stored proposal carries no person at all.
   * Optional and defaulting to empty for the same reason `rosterById` is: an unknown team id
   * falls back to its own team name in the byline and draws no face, never an invented one.
   */
  readonly managersByTeamId?: Readonly<Record<string, TradeManager>>;
  /** The league's own name — `held-trade-banner.tsx` needs it, and only it. */
  readonly leagueName?: string;
  /** The viewer's own advisory read on an OPEN, answerable offer. `"idle"` (the default) until
   *  the manager asks for it: an inbox that fetched every card's verdict on mount could burst the
   *  shared advisor rate limiter, and the failure mode was a silently missing verdict. The
   *  verdict sits BESIDE the decision and never gates it. */
  readonly assessmentStatus?: "idle" | "loading" | "ready" | "error";
  readonly assessment?: TradeAssessmentSummary | null;
  /** Fires once, when the manager asks to see the platform's read on an answerable offer. */
  readonly onRequestAssessment?: (tradeId: string) => void;
  readonly onAccept?: (tradeId: string) => void;
  readonly onDecline?: (tradeId: string) => void;
  readonly onWithdraw?: (tradeId: string) => void;
  /** True while an action for THIS card is in flight — disables its own buttons without
   *  reaching into a sibling card's state. */
  readonly busy?: boolean;
}

/**
 * ONE SIDE OF THE OFFER, AS PEOPLE (P1). `describeAsset` still owns the LABEL — it is the only
 * function in this codebase permitted to switch on `TradeAssetKind`, and an asset that is no
 * longer on a roster says so in its own words — and `PlayerRow` owns the OBJECT: the face on the
 * club's ring, the name at the row's largest size, the position and club small beneath it.
 *
 * No figure and no verb on these rows. The offer's one number is the card's (the days left), and
 * the offer's one verb is Accept: a row inside a trade is a person being named, not a person you
 * can act on from here.
 */
function OfferSide({
  leagueId,
  heading,
  assets,
  playersById,
  rosterById,
}: {
  readonly leagueId: string;
  readonly heading: string;
  readonly assets: readonly TradeAsset[];
  readonly playersById: Readonly<Record<string, ValuedPlayer>>;
  readonly rosterById: Readonly<Record<string, TradeRosterPlayer>>;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <h3 className={`${EYEBROW} px-1 text-text-faint`}>{heading}</h3>
      <ul className="flex flex-col">
        {assets.map((asset, index) => {
          const described = describeAsset(asset, playersById);
          const roster = asset.kind === "player" ? rosterById[asset.playerId] : undefined;
          // `described.label` is a real name only when `describeAsset`'s OWN lookup
          // (`playersById`) resolved, not merely when `roster` did: gating on the wrong one would
          // turn its prose fallback ("a player no longer on this roster") into a dead-looking peek
          // button the moment the two maps diverge.
          const isRealName = asset.kind === "player" && playersById[asset.playerId] !== undefined;
          const key = `${asset.kind}:${asset.kind === "player" ? asset.playerId : index}`;
          if (roster === undefined) {
            // No person to draw: an asset nobody holds any more, or a draft pick. A quiet line in
            // the row's own rhythm rather than a faceless row pretending to be one. The position
            // still rides it when `describeAsset` knows one — the absent thing is the FACE, not
            // the fact, and dropping the chip here would lose information the card already had.
            return (
              <li key={key} className="flex min-h-11 items-center gap-2 px-2.5 text-md text-text-primary">
                <span className="min-w-0 break-words">{described.label}</span>
                {described.position === null ? null : <PositionBadge position={described.position} size="sm" />}
              </li>
            );
          }
          const player: Player = {
            id: roster.playerId,
            name: roster.name,
            position: roster.position,
            nflTeam: roster.nflTeam,
            headshotUrl: roster.headshotUrl,
            adp: roster.adp,
          };
          return (
            <li key={key}>
              <PlayerRow
                dense
                player={player}
                meta={roster.nflTeam === "" ? undefined : roster.nflTeam}
                name={
                  isRealName ? (
                    <PlayerName leagueId={leagueId} playerId={asset.playerId} name={described.label} className="truncate" />
                  ) : undefined
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What the card says about a trade that is no longer answerable. `null` copy means the open,
 *  answerable band below renders instead — the SAME `null` a `held` trade returns, deliberately:
 *  a held trade is neither "open, answerable" nor "settled", and its own words come from
 *  `HeldTradeBanner`. */
function settledCopy(trade: TradeProposalView, meTeamId: string): string | null {
  if (trade.status === "open" || trade.status === "held") return null;
  if (trade.status === "under_review") {
    return "Both managers agreed. The league has a day to object before the trade goes through.";
  }
  if (trade.status === "vetoed") {
    return "The league vetoed this trade. Both rosters stayed exactly as they were.";
  }
  if (trade.status === "blocked") {
    return "After a fairness review, this trade was blocked. Both rosters stayed exactly as they were.";
  }
  if (trade.status === "accepted") {
    return trade.reversedAt === null
      ? "Both rosters changed when this trade was accepted."
      : "An operator reversed this trade. Both rosters moved back to how they were.";
  }
  if (trade.status === "rejected") return "Declined.";
  if (trade.status === "withdrawn") {
    return trade.from.teamId === meTeamId ? "You took this offer back." : "They took this offer back.";
  }
  if (trade.status === "expired") return "This offer expired without an answer.";
  // superseded
  return "One of these players moved in another trade.";
}

/**
 * The line under a party's name: which team they run, and whether they are you.
 *
 * FIX ROUND 1, L4: a team whose manager has left the league resolves to no `TradeManager` at all,
 * and the block then fell back to the TEAM NAME as the person's name — with the same team name
 * printed again beneath it. One fact, twice, in one block. With nobody to name, the team name is
 * the whole of what this side is, so the meta line renders nothing.
 */
function partyMeta(manager: TradeManager | undefined, teamName: string, isYou: boolean): string | undefined {
  if (manager === undefined) return isYou ? "you" : undefined;
  return isYou ? `${teamName} · you` : teamName;
}

function myAndTheirSides(trade: TradeProposalView, meTeamId: string): { readonly mine: TradeSideView; readonly theirs: TradeSideView } | null {
  if (trade.from.teamId === meTeamId) return { mine: trade.from, theirs: trade.to };
  if (trade.to.teamId === meTeamId) return { mine: trade.to, theirs: trade.from };
  return null;
}

/**
 * A TRADE AS A CONVERSATION WITH THE OFFER INSIDE IT (Sideline, the wire).
 *
 * The two managers face each other at the top, with their faces and their names — you wear the
 * amber ring, the other side wears the rival rose (P1, P6). Under them the proposal is a
 * `MessageBubble` from whoever sent it: their note is the message, and the offer itself is a card
 * inside the same bubble, two columns of `PlayerRow`. The card's ONE number is how long the offer
 * still stands, with the window it is counting down from named beside it (P2, P11), and its ONE
 * verb is Accept (P3) — everything else on it is quiet.
 *
 * The accept/decline pair is the one irreversible control pair in this product (`Modal` confirms
 * Accept, never Decline), so it renders ONLY for the counterparty of an OPEN offer; everyone else
 * sees a settled state's own sentence instead.
 */
export function TradeCard({
  leagueId,
  trade,
  meTeamId,
  playersById,
  rosterById = {},
  managersByTeamId = {},
  leagueName,
  assessmentStatus = "idle",
  assessment,
  onRequestAssessment,
  onAccept,
  onDecline,
  onWithdraw,
  busy = false,
}: TradeCardProps) {
  const [confirmingAccept, setConfirmingAccept] = useState(false);
  // The wall clock is read in exactly ONE place in this room (`useNow`), never inline as `new
  // Date()` here. Null on the server render and the hydrating render: until the clock snaps, the
  // card treats an open offer as not-yet-expired and holds the day count back for that one frame.
  const now = useNow(LEAGUE_ROOM_CONFIG.expiryTickMs);
  const sides = myAndTheirSides(trade, meTeamId);
  const iAmProposer = trade.from.teamId === meTeamId;
  const iAmCounterparty = trade.to.teamId === meTeamId;
  const expired = now !== null && isExpired(trade, new Date(now).toISOString());
  const isAnswerable = trade.status === "open" && !expired && iAmCounterparty;
  // Withdraw survives expiry: clearing your own dead offer is housekeeping, not answering it.
  const isMineWaiting = trade.status === "open" && iAmProposer;
  const settled = settledCopy(trade, meTeamId);

  const givingSide = sides?.mine ?? trade.from;
  const gettingSide = sides?.theirs ?? trade.to;
  const givingHeading = sides === null ? `${trade.from.teamName} gives` : "You give";
  const gettingHeading = sides === null ? `${trade.to.teamName} gives` : "You get";

  // WHO IS TALKING. The sender speaks the bubble; the other manager is the one they are talking
  // to. A league-wide history card belongs to neither of them, and then the proposer is simply
  // the first of the two named people rather than "them".
  const fromManager = managersByTeamId[trade.from.teamId];
  const toManager = managersByTeamId[trade.to.teamId];
  const proposerName = fromManager?.name ?? trade.from.teamName;
  const counterpartyName = sides === null ? null : sides.theirs.teamName;
  const cardLabel = counterpartyName === null ? `Trade between ${trade.from.teamName} and ${trade.to.teamName}` : `Trade with ${counterpartyName}`;

  const dateText = trade.settledAt === null ? formatDate(trade.proposedAt) : formatDate(trade.settledAt);
  const dateLabel = dateText === "" ? "" : `${trade.settledAt === null ? "Proposed" : "Settled"} ${dateText}`;
  const byline = [formatWeek(trade.weekNumber), dateLabel].filter((part) => part !== "").join(" · ");

  // THE ONE NUMBER (P2): how many whole days this offer still stands, against the window it was
  // given, which is the basis printed beside it (P11). A dead offer HAS NO FIGURE — not a dash
  // with a caption, which would be a slot pretending there is a count to make — it says the day
  // it ran out on and nothing else. A settled trade has nothing to count at all.
  // FIX ROUND 1, L2: the clock is narrowed once, in a const, rather than re-asserted with `!`
  // at the call site — `now` is null for exactly one frame (the server render and the hydrating
  // render) and a non-null assertion is a claim the type system was already able to check.
  const clock = trade.status === "open" && !expired ? now : null;
  const showsClock = clock !== null;
  const daysLeft = clock === null ? 0 : daysUntil(trade.expiresAt, new Date(clock));

  return (
    <article aria-label={cardLabel} className="flex flex-col gap-2.5">
      {/* BOTH PARTIES, AS PEOPLE (P1). The proposer first, because they are the one who spoke.
          You wear the amber ring wherever you are in the pair; the other manager wears the rival
          rose, which is the channel Sideline gives to the person across the table from you. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
        <Manager name={proposerName} avatar={fromManager?.avatar} ring={iAmProposer ? "self" : "rival"} meta={partyMeta(fromManager, trade.from.teamName, iAmProposer)} />
        <span className="text-sm text-text-faint">and</span>
        <Manager name={toManager?.name ?? trade.to.teamName} avatar={toManager?.avatar} ring={iAmCounterparty ? "self" : "rival"} meta={partyMeta(toManager, trade.to.teamName, iAmCounterparty)} />
      </div>

      {/* FIX ROUND 1, M3: YOUR OWN OFFER READS AS SENT. In a room whose thesis is that a trade is
          a conversation, an offer you made has to be your bubble on your side, not a neutral card
          with your own name stamped on it as though somebody else wrote it.

          FIX ROUND 1, H1: the fairness read is a QUIET TEXT CONTROL on the byline row, beside who
          said it and when — a question a leaguemate asks, not a third button competing with the
          one irreversible pair. `aside` renders only on a bubble that is not yours, which is
          exactly the answerable case: you never ask whether your own offer is fair from here. */}
      <MessageBubble
        wide
        mine={iAmProposer}
        author={proposerName}
        avatar={fromManager?.avatar}
        time={byline === "" ? undefined : byline}
        aside={
          isAnswerable && assessmentStatus === "idle" ? (
            // `whitespace-nowrap`: the byline is a tight three-item run and at 360 this broke to
            // "Is it / fair", which reads as two controls rather than one question.
            <button type="button" className="whitespace-nowrap font-normal text-accent underline" onClick={() => onRequestAssessment?.(trade.id)}>
              Is it fair
            </button>
          ) : undefined
        }
      >
        {trade.note === null ? null : <p className="mb-2 break-words">{trade.note}</p>}

        {/* THE OFFER, INSIDE THE MESSAGE. One plate, two columns of people. */}
        <div className="flex flex-col gap-1 rounded-md bg-surface-raised p-1.5 sm:flex-row sm:gap-2">
          <OfferSide leagueId={leagueId} heading={givingHeading} assets={givingSide.assets} playersById={playersById} rosterById={rosterById} />
          <OfferSide leagueId={leagueId} heading={gettingHeading} assets={gettingSide.assets} playersById={playersById} rosterById={rosterById} />
        </div>

        {settled === null ? null : <p className="mt-2 text-md text-text-primary">{settled}</p>}

        {/* The ONE place a held trade's own words live — the two managers see it honestly, and
            nobody else in the league ever renders this card in a `held` state at all. */}
        {trade.status === "held" ? (
          <div className="mt-2">
            <HeldTradeBanner leagueName={leagueName ?? ""} counterpartyTeamName={counterpartyName ?? "your counterparty"} />
          </div>
        ) : null}

        {isAnswerable && assessmentStatus !== "idle" ? (
          <div className="mt-2">
            {assessmentStatus === "loading" ? (
              <p className="text-sm text-text-muted">Checking whether it is fair.</p>
            ) : assessmentStatus === "error" ? (
              <p className="text-sm text-text-muted">
                Advice is unavailable right now.{" "}
                <button type="button" className="text-accent underline" onClick={() => onRequestAssessment?.(trade.id)}>
                  Try again
                </button>
              </p>
            ) : assessment !== null && assessment !== undefined ? (
              <TradeVerdict assessment={assessment} />
            ) : null}
          </div>
        ) : null}

        {/* THE FOOT: the one number on the left with its basis, the two answers on the right. */}
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          {showsClock ? (
            // FIX ROUND 1, H2. The basis used to read "days left of the 3 this offer stands",
            // which is unparseable on first read and says "days" for a single day. The unit rides
            // the basis so the window can never be read as a count of offers or of players, and
            // the singular is real.
            <BigNumber
              align="start"
              size="sm"
              value={String(Math.max(0, daysLeft))}
              basis={`${daysLeft === 1 ? "day" : "days"} left, of ${PROPOSAL_TTL_DAYS} days`}
            />
          ) : trade.status === "open" && expired ? (
            <p className="text-sm text-text-muted">{formatExpired(trade.expiresAt)}</p>
          ) : (
            <span />
          )}

          <div className="flex flex-wrap items-center gap-2">
            {isAnswerable ? (
              // `gap-4`, never a tighter value: the one irreversible control pair in this product
              // sits side by side, so the gap between them is a deliberate choice rather than
              // whatever a flex row defaults to.
              <span className="flex flex-wrap items-center gap-4">
                <Button variant="secondary" size="sm" onClick={() => onDecline?.(trade.id)} disabled={busy}>
                  Decline
                </Button>
                {/* THE ONE VERB (P3). It stays paired with a `Modal` confirm: this is the one
                    irreversible control pair in the product, and making the verb obvious is not
                    the same as making it easy to press by accident. */}
                <Button variant="verb" onClick={() => setConfirmingAccept(true)} disabled={busy}>
                  Accept
                </Button>
              </span>
            ) : null}
            {isMineWaiting ? (
              <>
                <span className="text-sm text-text-muted">{expired ? "Nobody answered before this ran out." : "Waiting for a reply."}</span>
                <Button variant="secondary" size="sm" onClick={() => onWithdraw?.(trade.id)} disabled={busy}>
                  Withdraw
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </MessageBubble>

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
              Confirm trade
            </Button>
          </>
        }
      >
        <p>Both rosters change as soon as you accept. You cannot undo it.</p>
      </Modal>
    </article>
  );
}
