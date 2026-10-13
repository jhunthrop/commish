"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Player } from "@research-ts/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { positionStickerClass } from "@/components/ui/position-badge";
import { MOTION } from "@/design/motion";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { useReusedValue } from "@/design/use-stable-list";
import { buildQuiltRows, pickPlace, reuseQuiltRows, type QuiltRow } from "../state/board";
import { BOARD_HEIGHTS, planBoardHeights } from "../state/heights";
import { teamCodesById } from "../lib/team-code";
import { ManagerRow } from "./manager-row";
import { QuiltCellView, landingClassFor } from "./quilt-cell";

export interface QuiltBoardProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string | null;
  readonly onPeek: (playerId: string) => void;
  readonly peekedPlayerId: string | null;
  /** A manager head opens that team's roster sheet; the open one reads pressed. */
  readonly onOpenRoster: (teamId: string) => void;
  readonly openRosterTeamId: string | null;
  /** Phone board: every round renders as micro tiles (12 columns fit a 360pt frame only at tile
   *  size) and the strip beside it carries the detail. */
  readonly microOnly?: boolean;
}

interface GridColumns {
  readonly gridTemplateColumns: string;
}

const GRID = "grid gap-1.5";
/** A round row's grid: one implicit row clamped to the row box, so a cell can NEVER paint past
 *  its round (the 2026-09-03 shear bug was cells with their own minimum heights overflowing). */
const ROUND_GRID = `${GRID} min-h-0 overflow-hidden [grid-auto-rows:minmax(0,1fr)] ${MOTION.resize.className}`;
const gridColumns = (teamCount: number): GridColumns => ({
  gridTemplateColumns: `36px repeat(${teamCount}, minmax(0, 1fr))`,
});

/** The board's measured stage height, via ResizeObserver: the ONE number the height model turns
 *  into every row's exact height. jsdom has no ResizeObserver; there (and on the first client
 *  paint) the model runs on `defaultBoardPx`. */
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

/** The rows, with every round the view left untouched keeping its previous object
 *  (`reuseQuiltRows`), so the memoized rows below re-render only where the board changed. */
function useStableRows(view: DraftStateView, myTeamId: string | null, microOnly: boolean): readonly QuiltRow[] {
  const built = useMemo(() => {
    const rows = buildQuiltRows(view, myTeamId);
    return microOnly ? rows.map((row): QuiltRow => ({ ...row, kind: "micro" })) : rows;
  }, [view, myTeamId, microOnly]);
  return useReusedValue(built, reuseQuiltRows);
}

/**
 * THE WALL: picks as faces on the grid, every manager a face at the head of a column. One CSS
 * grid column set shared by the heads and every round, so a compaction change never moves a
 * column. Rows come precomputed from `buildQuiltRows`; this component only paints.
 *
 * A PICK LANDING IS ONE CELL SETTLING (fluidity round): the rows are memoized on stable row
 * objects, the running clock is a leaf inside the on-clock cell, the deadline reaches only the
 * round whose clock is running and the peeked id only the round that holds him. A cell that
 * landed after this board mounted wears its entrance once (the self pick's slap-in at
 * celebration scale, a peer's spring); the picks already on the board at mount never animate.
 */
export const QuiltBoard = memo(function QuiltBoard({ view, teams, playersById, myTeamId, onPeek, peekedPlayerId, onOpenRoster, openRosterTeamId, microOnly = false }: QuiltBoardProps) {
  const rows = useStableRows(view, myTeamId, microOnly);
  const codes = useMemo(() => teamCodesById(teams), [teams]);
  const names = useMemo(() => new Map(teams.map((team) => [team.id, team.name])), [teams]);
  const teamCount = view.draftOrder.length;
  const columns = useMemo(() => gridColumns(teamCount), [teamCount]);
  const reducedMotion = usePrefersReducedMotion();
  const [maxPickAtMount] = useState(() => Math.max(0, ...view.picks.map((pick) => pick.pickNumber)));
  const peekedRound = useMemo(() => (peekedPlayerId === null ? null : (view.picks.find((pick) => pick.playerId === peekedPlayerId)?.round ?? null)), [peekedPlayerId, view.picks]);

  const { ref: boardRef, height: boardHeight } = useBoardHeight();
  const plan = useMemo(
    () => planBoardHeights({ boardHeight, kinds: rows.map((row) => row.kind), header: microOnly ? "codes" : "manager", needsRow: false }),
    [boardHeight, rows, microOnly],
  );

  return (
    <div ref={boardRef} data-testid="quilt-board" className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
      {microOnly ? (
        <div className={`${GRID} shrink-0 items-center overflow-hidden`} style={{ ...columns, height: BOARD_HEIGHTS.headerPx.codes }}>
          <div />
          {view.draftOrder.map((teamId) => (
            <div key={teamId} className={`text-center font-display text-xs font-bold ${teamId === myTeamId ? "text-self-ink" : teamId === view.onClockTeamId ? "text-live" : "text-text-faint"}`}>
              <abbr title={names.get(teamId) ?? teamId} className="no-underline">
                {teamId === myTeamId ? "You" : (codes.get(teamId) ?? "")}
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
          onOpenRoster={onOpenRoster}
          openRosterTeamId={openRosterTeamId}
        />
      )}

      {rows.map((row, index) => {
        const rowPlan = plan.rows[index] ?? { height: BOARD_HEIGHTS.row.micro.preferred, label: false };
        return (
          <QuiltRowView
            key={row.round}
            row={row}
            height={rowPlan.height}
            label={rowPlan.label}
            teamCount={teamCount}
            playersById={playersById}
            myTeamId={myTeamId}
            deadlineAt={row.cells.some((cell) => cell.onClock) ? view.deadlineAt : null}
            onPeek={onPeek}
            peekedPlayerId={row.round === peekedRound ? peekedPlayerId : null}
            columns={columns}
            settleAfterPick={maxPickAtMount}
            reducedMotion={reducedMotion}
          />
        );
      })}
    </div>
  );
});

interface QuiltRowViewProps extends Pick<QuiltBoardProps, "playersById" | "myTeamId" | "onPeek" | "peekedPlayerId"> {
  readonly row: QuiltRow;
  /** The height model's word for this round: its ONE height, and whether the R-label shows. */
  readonly height: number;
  readonly label: boolean;
  readonly teamCount: number;
  /** The running deadline when this round holds the on-clock cell; null for every other round. */
  readonly deadlineAt: string | null;
  readonly columns: GridColumns;
  /** Picks numbered above this landed after mount and wear an entrance. */
  readonly settleAfterPick: number;
  readonly reducedMotion: boolean;
}

/** The R-label sizes WITH its row, and under `labelMinPx` it leaves the stage (sr-only keeps
 *  the round announced). */
function RoundLabel({ row, height, label }: { readonly row: QuiltRow; readonly height: number; readonly label: boolean }) {
  return (
    <div className={`flex min-h-0 items-center justify-center overflow-hidden font-display font-bold ${height >= BOARD_HEIGHTS.labelSmallPx ? "text-xs" : "text-[10px] leading-none"} ${row.kind === "full" ? "text-text-muted" : "text-text-faint"}`}>
      {label ? row.round : <span className="sr-only">Round {row.round}</span>}
    </div>
  );
}

const QuiltRowView = memo(function QuiltRowView({ row, height, label, teamCount, playersById, myTeamId, deadlineAt, onPeek, peekedPlayerId, columns, settleAfterPick, reducedMotion }: QuiltRowViewProps) {
  const style = { ...columns, height };

  if (row.kind === "micro") {
    return (
      <div className={ROUND_GRID} style={style} data-testid={`quilt-round-${row.round}`} data-round-kind="micro">
        <RoundLabel row={row} height={height} label={label} />
        {row.cells.map((cell) => {
          const player = cell.pick === null ? null : (playersById.get(cell.pick.playerId) ?? null);
          if (cell.pick === null || player === null) {
            const mine = cell.yourPickLabel !== null;
            return (
              <div
                key={cell.teamId}
                aria-hidden="true"
                className={`h-full max-h-3.5 min-h-0 self-center rounded-xs ${mine ? "border border-dashed border-self" : "bg-surface-inset"} ${cell.onClock ? "outline-2 outline-accent" : ""}`}
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
              className={`h-full max-h-3.5 min-h-0 self-center rounded-xs focus-visible:outline-2 focus-visible:outline-accent ${positionStickerClass(player.position)} ${mine ? "outline-1 outline-self" : ""} ${peekedPlayerId === player.id ? "ring-2 ring-accent" : ""}`}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className={ROUND_GRID} style={style} data-testid={`quilt-round-${row.round}`} data-round-kind={row.kind}>
      <RoundLabel row={row} height={height} label={label} />
      {row.cells.map((cell) => {
        const mine = cell.teamId === myTeamId;
        return (
          <QuiltCellView
            key={cell.teamId}
            cell={cell}
            player={cell.pick === null ? null : (playersById.get(cell.pick.playerId) ?? null)}
            teamCount={teamCount}
            deadlineAt={cell.onClock ? deadlineAt : null}
            onPeek={onPeek}
            peeked={cell.pick !== null && peekedPlayerId === cell.pick.playerId}
            withFace={row.kind === "full"}
            rowHeight={height}
            mine={mine}
            landingClass={landingClassFor(cell.pick !== null && cell.pick.pickNumber > settleAfterPick, mine, reducedMotion)}
          />
        );
      })}
    </div>
  );
});
