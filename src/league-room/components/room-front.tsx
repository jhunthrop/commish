"use client";

import type { PendingWaiverClaim } from "@/league-service/claims-contract";
import type { ActivityFeedRow } from "@/integrity-service/activity";
import type { TradeProposalView } from "@/trades/contract";
import type { LeagueGradeRow, LeagueHomeBody, LineupBody, MatchupDetail, MatchupWeekBody, TradeRoomContext } from "../contract";
import type { LineupFixPlan } from "../lib/lineup-problems";
import type { EventReactionMap } from "../lib/stream-reactions";
import { GradeBoard } from "./grade-board";
import { MomentVerb, momentFor } from "./moment-verb";
import { RivalCard } from "./rival-card";
import { RoomArrivalCard } from "./room-arrival-card";
import { RoomStream } from "./room-stream";
import { WhoIsHere } from "./who-is-here";

export interface RoomFrontProps {
  readonly home: LeagueHomeBody;
  readonly lineup: LineupBody | null;
  readonly week: MatchupWeekBody | null;
  readonly regularSeasonWeeks: number | null;
  readonly plans: readonly LineupFixPlan[];
  readonly inboxTrades: readonly TradeProposalView[];
  readonly tradeContext: TradeRoomContext | null;
  readonly pendingClaims: readonly PendingWaiverClaim[];
  readonly myMatchupDetail: MatchupDetail | null;
  readonly projectionsByPlayerId: ReadonlyMap<string, number>;
  readonly activityRows: readonly ActivityFeedRow[];
  /** Every reaction already standing on those rows, as the server read them. */
  readonly eventReactions: EventReactionMap;
  readonly grades: readonly LeagueGradeRow[];
  readonly gradesBasis: string;
  /** Who has a live connection right now (`usePresence`). */
  readonly present: ReadonlySet<string>;
  readonly onFixLineup: (plan: LineupFixPlan) => void;
  readonly onViewTrade: (trade: TradeProposalView) => void;
}

/** The viewer's own user id, from their team's card. A commissioner with no team has none. */
function meUserIdOf(home: LeagueHomeBody): string | null {
  return home.teams.find((team) => team.id === home.myTeamId)?.ownerUserId ?? null;
}

/**
 * THE LEAGUE'S FRONT PAGE (where P5, P6 and P12 meet): your opponent this week with a face and a
 * score at the top, the one verb for the moment, who is around, and everything that changed as
 * one stream with the say-something field at its foot. One column on a phone; on a wide screen
 * the stream keeps the left and the three cards ride the right, still one column each, because
 * the stream is one column always.
 */
export function RoomFront(props: RoomFrontProps) {
  const { home, lineup, week, plans, inboxTrades, tradeContext, pendingClaims, myMatchupDetail, projectionsByPlayerId, activityRows, present } = props;
  const meUserId = meUserIdOf(home);
  const sendIsTheAct = momentFor(plans, inboxTrades) === null;
  // On a wide screen the stage is a fixed-height frame (the shell's own geometry), so the stream
  // column scrolls inside it and the say-something field stays at its foot; the cards on the
  // right scroll on their own. On a phone the page scrolls as one column and the field is at
  // the foot of the page.
  return (
    <div data-testid="room-front" className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:overflow-hidden">
      <div className="flex flex-col gap-4 lg:order-2 lg:min-h-0 lg:overflow-y-auto">
        <RivalCard home={home} week={week} myMatchupDetail={myMatchupDetail} projectionsByPlayerId={projectionsByPlayerId} regularSeasonWeeks={props.regularSeasonWeeks} />
        <MomentVerb home={home} plans={plans} inboxTrades={inboxTrades} tradeContext={tradeContext} pendingClaims={pendingClaims} onFixLineup={props.onFixLineup} onViewTrade={props.onViewTrade} />
        <WhoIsHere teams={home.teams} present={present} meUserId={meUserId} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 lg:order-1 lg:overflow-hidden">
        {home.draftStatus === "complete" && home.currentWeek === 1 && lineup !== null ? (
          <RoomArrivalCard leagueId={home.leagueId} draftId={home.draftId} lineup={lineup} matchup={home.myMatchup} projectedLine={null} />
        ) : null}
        <GradeBoard grades={props.grades} basis={props.gradesBasis} />
        <RoomStream leagueId={home.leagueId} activityRows={activityRows} eventReactions={props.eventReactions} sendIsTheAct={sendIsTheAct} />
      </div>
    </div>
  );
}
