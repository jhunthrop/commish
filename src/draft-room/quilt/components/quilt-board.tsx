"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { MICRO_LABEL } from "@/components/ui/config";
import { positionStickerClass } from "@/components/ui/position-badge";
import { buildQuiltRows, pickPlace, type QuiltRow } from "../state/board";
import { BOARD_HEIGHTS, planBoardHeights, type RowHeightPlan } from "../state/heights";
import { needsByTeam, pickValueVerdict, type Lens } from "../state/lens";
import { teamCodesById } from "../lib/team-code";
import { ManagerRow } from "./manager-row";
import { QuiltCellView } from "./quilt-cell";

export interface QuiltBoardProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string | null;
  readonly lens: Lens;
  /** NFL team code → bye week; empty map when the schedule has nothing to claim. */
  readonly byeWeeks: ReadonlyMap<string, number>;
  /** playerId → 1-based board rank, for the VALUE lens's verdicts. */
  readonly boardRanks: ReadonlyMap<string, number>;
  /** The running clock's reading for the on-clock cell, or null before the client clock snaps. */
  readonly clockLabel: string | null;
  readonly onPeek: (playerId: string) => void;
  readonly peekedPlayerId: string | null;
  /** Phone board tab: every round renders as micro tiles — 12 columns fit a 390pt frame only
   *  at tile size, and tap-to-inspect carries the detail (`MobileQuilt` mock). */
  readonly microOnly?: boolean;
}

const GRID = "grid gap-1.5";
/** A round row's grid: one implicit row clamped to the row box, so a cell can NEVER paint past
 *  its round — the 2026-09-03 shear bug was cells with their own minimum heights overflowing a
 *  squeezed row into the round below. */
const ROUND_GRID = `${GRID} min-h-0 overflow-hidden [grid-auto-rows:minmax(0,1fr)]`;
const gridColumns = (teamCount: number): { readonly gridTemplateColumns: string } => ({
  gridTemplateColumns: `44px repeat(${teamCount}, minmax(0, 1fr))`,
});

/**
 * The board's measured stage height, via ResizeObserver — the ONE number the height model
 * (`planBoardHeights`) turns into every row's exact height. jsdom has no ResizeObserver; there
 * (and on the first client paint) the model runs on `defaultBoardPx`, a roomy stage.
 */
function useBoardHeight(): { readonly ref: React.RefObject<HTMLDivElement | null>; readonly height: number } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number>(BOARD_HEIGHTS.defaultBoardPx);
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.height;
      if (measured !== undefined) setHeight(Math.round(measured));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, height };
}

/**
 * THE QUILT — the board that owns the stage. One CSS grid column set shared by the header, the
 * needs row and every round, so a lens switch or a compaction change never moves a column.
 * Rows come precomputed from `buildQuiltRows` (micro / full / track); this component only paints.
 */
export function QuiltBoard({ view, teams, playersById, myTeamId, lens, byeWeeks, boardRanks, clockLabel, onPeek, peekedPlayerId, microOnly = false }: QuiltBoardProps) {
  const built = useMemo(() => buildQuiltRows(view, myTeamId), [view, myTeamId]);
  const rows = useMemo(() => (microOnly ? built.map((row): QuiltRow => ({ ...row, kind: "micro" })) : built), [built, microOnly]);
  const codes = useMemo(() => teamCodesById(teams), [teams]);
  const names = useMemo(() => new Map(teams.map((team) => [team.id, team.name])), [teams]);
  const needs = useMemo(
    () => (lens === "needs" ? needsByTeam(view.slotConfig, view.rosters, view.draftOrder) : null),
    [lens, view.slotConfig, view.rosters, view.draftOrder],
  );
  const columns = gridColumns(view.draftOrder.length);

  // THE HEIGHT MODEL (2026-09-03 drawer-at-half fix): measure the stage once, let the pure
  // model hand every round its ONE height, and paint exactly that. Rows can no longer fight
  // the flexbox for space, so a squeezed stage compacts deterministically instead of shearing.
  const { ref: boardRef, height: boardHeight } = useBoardHeight();
  const kinds = useMemo(() => rows.map((row) => row.kind), [rows]);
  const plan = useMemo(
    () => planBoardHeights({ boardHeight, kinds, header: microOnly ? "codes" : "manager", needsRow: needs !== null }),
    [boardHeight, kinds, microOnly, needs],
  );

  return (
    <div ref={boardRef} data-testid="quilt-board" className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
      {/* THE MANAGER ROW (founder addition 1): every swimlane's manager as the column head.
          The phone's micro-quilt keeps the text initials instead — 12 columns at 390px leave
          ~22px per column, which cannot carry a readable face honestly (spec, mobile
          judgment). */}
      {microOnly ? (
        <div className={`${GRID} shrink-0 items-center overflow-hidden`} style={{ ...columns, height: BOARD_HEIGHTS.headerPx.codes }}>
          <div />
          {view.draftOrder.map((teamId) => (
            <div
              key={teamId}
              className={`text-center font-display text-xs font-bold tracking-wide ${teamId === myTeamId ? "text-accent" : teamId === view.onClockTeamId ? "text-text-primary" : "text-text-faint"}`}
            >
              <abbr title={names.get(teamId) ?? teamId} className="no-underline">
                {teamId === myTeamId ? "YOU" : (codes.get(teamId) ?? "")}
              </abbr>
            </div>
          ))}
        </div>
      ) : (
        <ManagerRow
          draftOrder={view.draftOrder}
          teams={teams}
          myTeamId={myTeamId}
          onClockTeamId={view.onClockTeamId}
          columns={columns}
          compact={plan.managerCompact}
        />
      )}

      {/* NEEDS lens: what every team still needs, as position dots — an added row, recolored
          facts, and the rounds grid stays beneath untouched (the lens law). */}
      {needs !== null ? (
        <div className={`${GRID} shrink-0`} style={{ ...columns, height: BOARD_HEIGHTS.needsRowPx }} data-testid="quilt-needs-row">
          <div className={`self-center text-right ${MICRO_LABEL} text-text-faint`}>needs</div>
          {view.draftOrder.map((teamId) => (
            <div key={teamId} className="flex h-full items-center justify-center gap-1 rounded-sm bg-surface-inset">
              {(needs.get(teamId) ?? []).map((position, index) => (
                <span key={`${position}-${index}`} title={`needs ${position}`} className={`h-2 w-2 rounded-full ${positionStickerClass(position)}`}>
                  <span className="sr-only">needs {position}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {rows.map((row, index) => (
        <QuiltRowView
          key={row.round}
          row={row}
          plan={plan.rows[index] ?? { height: BOARD_HEIGHTS.row.micro.preferred, label: false }}
          view={view}
          playersById={playersById}
          myTeamId={myTeamId}
          lens={lens}
          byeWeeks={byeWeeks}
          boardRanks={boardRanks}
          clockLabel={clockLabel}
          onPeek={onPeek}
          peekedPlayerId={peekedPlayerId}
          columns={columns}
        />
      ))}
    </div>
  );
}

interface QuiltRowViewProps extends Omit<QuiltBoardProps, "teams"> {
  readonly row: QuiltRow;
  /** The height model's word for this round: its ONE height, and whether the R-label shows. */
  readonly plan: RowHeightPlan;
  readonly columns: { readonly gridTemplateColumns: string };
}

/** The R-label sizes WITH its row, and under `labelMinPx` it leaves the stage entirely
 *  (sr-only keeps the round announced) — the documented never-overlap behavior. */
function RoundLabel({ row, plan }: { readonly row: QuiltRow; readonly plan: RowHeightPlan }) {
  return (
    <div
      className={`flex min-h-0 items-center justify-center overflow-hidden font-display font-bold ${
        plan.height >= BOARD_HEIGHTS.labelSmallPx ? "text-xs" : "text-[10px] leading-none"
      } ${row.kind === "full" ? "text-text-primary" : "text-text-faint"}`}
    >
      {plan.label ? `R${row.round}` : <span className="sr-only">R{row.round}</span>}
    </div>
  );
}

function QuiltRowView({ row, plan, view, playersById, myTeamId, lens, byeWeeks, boardRanks, clockLabel, onPeek, peekedPlayerId, columns }: QuiltRowViewProps) {
  const teamCount = view.draftOrder.length;
  const style = { ...columns, height: plan.height };

  if (row.kind === "micro") {
    return (
      // Micro tiles cap at the design's 14px sliver and center in whatever the model granted;
      // below 14px they shrink WITH the row, so the compacted past can never overflow it.
      <div className={ROUND_GRID} style={style} data-testid={`quilt-round-${row.round}`} data-round-kind="micro">
        <RoundLabel row={row} plan={plan} />
        {row.cells.map((cell) => {
          const player = cell.pick === null ? null : (playersById.get(cell.pick.playerId) ?? null);
          if (cell.pick === null || player === null) {
            // My own far-future cell keeps its amber promise even at micro height — as a tile
            // of the row's exact height, never taller than its siblings (the shear fix).
            const mine = cell.yourPickLabel !== null;
            return (
              <div
                key={cell.teamId}
                aria-hidden="true"
                className={`h-full max-h-3.5 min-h-0 self-center rounded-xs ${mine ? "border border-dashed border-accent bg-surface-raised" : "bg-surface-inset"} ${cell.onClock ? "outline-2 outline-live" : ""}`}
              />
            );
          }
          const mine = cell.teamId === myTeamId;
          return (
            <button
              key={cell.teamId}
              type="button"
              aria-label={`${player.name}, pick ${pickPlace(cell.pick, teamCount)}`}
              aria-pressed={peekedPlayerId === player.id}
              onClick={() => onPeek(player.id)}
              className={`h-full max-h-3.5 min-h-0 self-center rounded-xs focus-visible:outline-2 focus-visible:outline-accent ${positionStickerClass(player.position)} ${mine ? "outline-1 outline-accent" : ""} ${peekedPlayerId === player.id ? "ring-2 ring-accent" : ""}`}
            />
          );
        })}
      </div>
    );
  }

  return (
    // The present deserves the space: the model grants the active round the biggest share and
    // this component paints exactly that — 15 rounds, zero scroll, no dead stage under R15.
    <div className={ROUND_GRID} style={style} data-testid={`quilt-round-${row.round}`} data-round-kind={row.kind}>
      <RoundLabel row={row} plan={plan} />
      {row.cells.map((cell) => (
        <QuiltCellView
          key={cell.teamId}
          cell={cell}
          player={cell.pick === null ? null : (playersById.get(cell.pick.playerId) ?? null)}
          teamCount={teamCount}
          lens={lens}
          verdict={cell.pick === null ? null : pickValueVerdict(boardRanks.get(cell.pick.playerId), cell.pick.pickNumber)}
          byeWeek={cell.pick === null ? null : (byeWeeks.get(playersById.get(cell.pick.playerId)?.nflTeam ?? "") ?? null)}
          clockLabel={clockLabel}
          onPeek={onPeek}
          peeked={cell.pick !== null && peekedPlayerId === cell.pick.playerId}
          withFace={row.kind === "full"}
          rowHeight={plan.height}
        />
      ))}
    </div>
  );
}
