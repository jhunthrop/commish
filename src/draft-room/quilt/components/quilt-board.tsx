"use client";

import { useMemo } from "react";
import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { MICRO_LABEL } from "@/components/ui/config";
import { positionStickerClass } from "@/components/ui/position-badge";
import { buildQuiltRows, pickPlace, type QuiltRow } from "../state/board";
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
const gridColumns = (teamCount: number): { readonly gridTemplateColumns: string } => ({
  gridTemplateColumns: `44px repeat(${teamCount}, minmax(0, 1fr))`,
});

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

  return (
    <div data-testid="quilt-board" className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
      {/* THE MANAGER ROW (founder addition 1): every swimlane's manager as the column head.
          The phone's micro-quilt keeps the text initials instead — 12 columns at 390px leave
          ~22px per column, which cannot carry a readable face honestly (spec, mobile
          judgment). */}
      {microOnly ? (
        <div className={GRID} style={columns}>
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
        <ManagerRow draftOrder={view.draftOrder} teams={teams} myTeamId={myTeamId} onClockTeamId={view.onClockTeamId} columns={columns} />
      )}

      {/* NEEDS lens: what every team still needs, as position dots — an added row, recolored
          facts, and the rounds grid stays beneath untouched (the lens law). */}
      {needs !== null ? (
        <div className={GRID} style={columns} data-testid="quilt-needs-row">
          <div className={`self-center text-right ${MICRO_LABEL} text-text-faint`}>needs</div>
          {view.draftOrder.map((teamId) => (
            <div key={teamId} className="flex min-h-8 items-center justify-center gap-1 rounded-sm bg-surface-inset">
              {(needs.get(teamId) ?? []).map((position, index) => (
                <span key={`${position}-${index}`} title={`needs ${position}`} className={`h-2 w-2 rounded-full ${positionStickerClass(position)}`}>
                  <span className="sr-only">needs {position}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {rows.map((row) => (
        <QuiltRowView
          key={row.round}
          row={row}
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
  readonly columns: { readonly gridTemplateColumns: string };
}

function QuiltRowView({ row, view, playersById, myTeamId, lens, byeWeeks, boardRanks, clockLabel, onPeek, peekedPlayerId, columns }: QuiltRowViewProps) {
  const teamCount = view.draftOrder.length;
  const isMicro = row.kind === "micro";
  const label = (
    <div className={`flex items-center justify-center font-display text-xs font-bold ${row.kind === "full" ? "text-text-primary" : "text-text-faint"}`}>
      R{row.round}
    </div>
  );

  if (isMicro) {
    return (
      // Micro rows share a sliver of the slack too, capped low — the compacted past keeps its
      // shape while the stage never ends in a dead band under R15.
      <div className={`${GRID} min-h-0 max-h-7 grow basis-4`} style={columns} data-testid={`quilt-round-${row.round}`} data-round-kind="micro">
        {label}
        {row.cells.map((cell) => {
          const player = cell.pick === null ? null : (playersById.get(cell.pick.playerId) ?? null);
          if (cell.pick === null || player === null) {
            // My own far-future cell keeps its amber promise even at micro height.
            const mine = cell.yourPickLabel !== null;
            return <div key={cell.teamId} aria-hidden="true" className={`h-3.5 rounded-xs ${mine ? "border border-dashed border-accent bg-surface-raised" : "bg-surface-inset"} ${cell.onClock ? "outline-2 outline-live" : ""}`} />;
          }
          const mine = cell.teamId === myTeamId;
          return (
            <button
              key={cell.teamId}
              type="button"
              aria-label={`${player.name}, pick ${pickPlace(cell.pick, teamCount)}`}
              aria-pressed={peekedPlayerId === player.id}
              onClick={() => onPeek(player.id)}
              className={`h-3.5 rounded-xs focus-visible:outline-2 focus-visible:outline-accent ${positionStickerClass(player.position)} ${mine ? "outline-1 outline-accent" : ""} ${peekedPlayerId === player.id ? "ring-2 ring-accent" : ""}`}
            />
          );
        })}
      </div>
    );
  }

  return (
    // The present deserves the space: the active round grows hardest, the track round takes a
    // smaller share, and the micro rows above stay compact — 15 rounds, zero scroll, no dead
    // stage under the last one.
    <div
      className={`${GRID} ${row.kind === "full" ? "min-h-0 max-h-24 grow-[3] basis-0" : "min-h-0 max-h-20 grow-[2] basis-0"}`}
      style={columns}
      data-testid={`quilt-round-${row.round}`}
      data-round-kind={row.kind}
    >
      {label}
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
        />
      ))}
    </div>
  );
}
