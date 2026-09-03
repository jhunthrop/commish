import Link from "next/link";
import { Button, Card, PositionBadge } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { Position } from "@/domain/player";
import type { PendingWaiverClaim } from "@/league-service/claims";
import type { ActivityRow } from "@/integrity/activity-view";
import type { TradeProposalView } from "@/trades/contract";
import { assetPlayerIds } from "@/trades/assets";
import type { LeagueHomeBody, LineupBody, MatchupDetail, TradeRoomContext, TradeRosterPlayer } from "../contract";
import { RoomArrivalCard } from "./room-arrival-card";
import type { DrawerSurface } from "../lib/drawer-state";
import { formatPoints, formatRecord, formatWeekdayClock, ordinal } from "../lib/format";
import { slotLabelFor, type LineupFixPlan } from "../lib/lineup-problems";

export interface RoomStageAttentionProps {
  readonly home: LeagueHomeBody;
  /** The viewer's own lineup — the arrival card's roster on a week-1 visit. */
  readonly lineup: LineupBody | null;
  readonly plans: readonly LineupFixPlan[];
  readonly inboxTrades: readonly TradeProposalView[];
  readonly tradeContext: TradeRoomContext | null;
  readonly pendingClaims: readonly PendingWaiverClaim[];
  readonly myMatchupDetail: MatchupDetail | null;
  readonly projectionsByPlayerId: ReadonlyMap<string, number>;
  readonly activityRows: readonly ActivityRow[];
  readonly onFixLineup: (plan: LineupFixPlan) => void;
  readonly onViewTrade: (trade: TradeProposalView) => void;
  readonly onOpenSurface: (surface: DrawerSurface) => void;
}

const POSITION_WORD: Readonly<Record<Position, string>> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "receivers",
  TE: "tight ends",
  K: "kickers",
  DEF: "defenses",
};

function problemHeadline(plan: LineupFixPlan, home: LeagueHomeBody): string {
  const label = slotLabelFor(plan.problem, home.rosterSlots);
  if (plan.problem.reason === "empty") return `Your ${label} slot is empty`;
  if (plan.problem.reason === "bye") return `Your ${label} slot starts a player on bye`;
  return `Your ${label} slot starts a player ruled out`;
}

function problemEvidence(plan: LineupFixPlan): string {
  const playable = plan.candidates.filter((candidate) => (candidate.projection ?? 0) > 0).length;
  const opening =
    plan.problem.reason === "empty"
      ? "Nobody is in the slot."
      : plan.problem.reason === "bye"
        ? `${plan.problem.playerName ?? "Your starter"} sits this week.`
        : `${plan.problem.playerName ?? "Your starter"} is ruled out.`;
  if (plan.candidates.length === 0) return `${opening} No bench player fits the slot; the wire has options.`;
  if (playable === 0) return `${opening} ${plan.candidates.length} bench ${plan.candidates.length === 1 ? "player" : "players"} can fill it.`;
  return `${opening} ${playable} bench ${playable === 1 ? "player projects" : "players project"} higher than an empty slot.`;
}

function nameOf(playerId: string | undefined, rosters: TradeRoomContext | null): string {
  if (playerId === undefined || rosters === null) return "a player";
  for (const roster of Object.values(rosters.rostersByTeamId)) {
    const player = roster.find((entry) => entry.playerId === playerId);
    if (player !== undefined) return player.name;
  }
  return "a player";
}

function positionCount(roster: readonly TradeRosterPlayer[] | undefined, position: Position | null): number {
  if (roster === undefined || position === null) return 0;
  return roster.filter((player) => player.position === position).length;
}

function primaryIncoming(trade: TradeProposalView, context: TradeRoomContext | null): TradeRosterPlayer | null {
  if (context === null) return null;
  const incoming = trade.from.teamId === context.myTeamId ? trade.to.assets : trade.from.assets;
  const firstId = assetPlayerIds(incoming)[0];
  if (firstId === undefined) return null;
  for (const roster of Object.values(context.rostersByTeamId)) {
    const player = roster.find((entry) => entry.playerId === firstId);
    if (player !== undefined) return player;
  }
  return null;
}

function tradeHeadline(trade: TradeProposalView, context: TradeRoomContext | null): string {
  const iProposed = context !== null && trade.from.teamId === context.myTeamId;
  const otherName = iProposed ? trade.to.teamName : trade.from.teamName;
  const incoming = assetPlayerIds(iProposed ? trade.to.assets : trade.from.assets);
  const outgoing = assetPlayerIds(iProposed ? trade.from.assets : trade.to.assets);
  const incomingName = nameOf(incoming[0], context) + (incoming.length > 1 ? " and more" : "");
  const outgoingName = nameOf(outgoing[0], context) + (outgoing.length > 1 ? " and more" : "");
  return iProposed
    ? `Your offer to ${otherName}: ${outgoingName} for ${incomingName}`
    : `${otherName} offer ${incomingName} for ${outgoingName}`;
}

function tradeEvidence(trade: TradeProposalView, context: TradeRoomContext | null): string {
  const expiry = `Offer expires ${formatWeekdayClock(trade.expiresAt)}`;
  const incoming = primaryIncoming(trade, context);
  if (context === null || incoming === null || incoming.position === null) return expiry;
  const otherTeamId = trade.from.teamId === context.myTeamId ? trade.to.teamId : trade.from.teamId;
  const mine = positionCount(context.rostersByTeamId[context.myTeamId], incoming.position);
  const theirs = positionCount(context.rostersByTeamId[otherTeamId], incoming.position);
  if (mine === 0 && theirs === 0) return expiry;
  return `${expiry} · you carry ${mine} ${POSITION_WORD[incoming.position]}, they carry ${theirs}`;
}

function sideTotals(
  detail: MatchupDetail,
  myTeamId: string | null,
  projections: ReadonlyMap<string, number>,
): { readonly mine: number; readonly theirs: number } | null {
  if (projections.size === 0 || myTeamId === null) return null;
  const total = (side: MatchupDetail["home"]): number =>
    side.starters.reduce((sum, entry) => sum + (entry.playerId === null ? 0 : (projections.get(entry.playerId) ?? 0)), 0);
  const iAmHome = detail.home.teamId === myTeamId;
  return {
    mine: total(iAmHome ? detail.home : detail.away),
    theirs: total(iAmHome ? detail.away : detail.home),
  };
}

/**
 * THE RESTING ROOM'S STAGE — law 1's third and fourth rungs on one surface. The cards the room
 * deals (each a finished diagnosis whose verb opens a decision sheet), the filed-claim notices
 * that need nothing, and the league's pulse in one glance: standings, the next matchup, what
 * happened since the viewer left.
 */
export function RoomStageAttention(props: RoomStageAttentionProps) {
  const { home, lineup, plans, inboxTrades, tradeContext, pendingClaims, myMatchupDetail, projectionsByPlayerId, activityRows } = props;
  const hasCards = plans.length > 0 || inboxTrades.length > 0;
  const totals = myMatchupDetail === null ? null : sideTotals(myMatchupDetail, home.myTeamId, projectionsByPlayerId);
  const opponentName =
    myMatchupDetail === null || home.myTeamId === null
      ? null
      : myMatchupDetail.home.teamId === home.myTeamId
        ? myMatchupDetail.away.teamName
        : myMatchupDetail.home.teamName;
  const myRow = home.standings.find((row) => row.teamId === home.myTeamId) ?? null;
  const pulseRows = home.standings.slice(0, 4);
  const myRowOutsideTop = myRow !== null && !pulseRows.some((row) => row.teamId === myRow.teamId);

  const projectedLine =
    totals === null ? null : `projected ${formatPoints(totals.mine)} to ${formatPoints(totals.theirs)}, ${totals.mine >= totals.theirs ? "your favor" : "their favor"}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      {/* THE ARRIVAL MOMENT (review HIGH 1): week 1 only, the top card, everything else beneath. */}
      {home.draftStatus === "complete" && home.currentWeek === 1 && lineup !== null ? (
        <RoomArrivalCard
          leagueId={home.leagueId}
          draftId={home.draftId}
          lineup={lineup}
          matchup={home.myMatchup}
          projectedLine={projectedLine}
        />
      ) : null}

      {hasCards ? <p className={`${MICRO_LABEL} text-text-faint`}>Needs you before Sunday</p> : null}

      {plans.map((plan) => (
        <Card
          key={`${plan.problem.slot}-${plan.problem.slotIndex}`}
          padding="compact"
          className="flex items-center gap-3 border-accent"
        >
          {plan.problem.position === null ? null : <PositionBadge position={plan.problem.position} size="md" />}
          <div className="flex min-w-0 flex-col">
            <p className="font-display text-md font-semibold text-text-primary">{problemHeadline(plan, home)}</p>
            <p className="text-sm text-text-muted">{problemEvidence(plan)}</p>
          </div>
          <Button variant="verb" size="sm" className="ml-auto shrink-0" onClick={() => props.onFixLineup(plan)}>
            Fix lineup
          </Button>
        </Card>
      ))}

      {inboxTrades.map((trade) => (
        <Card key={trade.id} padding="compact" className="flex items-center gap-3">
          {(() => {
            const incoming = primaryIncoming(trade, tradeContext);
            return incoming === null ? null : <PositionBadge position={incoming.position} size="md" />;
          })()}
          <div className="flex min-w-0 flex-col">
            <p className="font-display text-md font-semibold text-text-primary">{tradeHeadline(trade, tradeContext)}</p>
            <p className="text-sm text-text-muted">{tradeEvidence(trade, tradeContext)}</p>
          </div>
          <Button variant="secondary" size="sm" className="ml-auto shrink-0" onClick={() => props.onViewTrade(trade)}>
            View trade
          </Button>
        </Card>
      ))}

      {pendingClaims.map((claim) => (
        <Card key={claim.claimId} padding="compact" className="flex items-center gap-3 bg-surface-inset">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-edge" aria-hidden />
          <p className="text-sm text-text-muted">
            Your waiver claim on <span className="font-display font-semibold text-text-primary">{claim.playerName}</span> is{" "}
            {ordinal(claim.queuePosition)} in line · clears {formatWeekdayClock(claim.clearsAt)}
          </p>
          <span className="ml-auto shrink-0 font-mono text-xs text-text-faint">no action needed</span>
        </Card>
      ))}

      <p className={`${MICRO_LABEL} mt-2 text-text-faint`}>The league this week</p>
      <div className="grid flex-1 content-start gap-3 lg:grid-cols-3">
        <Card padding="compact" className="flex flex-col gap-1.5">
          <p className={`${MICRO_LABEL} text-text-faint`}>Standings pulse</p>
          {pulseRows.map((row) => (
            <p
              key={row.teamId}
              className={`flex items-baseline gap-2 text-sm ${row.teamId === home.myTeamId ? "accent-wash rounded-sm text-accent" : ""}`}
            >
              <span className="w-4 font-mono text-text-faint">{row.rank}</span>
              <span className="font-display font-semibold">{row.teamName}</span>
              <span className="ml-auto font-mono text-text-muted">
                {formatRecord(row)} · {formatPoints(row.pointsFor)}
              </span>
            </p>
          ))}
          {myRowOutsideTop && myRow !== null ? (
            <p className="accent-wash flex items-baseline gap-2 rounded-sm text-sm text-accent">
              <span className="w-4 font-mono">{myRow.rank}</span>
              <span className="font-display font-semibold">{myRow.teamName}</span>
              <span className="ml-auto font-mono">
                {formatRecord(myRow)} · {formatPoints(myRow.pointsFor)}
              </span>
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => props.onOpenSurface("standings")}
            className="mt-auto self-start text-xs text-text-faint hover:text-accent"
          >
            Full standings live in the drawer
          </button>
        </Card>

        <Card padding="compact" className="flex flex-col gap-1.5">
          <p className={`${MICRO_LABEL} text-text-faint`}>Your next matchup</p>
          {opponentName === null ? (
            <p className="text-sm text-text-muted">No matchup this week.</p>
          ) : (
            <>
              <p className="font-display text-md font-semibold text-text-primary">vs {opponentName}</p>
              {totals === null ? null : (
                <p className="font-mono text-sm text-text-muted">
                  projected {formatPoints(totals.mine)} to {formatPoints(totals.theirs)},{" "}
                  {totals.mine >= totals.theirs ? "your favor" : "their favor"}
                </p>
              )}
              <Link
                href={`/app/leagues/${home.leagueId}/matchups/${home.currentWeek}`}
                className="mt-auto text-xs text-accent"
              >
                Full matchup
              </Link>
            </>
          )}
        </Card>

        <Card padding="compact" className="flex flex-col gap-1.5">
          <p className={`${MICRO_LABEL} text-text-faint`}>Since you left</p>
          {activityRows.length === 0 ? (
            <p className="text-sm text-text-muted">Nothing new since your last visit.</p>
          ) : (
            activityRows.slice(0, 3).map((row) => (
              <p key={row.eventId} className="text-sm text-text-muted">
                {row.headline}
              </p>
            ))
          )}
          <button
            type="button"
            onClick={() => props.onOpenSurface("activity")}
            className="mt-auto self-start text-xs text-text-faint hover:text-accent"
          >
            All activity
          </button>
        </Card>
      </div>
    </div>
  );
}
