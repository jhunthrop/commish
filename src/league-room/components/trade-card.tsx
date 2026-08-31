"use client";

import { useState } from "react";
import { Button, Card, EYEBROW, Modal, PlayerFace, PositionBadge } from "@/components/ui";
import { describeAsset, type TradeAsset } from "@/trades/assets";
import type { TradeProposalView, TradeSideView } from "@/trades/contract";
import type { TradeRosterPlayer } from "../contract";
import type { ValuedPlayer } from "@/trades/fairness";
import { isExpired } from "@/trades/lifecycle";
import { LEAGUE_ROOM_CONFIG } from "../config";
import { useNow } from "../hooks/use-now";
import { daysUntil, formatDate, formatExpired, formatExpiry, formatWeek } from "../lib/format";
import { HeldTradeBanner } from "./held-trade-banner";
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
  /**
   * The same rosters, keyed the same way, keeping the fields `ValuedPlayer` deliberately drops —
   * see `flattenRoster` (`./trade-inbox.tsx`) for why the card takes two lookups over one list
   * rather than one widened valuation type.
   *
   * Optional, defaulting to empty, on the same contract every other optional prop on this card
   * holds: omit it and the asset rows render exactly as they did before law 3 reached this
   * surface — a position chip beside a name, no face. The one production caller (`TradeInbox`)
   * always supplies it. An empty lookup is also the honest render for an asset naming a player no
   * longer on anybody's roster, which is a real state this card already words, so the missing
   * case and the omitted case degrade identically rather than one of them drawing a placeholder.
   */
  readonly rosterById?: Readonly<Record<string, TradeRosterPlayer>>;
  /** The league's own name — Plan D's `held-trade-banner.tsx` needs it, and only it: every other
   *  status renders with no league name at all. Optional so every OTHER existing caller of this
   *  card is unaffected; `TradeInbox` (the one production caller) always supplies it via
   *  `TradeRoomContext.leagueName`. */
  readonly leagueName?: string;
  /** The viewer's own advisory read on an OPEN, answerable offer. `"idle"` (the default) until
   *  the manager asks for it — fix round 1, F4: an inbox that fetched every card's verdict on
   *  mount could burst the shared advisor rate limiter (`ADVISOR_CONFIG`, 20 requests/60s across
   *  every advisor route a session touches) once it held more than a handful of open offers, and
   *  the failure mode was a silently missing verdict with no error shown. Lazy per-card, on the
   *  SAME "ask, then show the answer" shape `AdvisorPanel` already uses, bounds this to at most
   *  one request per card the manager actually looks at. Either way `TradeCard` renders the
   *  accept control without waiting on it — the verdict sits BESIDE the decision, never gates it. */
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
 * E5 (competition review): this used to stretch a `Sticker` — "the Poster Board's signature
 * shape", a board CELL — into a 769px full-width slab per asset, 202 of them summing to 40.4%
 * of the trades page's own ink on a near-monochrome constitution. A quiet row with a
 * `PositionBadge` chip is the SAME treatment the matchup table and `LineupEditor`'s own roster
 * table already use for "this player, and their position" — the sticker fill stays exactly
 * where LED-2 ruled it belongs, on a board cell, never a list row.
 */
function AssetList({ heading, assets, playersById, rosterById }: { readonly heading: string; readonly assets: readonly TradeAsset[]; readonly playersById: Readonly<Record<string, ValuedPlayer>>; readonly rosterById: Readonly<Record<string, TradeRosterPlayer>> }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <h3 className={`${EYEBROW} text-text-muted`}>{heading}</h3>
      <ul className="flex flex-col gap-1.5">
        {assets.map((asset, index) => {
          const described = describeAsset(asset, playersById);
          // LAW 3, ON THE ONE SCREEN WHERE A MANAGER IS COMPARING PEOPLE. `describeAsset` still
          // owns the LABEL — it is the only function in this codebase permitted to switch on
          // `TradeAssetKind`, and an asset that is no longer on a roster says so in its own
          // words. What this adds is the OBJECT: the face on its club colour, for the assets that
          // resolve to a player still on somebody's roster. An asset that resolves to nobody
          // renders no face, which is the same "we do not know" branch `PlayerFace` already takes
          // for an unknown club rather than a placeholder standing in for a person.
          const roster = asset.kind === "player" ? rosterById[asset.playerId] : undefined;
          return (
            <li key={`${asset.kind}:${asset.kind === "player" ? asset.playerId : index}`} className="flex min-w-0 items-center gap-2">
              {roster === undefined ? null : (
                <PlayerFace player={{ id: roster.playerId, name: roster.name, position: roster.position, nflTeam: roster.nflTeam, headshotUrl: roster.headshotUrl, adp: roster.adp }} size="sm" />
              )}
              <span className="min-w-0 break-words text-sm font-medium text-text-primary">{described.label}</span>
              {described.position === null ? null : <PositionBadge position={described.position} size="sm" />}
              {roster === undefined || roster.nflTeam === "" ? null : <span className="font-mono text-xs text-text-faint">{roster.nflTeam}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What the card says about a trade that is no longer answerable, and whether "Accept"/"Decline"
 *  belong on it at all. `null` copy means the open, answerable band below renders instead — the
 *  SAME `null` a `held` trade returns, deliberately (Plan D, Task 5): a held trade is neither
 *  "open, answerable" nor "settled" (`TRADE_STATUSES.held`'s own docblock, `@/trades/lifecycle`),
 *  and its own words come from `HeldTradeBanner` instead, rendered directly by `TradeCard` rather
 *  than folded into this settled-state sentence. */
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
    // "Reversed", never "put back" — the one action verb Task 7's own panel fixed everywhere
    // else in this arc (the notice title/body, the operator queue trail). Fix round 1, F3: this
    // card was the one surface that fix round missed. The action verb leads; "moved back" stays
    // an effect phrase in the second sentence, never the headline word.
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
export function TradeCard({
  trade,
  meTeamId,
  playersById,
  rosterById = {},
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
  // Fix round 2, F1: the wall clock is read in exactly ONE place in this room (`useNow`, the
  // same idiom `useCountdown` uses in `src/draft-room`), never inline as `new Date()` here —
  // `docs/conventions.md`'s "no ambient clock" rule, and what keeps this value mockable in a
  // test without patching the global clock.
  // Null on the server render and the hydrating render (`useNow`'s hydration contract): until
  // the clock snaps, the card treats an open offer as not-yet-expired and holds the expiry line
  // back for that one frame — display-only optimism the server ticker corrects nothing by,
  // since no write path reads this (`isExpired` is re-asked on the server for every action).
  const now = useNow(LEAGUE_ROOM_CONFIG.expiryTickMs);
  const sides = myAndTheirSides(trade, meTeamId);
  const iAmProposer = trade.from.teamId === meTeamId;
  const iAmCounterparty = trade.to.teamId === meTeamId;
  // FINAL REVIEW, HIGH 3: `isExpired` (`@/trades/lifecycle`) had zero production consumers, so a
  // dead offer still wore "Needs your answer" and a live Accept button whose 409 was the only
  // thing that ever told the member it had run out. The pure function both halves of the product
  // share is asked here, against `useNow`'s tick, so an offer that ages out while the page is
  // open loses its controls without a refetch — and nothing writes `status = 'expired'`, because
  // there is no event moment to write one at (expiry stays DERIVED).
  const expired = now !== null && isExpired(trade, new Date(now).toISOString());
  const isAnswerable = trade.status === "open" && !expired && iAmCounterparty;
  // Withdraw survives expiry: clearing your own dead offer is housekeeping, not answering it, and
  // `withdrawTrade` (`@/league-service/trades`) accepts it — the server and this card agree.
  const isMineWaiting = trade.status === "open" && iAmProposer;
  const settled = settledCopy(trade, meTeamId);

  const givingSide = sides?.mine ?? trade.from;
  const gettingSide = sides?.theirs ?? trade.to;
  const givingHeading = sides === null ? `${trade.from.teamName} gives` : "You give";
  const gettingHeading = sides === null ? `${trade.to.teamName} gives` : "You get";
  const counterpartyName = sides === null ? null : sides.theirs.teamName;
  const cardLabel = counterpartyName === null ? `Trade between ${trade.from.teamName} and ${trade.to.teamName}` : `Trade with ${counterpartyName}`;
  // E6 (competition review): `counterpartyName` used to be computed for the `aria-label` alone
  // — a card never visibly named who you traded with. Visible now, in the same line as the
  // week and the date, for a party and for a league-wide history row alike.
  const counterpartyLabel = counterpartyName === null ? `${trade.from.teamName} and ${trade.to.teamName}` : `With ${counterpartyName}`;
  // E6: `proposedAt`/`settledAt` were both on the wire and neither was rendered — twenty
  // identical history cards with no date on any of them. `settledAt` once the trade has one
  // (every terminal state writes it in the same transaction that settles); `proposedAt`
  // otherwise, for a still-open offer.
  // The verb only appears when the date does (see `formatDate`'s own guard): "Settled " with an
  // empty date is worse than saying nothing at all.
  const dateText = trade.settledAt === null ? formatDate(trade.proposedAt) : formatDate(trade.settledAt);
  const dateLabel = dateText === "" ? "" : `${trade.settledAt === null ? "Proposed" : "Settled"} ${dateText}`;

  return (
    <Card as="article" aria-label={cardLabel}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* SUBTRACTION (Sunday v5): the "Needs your answer" badge is gone. Every answerable
              card sits under a chapter band saying exactly that, in the same amber, one row above
              — the control the band opens teaches it, and a badge repeating its own section
              heading on every card is the prose law 5's bands exist to replace. */}
          <p className="text-sm text-text-muted">{`${formatWeek(trade.weekNumber)} · ${counterpartyLabel} · ${dateLabel}`}</p>
        </div>

        {/* Fix round 1, F2 (HIGH, member panel): neither side of an open offer was ever told
            when it stops being answerable. Read straight off the stored `expiresAt` — the SAME
            wire field the panel found unused — so this is a live remaining count, not a static
            "three days" restated from `TRADE_CONFIG` on every render regardless of how long the
            offer has actually been sitting. Shown to whichever side an open offer belongs to:
            the recipient deciding whether to answer now, and the sender waiting on a reply.
            Final review, HIGH 3: a past-due offer says "Expired August 18." — the state and the
            day — rather than "Expires today." forever, which is what the old `Math.max(0, …)`
            clamp produced for an offer that died three days ago. */}
        {trade.status === "open" && now !== null ? (
          <p className="text-sm text-text-muted">{expired ? formatExpired(trade.expiresAt) : formatExpiry(daysUntil(trade.expiresAt, new Date(now)))}</p>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row">
          <AssetList heading={givingHeading} assets={givingSide.assets} playersById={playersById} rosterById={rosterById} />
          <AssetList heading={gettingHeading} assets={gettingSide.assets} playersById={playersById} rosterById={rosterById} />
        </div>

        {trade.note === null ? null : <p className="break-words text-sm italic text-text-muted">{`"${trade.note}"`}</p>}

        {settled === null ? null : <p className="text-sm text-text-primary">{settled}</p>}

        {/* Plan D, Task 5: the ONE place a held trade's own words live — the two managers see it
            honestly (`counterpartyName` is always resolvable here, since a held trade is only
            ever visible to its own two parties, `tradesQuery`'s own privacy rule), and nobody
            else in the league ever renders this card in a `held` state at all. */}
        {trade.status === "held" ? (
          <HeldTradeBanner leagueName={leagueName ?? ""} counterpartyTeamName={counterpartyName ?? "your counterparty"} />
        ) : null}

        {isAnswerable ? (
          <div className="flex flex-col gap-3">
            {assessmentStatus === "idle" ? (
              <div>
                <Button variant="secondary" onClick={() => onRequestAssessment?.(trade.id)}>
                  See what the platform thinks of this trade
                </Button>
              </div>
            ) : assessmentStatus === "loading" ? (
              <p className="text-sm text-text-muted">Checking what the platform thinks of this trade.</p>
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
            {/* `gap-4`, never a tighter value: the one irreversible button pair in this product
                sits side by side, so the gap between them is a deliberate choice rather than
                whatever a flex row defaults to. */}
            <div className="flex flex-wrap gap-4">
              {/* LAW 5, AND THE DISTINCTION `Button`'s own docblock draws: *"`primary` is
                  ceremonial, one per view, the thing a page exists to do ONCE; `verb` is the thing
                  a board does forty times."* Answering an offer is the second kind — an inbox with
                  six open trades has six of these — while "Put an offer together" is the one
                  ceremonial act at the top of the page. Both were ink pills, which is two
                  competing verbs in ink on one screen, and that is the defect law 5 names rather
                  than the repetition it permits. `verb` is money-filled and `rounded-md`, so it is
                  unmistakably the act without being a second `primary`.

                  It stays paired with a `Modal` confirm: this is the one irreversible control pair
                  in the product, and making the verb obvious is not the same as making it easy to
                  press by accident. */}
              <Button variant="verb" onClick={() => setConfirmingAccept(true)} disabled={busy}>
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
            {/* Fix round 1, F6 (LOW), converged fully in fix round 2, F2: one completion name
                for this event throughout — the composer's own confirmation now says "Trade
                proposed." too, so this card and that screen agree on the word. Final review,
                HIGH 3: an offer that ran out is not still waiting for a reply, and saying so was
                the second half of the same lie the expiry line told. */}
            <p className="text-sm text-text-muted">{expired ? "Nobody answered before this ran out." : "Proposed. Waiting for a reply."}</p>
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
              Confirm trade
            </Button>
          </>
        }
      >
        <p>Both rosters change as soon as you accept. You can&apos;t undo it.</p>
      </Modal>
    </Card>
  );
}
