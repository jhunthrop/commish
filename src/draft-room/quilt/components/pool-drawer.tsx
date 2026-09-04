"use client";

import { useMemo } from "react";
import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import type { BoardReason } from "@/projections/preseason/board";
import type { CheatSheet } from "../state/sheet";
import type { CollapseEvent, ExpandedSurface } from "../state/collapse";
import { needFractions } from "../state/lens";
import { QUILT_CONFIG } from "../state/config";
import { DrawerHandles } from "./drawer-handles";
import { DrawerPoolTab } from "./drawer-pool-tab";
import { DrawerSheetTab } from "./drawer-sheet-tab";
import { DrawerRosterTab } from "./drawer-roster-tab";
import { DrawerByesTab } from "./drawer-byes-tab";
import { DrawerPicksTab } from "./drawer-picks-tab";
import type { RoomActs } from "./room-acts";

export interface PoolDrawerProps extends RoomActs {
  readonly surface: ExpandedSurface;
  readonly dispatch: (event: CollapseEvent) => void;
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly players: readonly Player[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string | null;
  readonly byeWeeks: ReadonlyMap<string, number>;
  readonly reasons: ReadonlyMap<string, readonly BoardReason[]>;
  readonly boardRanks: ReadonlyMap<string, number>;
  readonly sheet: CheatSheet;
  readonly onSheetMove: (playerId: string, delta: number) => void;
  readonly onSheetReset: () => void;
  readonly onSeedQueue: (playerIds: readonly string[]) => void;
  /** Draft HQ's sync contract (spec §4, Task 5) — whether the SHEET tab found a server sheet for
   *  this league. `false` offers "start your sheet" instead of the room's usual sheet controls. */
  readonly hasServerSheet: boolean;
  readonly onStartServerSheet: () => void;
}

/**
 * THE POOL DRAWER (law 2): three heights, one surface, and now — founder addition 2 — its tab
 * handles ride the top edge at EVERY height, collapsed included (`DrawerHandles`; the old
 * collapsed chip row retired with the mystery gesture it papered over). Half is a working list
 * over the quilt's lower edge; full IS the stage (the quilt hides beneath; one expanded surface
 * at a time). Space toggles, `/` opens search at full, Esc collapses — the keyboard map lives
 * in `use-room-keys`, and the handles dispatch the identical events.
 */
export function PoolDrawer(props: PoolDrawerProps) {
  const { surface, dispatch, view, myTeamId, byeWeeks } = props;
  const available = useMemo(() => new Set(view.availablePlayerIds), [view.availablePlayerIds]);
  const open = surface.kind === "drawer";
  const hasByes = byeWeeks.size > 0;
  const hasRoster = myTeamId !== null;

  // The Sleeper-grammar need fractions for the filter row (spec, addition 2): starting slots
  // vs the roster the room state already carries — filtering and needing become one glance.
  const needs = useMemo(
    () => (myTeamId === null ? [] : needFractions(view.slotConfig, view.rosters[myTeamId] ?? [])),
    [myTeamId, view.slotConfig, view.rosters],
  );

  if (!open) {
    return (
      <div id="dock-queue" data-testid="pool-drawer" data-drawer-height="collapsed" className="flex flex-col">
        {/* `player-pool` stays mounted for the tour's anchor even at rest. */}
        <div id="player-pool">
          <DrawerHandles surface={surface} dispatch={dispatch} hasByes={hasByes} hasRoster={hasRoster} />
        </div>
      </div>
    );
  }

  const { height, tab } = surface;
  return (
    <div
      id="dock-queue"
      data-testid="pool-drawer"
      data-drawer-height={height}
      className={`flex flex-col ${height === "full" ? "min-h-0 flex-1" : ""}`}
      style={height === "half" ? { height: QUILT_CONFIG.drawerHeight.half } : undefined}
    >
      <DrawerHandles surface={surface} dispatch={dispatch} hasByes={hasByes} hasRoster={hasRoster} />
      <div id="player-pool" className="flex min-h-0 flex-1 flex-col bg-surface-elevated px-4 py-2">
        {tab === "pool" ? (
          <DrawerPoolTab
            players={props.players}
            available={available}
            byeWeeks={props.byeWeeks}
            reasons={props.reasons}
            focusSearch={height === "full"}
            needs={needs}
            canDraft={props.canDraft}
            submitting={props.submitting}
            queuedPlayerIds={props.queuedPlayerIds}
            onDraft={props.onDraft}
            onQueueToggle={props.onQueueToggle}
            onPeek={props.onPeek}
          />
        ) : tab === "sheet" ? (
          <DrawerSheetTab
            sheet={props.sheet}
            playersById={props.playersById}
            boardRanks={props.boardRanks}
            available={available}
            onMove={props.onSheetMove}
            onSeedQueue={props.onSeedQueue}
            onReset={props.onSheetReset}
            canDraft={props.canDraft}
            submitting={props.submitting}
            onDraft={props.onDraft}
            onPeek={props.onPeek}
            hasServerSheet={props.hasServerSheet}
            onStartServerSheet={props.onStartServerSheet}
          />
        ) : tab === "roster" ? (
          <DrawerRosterTab view={view} myTeamId={props.myTeamId} playersById={props.playersById} onPeek={props.onPeek} />
        ) : tab === "byes" ? (
          <DrawerByesTab
            players={props.players}
            available={available}
            byeWeeks={props.byeWeeks}
            canDraft={props.canDraft}
            submitting={props.submitting}
            onDraft={props.onDraft}
            onPeek={props.onPeek}
          />
        ) : (
          <DrawerPicksTab view={view} teams={props.teams} playersById={props.playersById} myTeamId={props.myTeamId} onPeek={props.onPeek} />
        )}
      </div>
    </div>
  );
}
