import { Button, Card, PositionBadge } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { Position } from "@/domain/player";
import type { PendingWaiverClaim } from "@/league-service/claims";
import type { ActivityRow } from "@/integrity/activity-view";
import type { TradeProposalView } from "@/trades/contract";
import { assetPlayerIds } from "@/trades/assets";
import type { LeagueGradeRow, LeagueHomeBody, LineupBody, MatchupDetail, MatchupWeekBody, TradeRoomContext, TradeRosterPlayer } from "../contract";
import { GradeBoard } from "./grade-board";
import { RoomArrivalCard } from "./room-arrival-card";
import { RoomSurfaceStandings } from "./room-surface-standings";
import { RoomWeekStory } from "./room-week-story";
import type { DrawerSurface } from "../lib/drawer-state";
import { formatPoints, formatRecord, formatWeekdayClock, ordinal } from "../lib/format";
import { slotLabelFor, type LineupFixPlan } from "../lib/lineup-problems";
import { weekStoryFor } from "../lib/week-story";

export interface RoomStageAttentionProps {
  readonly home: LeagueHomeBody;
  /** The viewer's own lineup — the arrival card's roster on a week-1 visit. */
  readonly lineup: LineupBody | null;
  /** The whole current-week slate the room already loaded — the week story's picture of the
   *  league when the viewer has no matchup of their own. */
  readonly week: MatchupWeekBody | null;
  /** `LEAGUE_CONFIG.regularSeasonWeeks`, threaded from the page (`standings-table.tsx`'s own
   *  playoffTeams reasoning: a plain constant as a prop, because `@/league` is value-banned here). */
  readonly regularSeasonWeeks: number | null;
  /** `LEAGUE_CONFIG.playoffTeams`, for the full standings table's cut line. */
  readonly playoffTeams: number | null;
  readonly plans: readonly LineupFixPlan[];
  readonly inboxTrades: readonly TradeProposalView[];
  readonly tradeContext: TradeRoomContext | null;
  readonly pendingClaims: readonly PendingWaiverClaim[];
  readonly myMatchupDetail: MatchupDetail | null;
  readonly projectionsByPlayerId: ReadonlyMap<string, number>;
  readonly activityRows: readonly ActivityRow[];
  /** Task 10: the league's own stored draft grades, joined to team names — empty unless the
   *  draft is complete, the commissioner has opted in, and the grading job has written its rows
   *  (`RoomData.grades`'s own docblock names both gaps). `GradeBoard` renders nothing for an
   *  empty array, so this stage never checks `home.draftGradesVisible` itself. */
  readonly grades: readonly LeagueGradeRow[];
  /** The evidence board's own generation, pre-formatted for `GradeBoard`'s fine print. */
  readonly gradesBasis: string;
  /** True while any drawer surface is open over the stage. The expanded pulse yields to the
   *  compact row then — the collapse law's own rule (a surface borrows space and the stage
   *  gives it back), and it keeps the drawer's standings from doubling the stage's. */
  readonly drawerOpen: boolean;
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

/** The league's recent history as a pulse card — the same rows the activity surface serves,
 *  first `limit` of them. Rendered ONLY when there are rows: null is absent, so a league with
 *  nothing to report gets no box saying "nothing new". */
function ActivityGlanceCard({
  rows,
  limit,
  onOpen,
}: {
  readonly rows: readonly ActivityRow[];
  readonly limit: number;
  readonly onOpen: () => void;
}) {
  return (
    <Card padding="compact" className="flex flex-col gap-1.5">
      <p className={`${MICRO_LABEL} text-text-faint`}>Since you left</p>
      {rows.slice(0, limit).map((row) => (
        <p key={row.eventId} className="text-sm text-text-muted">
          {row.headline}
        </p>
      ))}
      <button type="button" onClick={onOpen} className="mt-auto self-start text-xs text-text-faint hover:text-accent">
        All activity
      </button>
    </Card>
  );
}

/**
 * THE RESTING ROOM'S STAGE — law 1's third and fourth rungs on one surface. The cards the room
 * deals (each a finished diagnosis whose verb opens a decision sheet), the filed-claim notices
 * that need nothing, and the league's pulse.
 *
 * THE PULSE FILLS THE STAGE (founder defect, 2026-09-03: "the league home landing page feels
 * empty"). One stage that owns the room means spending the space: when no attention cards are
 * dealt, the pulse stops being three teaser cards over a void and becomes the room — the full
 * standings table the /standings surface renders as the main column, the week story beside it,
 * and the league's recent history under that. When cards ARE dealt, the compact three-seat pulse
 * row stays beneath them exactly as before — the cards are the story then, and the pulse is
 * the glance.
 */
export function RoomStageAttention(props: RoomStageAttentionProps) {
  const { home, lineup, week, plans, inboxTrades, tradeContext, pendingClaims, myMatchupDetail, projectionsByPlayerId, activityRows } = props;
  const hasCards = plans.length > 0 || inboxTrades.length > 0;
  // The expanded pulse and an open drawer never share the room: while a surface borrows the
  // stage's space, the pulse falls back to its compact row (and the drawer's own standings
  // table is the only one in the DOM).
  const compactPulse = hasCards || props.drawerOpen;
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

  const story = weekStoryFor({
    week,
    hasMyMatchup: myMatchupDetail !== null,
    standings: home.standings,
    regularSeasonWeeks: props.regularSeasonWeeks,
  });

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

      {/* Task 10, the morning-after board: right beside the arrival moment when both land on the
          same week-1 visit, and on its own every later week a member returns to a league whose
          grades are still opted in. `GradeBoard` renders nothing for an empty `grades`, so no
          extra gate is checked here. */}
      <GradeBoard grades={props.grades} basis={props.gradesBasis} />

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
      {compactPulse ? (
        // THE COMPACT PULSE ROW — unchanged beneath the dealt cards: the cards are the stage's
        // story, and the pulse is a glance.
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

          <RoomWeekStory home={home} story={story} opponentName={opponentName} projectedLine={projectedLine} />

          {activityRows.length === 0 ? null : (
            <ActivityGlanceCard rows={activityRows} limit={3} onOpen={() => props.onOpenSurface("activity")} />
          )}
        </div>
      ) : (
        // THE PULSE AS THE ROOM — no cards dealt, so the pulse spends the stage: the full
        // standings table (the /standings surface's own component, amber rail on the viewer's
        // row) as the main column, the week story and the league's recent history beside it.
        // A league with no activity at all omits that card entirely (null is absent) and
        // standings plus the week story share the width.
        <div className="grid flex-1 content-start gap-3 lg:grid-cols-3">
          <Card padding="compact" className="min-w-0 lg:col-span-2">
            <RoomSurfaceStandings home={home} playoffTeams={props.playoffTeams} />
          </Card>
          <div className="flex min-w-0 flex-col gap-3">
            <RoomWeekStory home={home} story={story} opponentName={opponentName} projectedLine={projectedLine} />
            {activityRows.length === 0 ? null : (
              <ActivityGlanceCard rows={activityRows} limit={8} onOpen={() => props.onOpenSurface("activity")} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
