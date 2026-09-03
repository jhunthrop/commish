"use client";

import { useMemo } from "react";
import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import type { BoardReason } from "@/projections/preseason/board";
import { Button, PositionBadge } from "@/components/ui";
import type { CheatSheet } from "../state/sheet";
import { DRAWER_TABS, type CollapseEvent, type DrawerTab, type ExpandedSurface } from "../state/collapse";
import { QUILT_CONFIG } from "../state/config";
import { shortName } from "./quilt-cell";
import { DrawerPoolTab } from "./drawer-pool-tab";
import { DrawerSheetTab } from "./drawer-sheet-tab";
import { DrawerByesTab } from "./drawer-byes-tab";
import { DrawerPicksTab } from "./drawer-picks-tab";
import type { RoomActs } from "./room-acts";

const TAB_LABEL: Readonly<Record<DrawerTab, string>> = {
  pool: "POOL",
  sheet: "MY SHEET",
  byes: "BYES",
  picks: "PICKS",
};

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
}

/**
 * THE POOL DRAWER (law 2): three heights, one surface. Collapsed it is the BEST AVAILABLE chip
 * row — the quilt keeps the stage. Half it is a working list over the quilt's lower edge. Full
 * it IS the stage (the quilt hides beneath; one expanded surface at a time). Space toggles,
 * `/` opens search at full, Esc collapses — the keyboard map lives in `use-room-keys`, and
 * every affordance here says its words.
 */
export function PoolDrawer(props: PoolDrawerProps) {
  const { surface, dispatch, view, players, byeWeeks } = props;
  const available = useMemo(() => new Set(view.availablePlayerIds), [view.availablePlayerIds]);
  const open = surface.kind === "drawer";
  const hasByes = byeWeeks.size > 0;

  if (!open) {
    const best = players.filter((player) => available.has(player.id)).slice(0, QUILT_CONFIG.bestAvailableCount);
    return (
      <div id="dock-queue" data-testid="pool-drawer" data-drawer-height="collapsed" className="flex flex-col gap-2 border-t border-line bg-surface-elevated px-4 py-2.5">
        <div id="player-pool" className="flex items-center gap-3">
          <span className="font-mono text-xs uppercase tracking-wide text-text-muted">Best available</span>
          <span className="h-px flex-1 bg-line" aria-hidden="true" />
          <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "TOGGLE_DRAWER" })}>
            Expand pool
          </Button>
        </div>
        {best.length === 0 ? null : (
          <div className="flex gap-2">
            {best.map((player) => (
              <div key={player.id} className="flex min-w-0 flex-1 items-center gap-2 rounded-sm bg-surface-raised px-2.5 py-1.5">
                <PositionBadge position={player.position} size="sm" />
                <button
                  type="button"
                  onClick={() => props.onPeek(player.id)}
                  className="min-w-0 truncate text-left font-display text-md font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {shortName(player.name)}
                </button>
                {props.canDraft ? (
                  <Button size="sm" variant="verb" className="ml-auto" disabled={props.submitting} onClick={() => props.onDraft(player.id)}>
                    Draft
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const { height, tab } = surface;
  return (
    <div
      id="dock-queue"
      data-testid="pool-drawer"
      data-drawer-height={height}
      className={`flex flex-col border-t border-line bg-surface-elevated ${height === "full" ? "min-h-0 flex-1" : ""}`}
      style={height === "half" ? { height: QUILT_CONFIG.drawerHeight.half } : undefined}
    >
      {/* The grab handle: a real button that walks the heights, not a decoration. */}
      <button
        type="button"
        aria-label={height === "full" ? "Shrink the pool to half" : "Expand the pool to full"}
        onClick={() => dispatch({ type: "SET_HEIGHT", height: height === "full" ? "half" : "full" })}
        className="flex items-center justify-center py-1.5 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span aria-hidden="true" className="h-1 w-12 rounded-pill bg-edge" />
      </button>
      <div className="flex items-center gap-1 border-b border-line px-4 pb-2">
        <div role="tablist" aria-label="Drawer tabs" className="flex items-center gap-1">
          {DRAWER_TABS.filter((candidate) => candidate !== "byes" || hasByes).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={tab === candidate}
              onClick={() => dispatch({ type: "SET_TAB", tab: candidate })}
              className={`rounded-sm px-3 py-1 font-display text-sm font-bold tracking-wide focus-visible:outline-2 focus-visible:outline-accent ${
                tab === candidate ? "bg-surface-raised text-accent" : "text-text-muted"
              }`}
            >
              {TAB_LABEL[candidate]}
            </button>
          ))}
        </div>
        <span className="ml-auto hidden font-mono text-xs uppercase tracking-wide text-text-faint lg:inline">space toggles · esc collapses</span>
        <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "COLLAPSE_ALL" })}>
          Collapse
        </Button>
      </div>
      <div id="player-pool" className="flex min-h-0 flex-1 flex-col px-4 py-2">
        {tab === "pool" ? (
          <DrawerPoolTab
            players={props.players}
            available={available}
            byeWeeks={props.byeWeeks}
            reasons={props.reasons}
            focusSearch={height === "full"}
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
          />
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
