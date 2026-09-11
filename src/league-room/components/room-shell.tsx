"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { FreeAgentRow } from "@/league-service/claims-contract";
import type { TradeProposalView } from "@/trades/contract";
import type { RoomData } from "../contract";
import {
  CLOSED_DRAWER,
  DRAWER_SURFACES,
  drawerReduce,
  type DrawerEvent,
  type DrawerState,
  type DrawerSurface,
} from "../lib/drawer-state";
import { rankDropCandidates } from "../lib/claim-drop";
import { lineupFixPlans, type LineupFixPlan } from "../lib/lineup-problems";
import { managersFrom } from "../lib/managers";
import { stageFor } from "../lib/stage-priority";
import { usePresence } from "../hooks/use-presence";
import { useRailVisible } from "../hooks/use-rail-visible";
import { tradeSheetMath } from "../lib/trade-math";
import { ClaimSheet } from "./claim-sheet";
import { DraftGradesToggle } from "./draft-grades-toggle";
import { InvitePanel } from "./invite-panel";
import { LeagueMembersPanel } from "./league-members-panel";
import { LeagueTermsPanel } from "./league-terms-panel";
import { LineupFixSheet } from "./lineup-fix-sheet";
import { MatchupCelebration } from "./matchup-celebration";
import { ModerationSummary } from "./moderation-summary";
import { PlayerPeekHost } from "./player-peek";
import { RoomDrawer } from "./room-drawer";
import { RoomFront } from "./room-front";
import { RoomSpine } from "./room-spine";
import { RoomStageLive } from "./room-stage-live";
import { RoomSurfaceActivity } from "./room-surface-activity";
import { RoomSurfacePlayers } from "./room-surface-players";
import { RoomSurfaceStandings } from "./room-surface-standings";
import { RoomSurfaceTrades } from "./room-surface-trades";
import { RoomWeekStrip } from "./room-week-strip";
import { TradeSheet } from "./trade-sheet";
import { WaitingRoom } from "./waiting-room";

export interface RoomShellProps {
  readonly data: RoomData;
  /** Which surface the URL opened at full height — null for the room itself. */
  readonly initialSurface: DrawerSurface | null;
  readonly playoffTeams: number | null;
  /** `LEAGUE_CONFIG.regularSeasonWeeks`, threaded like `playoffTeams` (a plain constant as a
   *  prop — `@/league` is value-banned in `src/league-room/**`). The week story's playoff
   *  boundary; `null` makes no playoff claim at all. */
  readonly regularSeasonWeeks: number | null;
  readonly holdExpired: boolean;
}

type SheetState =
  | { readonly kind: "lineup"; readonly plan: LineupFixPlan }
  | { readonly kind: "trade"; readonly trade: TradeProposalView }
  | { readonly kind: "claim"; readonly agent: FreeAgentRow }
  | null;

function surfaceFromPathname(pathname: string, leagueId: string): DrawerSurface | null {
  const base = `/app/leagues/${leagueId}`;
  if (pathname === base) return null;
  const segment = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1) : null;
  return (DRAWER_SURFACES as readonly string[]).includes(segment ?? "") ? (segment as DrawerSurface) : null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="dialog"]') !== null
  );
}

/**
 * THE LEAGUE ROOM — one stage, following the clock (law 1), with the drawer's three heights
 * (law 2) and the decision sheets above both (law 3). This shell owns the two impure edges the
 * pure modules cannot: the URL (full height IS the route, synced through the native
 * `history.pushState` integration so the drawer animates in place) and the keyboard (space, /,
 * esc). Everything it decides, it decides by calling `stage-priority` and `drawer-state`.
 */
export function RoomShell({ data, initialSurface, playoffTeams, regularSeasonWeeks, holdExpired }: RoomShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { home } = data;
  const base = `/app/leagues/${home.leagueId}`;

  const [drawer, setDrawer] = useState<DrawerState>(() =>
    initialSurface === null ? CLOSED_DRAWER : { surface: initialSurface, height: "full", lastSurface: initialSurface },
  );
  const [sheet, setSheet] = useState<SheetState>(null);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const railVisible = useRailVisible();
  // Who is in the room (P5), seeded by the server's read and kept live off the league stream.
  const present = usePresence(home.leagueId, data.presentUserIds);
  const drawerRef = useRef(drawer);
  drawerRef.current = drawer;

  /** Apply an event AND keep the URL honest: entering full pushes the sub-route, leaving full
   *  returns to the room. `routeSync` events never push — the URL already moved. */
  const send = useCallback(
    (event: DrawerEvent) => {
      const state = drawerRef.current;
      const next = drawerReduce(state, event);
      if (event.kind !== "routeSync" && typeof window !== "undefined") {
        const wasFull = state.height === "full";
        const isFull = next.height === "full";
        if (isFull && (!wasFull || state.surface !== next.surface)) {
          window.history.pushState(null, "", `${base}/${next.surface}`);
        } else if (wasFull && !isFull) {
          window.history.pushState(null, "", base);
        }
      }
      setDrawer(next);
    },
    [base],
  );

  // The URL is the authority (law 2): deep links, back/forward and our own pushes all land here.
  useEffect(() => {
    const surface = surfaceFromPathname(pathname, home.leagueId);
    setDrawer((state) => drawerReduce(state, { kind: "routeSync", surface }));
  }, [pathname, home.leagueId]);

  // The `#invite-managers` anchor moves between the rail and the waiting stage with the
  // breakpoint (see `useRailVisible`'s docblock), so a load that arrives WITH the fragment can
  // find the element mounted only after the media query resolves — after the browser's own
  // anchor jump already came up empty. Walk the viewport to it once the right instance exists;
  // instant, not smooth, because it is an anchor jump (`StartOrJoinDisclosure`'s idiom).
  useEffect(() => {
    if (window.location.hash !== "#invite-managers") return;
    requestAnimationFrame(() => document.getElementById("invite-managers")?.scrollIntoView());
  }, [railVisible]);

  const sheetOpen = sheet !== null;
  useEffect(() => {
    if (home.draftStatus !== "complete") return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (sheetOpen || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        // A dialog above the room (a Modal, a decision sheet) owns its own escape.
        if (event.target instanceof HTMLElement && event.target.closest('[role="dialog"]') !== null) return;
        send({ kind: "esc" });
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (event.key === " ") {
        event.preventDefault();
        send({ kind: "space" });
      } else if (event.key === "/") {
        event.preventDefault();
        send({ kind: "slash" });
        setSearchFocusToken((token) => token + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [send, sheetOpen, home.draftStatus]);

  // The stage decision (law 1), pure and derived from what the page loaded.
  const myMatchupDetail =
    data.week === null || home.myTeamId === null
      ? null
      : (data.week.matchups.find(
          (matchup) => matchup.home.teamId === home.myTeamId || matchup.away.teamId === home.myTeamId,
        ) ?? null);
  const plans =
    data.lineup === null
      ? []
      : lineupFixPlans({
          lineup: data.lineup,
          rosterSlots: home.rosterSlots,
          fixturesByNflTeam: data.fixturesByNflTeam,
          projectionsByPlayerId: data.projectionsByPlayerId,
          weekStatus: home.weekStatus,
        });
  const inbox = data.trades?.inbox ?? [];
  const stage = stageFor({
    draftComplete: home.draftStatus === "complete",
    hasDraftSchedule: home.draftSchedule !== null,
    weekStatus: home.weekStatus,
    hasMyMatchup: myMatchupDetail !== null,
    lineupProblemCount: plans.length,
    actionableTradeCount: inbox.length,
  });
  const attentionCount = plans.length + inbox.length;
  const gamesLive =
    home.weekStatus === "in_progress" && data.week !== null ? data.week.gamesTotal - data.week.gamesFinal : null;
  const rosterFull =
    data.lineup !== null && [...data.lineup.starters, ...data.lineup.bench].every((slot) => slot.playerId !== null);
  const clinched = home.standings.some((row) => row.teamId === home.myTeamId && row.clinched);
  /**
   * EVERY TEAM'S MANAGER, keyed by team (P1: a Sunday screen shows people, and `MatchupSide`
   * carries a team name with nobody attached). The fact costs no new read: `home.standings` is
   * already in hand and carries every owner's display name, avatar and record. Joining the two is
   * work only this component can do, the same join `MatchupWeekPage` makes for its records.
   */
  const managersByTeamId = useMemo(() => managersFrom(home.standings), [home.standings]);

  const closeAndRefresh = useCallback(() => {
    setSheet(null);
    router.refresh();
  }, [router]);

  const surfaceContent = (surface: DrawerSurface) => {
    switch (surface) {
      case "players":
        return (
          <RoomSurfacePlayers
            leagueId={home.leagueId}
            canClaim={home.myTeamId !== null && home.draftStatus === "complete"}
            projectionsByPlayerId={data.projectionsByPlayerId}
            fixturesByNflTeam={data.fixturesByNflTeam}
            pendingClaims={data.pendingClaims}
            searchFocusToken={searchFocusToken}
            onClaim={(agent) => setSheet({ kind: "claim", agent })}
          />
        );
      case "standings":
        return <RoomSurfaceStandings home={home} playoffTeams={playoffTeams} />;
      case "trades":
        return <RoomSurfaceTrades leagueId={home.leagueId} tradeContext={data.tradeContext} />;
      case "activity":
        return (
          <RoomSurfaceActivity
            leagueId={home.leagueId}
            rows={data.activityRows}
            nextBefore={data.activityNextBefore}
            notices={data.activityNotices}
          />
        );
    }
  };

  return (
    <>
      <PlayerPeekHost />
      <MatchupCelebration
        matchup={home.myMatchup}
        myTeamId={home.myTeamId}
        clinched={clinched}
        leagueName={home.name}
        managers={managersByTeamId}
      />

      {/* The room is one framed stage: the week strip pins to its top, the chip row to its
          bottom, and the stage scrolls between them (the mock's own geometry). */}
      <div className="flex min-h-[75vh] flex-col overflow-hidden rounded-lg bg-surface pb-12 shadow-card md:pb-0 lg:h-[calc(100vh-7rem)] lg:min-h-0">
        <RoomWeekStrip home={home} attentionCount={attentionCount} gamesLive={gamesLive} />

        <div className="flex min-h-0 flex-1">
          <RoomSpine
            leagueId={home.leagueId}
            lineup={data.lineup}
            fixturesByNflTeam={data.fixturesByNflTeam}
            projectionsByPlayerId={data.projectionsByPlayerId}
          />

          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {stage === "waiting" && home.draftSchedule !== null ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <WaitingRoom
                  league={{
                    ...home.draftSchedule,
                    teamCount: home.teamCount,
                    authority: home.authority,
                    currentWeek: home.currentWeek,
                    totalWeeks: home.totalWeeks,
                  }}
                  isCommissioner={home.isCommissioner}
                  leagueName={home.name}
                  myTeamId={home.myTeamId}
                  justSeated={home.justSeated}
                  holdExpired={holdExpired}
                  format={home.format}
                  teams={home.teams}
                  compositionCategory={home.compositionCategory}
                  helpLevel={data.helpLevel}
                />
                {/* Link audit, 2026-09-04: `WaitingRoom`'s "Invite someone" links target
                    `#invite-managers`, which lived only in the rail — an aside that is `hidden`
                    below `xl`, so below 1280px the click did nothing and a commissioner had no
                    way to mint an invite at all. The ONE invite block mounts here instead when
                    the rail is off screen — never in both places, so the id stays unique and the
                    browser's own anchor jump always lands on a visible element. */}
                {home.isCommissioner && !railVisible ? (
                  <div id="invite-managers" className="mt-4">
                    <InvitePanel leagueId={home.leagueId} leagueName={home.name} />
                  </div>
                ) : null}
              </div>
            ) : stage === "live" && data.week !== null && myMatchupDetail !== null && home.myTeamId !== null ? (
              <RoomStageLive
                leagueId={home.leagueId}
                week={data.week}
                myMatchupDetail={myMatchupDetail}
                myTeamId={home.myTeamId}
                fixturesByNflTeam={data.fixturesByNflTeam}
                projectionsByPlayerId={data.projectionsByPlayerId}
                managers={managersByTeamId}
              />
            ) : (
              // THE FRONT PAGE (Sideline, 2026-09-10): your rival, the one verb, who is here,
              // and the stream. It replaced the attention stage and the standings pulse; the
              // full standings live in the drawer's own surface.
              <RoomFront
                home={home}
                lineup={data.lineup}
                week={data.week}
                regularSeasonWeeks={regularSeasonWeeks}
                plans={plans}
                inboxTrades={inbox}
                tradeContext={data.tradeContext}
                pendingClaims={data.pendingClaims}
                myMatchupDetail={myMatchupDetail}
                projectionsByPlayerId={data.projectionsByPlayerId}
                activityRows={data.activityRows}
                grades={data.grades}
                gradesBasis={data.gradesBasis}
                present={present}
                onFixLineup={(plan) => setSheet({ kind: "lineup", plan })}
                onViewTrade={(trade) => setSheet({ kind: "trade", trade })}
              />
            )}

            {home.draftStatus === "complete" ? (
              <RoomDrawer
                leagueId={home.leagueId}
                state={drawer}
                onChipTap={(surface) => send({ kind: "chipTap", surface })}
                onExpand={() => send({ kind: "expand" })}
                onEsc={() => send({ kind: "esc" })}
              >
                {drawer.surface === null ? null : surfaceContent(drawer.surface)}
              </RoomDrawer>
            ) : null}
          </div>

          {/* The rail: the terms, the members, and the commissioner's own tools. The chat left
              it for the front page's stream (P5: the room is not a chat tab), where every league
              screen can reach it in one tap. Narrow, and only at xl. */}
          <aside className="hidden w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-surface-elevated p-3 xl:flex">
            <LeagueTermsPanel terms={home.terms} titleAs="p" draftValue={home.draftStatus === "complete" ? "Complete" : undefined} />
            <LeagueMembersPanel
              teams={home.teams}
              teamCount={home.teamCount}
              authority={home.authority}
              myTeamId={home.myTeamId}
              compositionCategory={home.compositionCategory}
            />
            {/* Gated on `railVisible`, not rendered-and-hidden: the `#invite-managers` anchor
                must exist exactly once, on the visible instance — see the waiting stage's own
                copy of this block and `useRailVisible`'s docblock. */}
            {home.isCommissioner && railVisible ? (
              <div id="invite-managers">
                <InvitePanel leagueId={home.leagueId} leagueName={home.name} />
              </div>
            ) : null}
            {/* Task 10: the commissioner's own toggle for `GradeBoard`'s visibility. Gated on
                `draftStatus === "complete"` too — a league still waiting to draft has no grades
                for the flag to ever show or hide, so the control waits for the fact it controls
                to exist. */}
            {home.isCommissioner && home.draftStatus === "complete" ? (
              <DraftGradesToggle leagueId={home.leagueId} visible={home.draftGradesVisible} />
            ) : null}
            {home.isCommissioner ? <ModerationSummary leagueId={home.leagueId} /> : null}
          </aside>
        </div>
      </div>

      {sheet?.kind === "lineup" && data.lineup !== null ? (
        <LineupFixSheet
          leagueId={home.leagueId}
          weekNumber={home.currentWeek}
          lineup={data.lineup}
          rosterSlots={home.rosterSlots}
          plan={sheet.plan}
          onClose={() => setSheet(null)}
          onFixed={closeAndRefresh}
        />
      ) : null}

      {sheet?.kind === "trade" && data.tradeContext !== null ? (
        <TradeSheet
          leagueId={home.leagueId}
          trade={sheet.trade}
          context={data.tradeContext}
          math={tradeSheetMath({
            trade: sheet.trade,
            meTeamId: data.tradeContext.myTeamId,
            rostersByTeamId: data.tradeContext.rostersByTeamId,
            projectionsByPlayerId: data.projectionsByPlayerId,
            byeWeeksByNflTeam: data.byeWeeksByNflTeam,
            currentWeek: home.currentWeek,
          })}
          onClose={() => setSheet(null)}
          onCounter={() => {
            setSheet(null);
            send({ kind: "chipTap", surface: "trades" });
          }}
          onDecided={closeAndRefresh}
        />
      ) : null}

      {sheet?.kind === "claim" && data.lineup !== null ? (
        <ClaimSheet
          leagueId={home.leagueId}
          agent={sheet.agent}
          dropCandidates={rankDropCandidates(data.lineup.bench, data.projectionsByPlayerId)}
          rosterFull={rosterFull}
          onClose={() => setSheet(null)}
          onClaimed={closeAndRefresh}
        />
      ) : null}
    </>
  );
}
