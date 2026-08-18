"use client";

import type { TeamCard } from "@/domain/league";
import type { Player } from "@/domain/player";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { positionStickerClass } from "@/components/ui";
import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { rosterSpots } from "../state/format";
import { teamName, teamsById } from "../lib/lookups";

export type DraftBoardVariant = "room" | "tv";

export interface DraftBoardProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string | null;
  /** The pick that just landed. Its sticker slaps onto the board; everything else is static. */
  readonly landedPickNumber?: number | null;
  /** `tv` is the same board at party scale: bigger stickers, bigger lettering. */
  readonly variant?: DraftBoardVariant;
}

interface BoardCell {
  readonly teamId: string;
  readonly pick: CompletedPick | null;
  readonly onClock: boolean;
  readonly future: boolean;
}

interface BoardRow {
  readonly round: number;
  /**
   * Which way the picks in this round actually ran, read off the picks themselves — never
   * re-derived from a serpentine rule, which belongs to the engine. Null until the round has
   * two picks to compare (and always, for an auction, where a "round" is not an order).
   */
  readonly direction: "forward" | "reverse" | null;
  readonly cells: readonly BoardCell[];
}

/**
 * Sticker lettering, at two sizes. The board auto-fits its columns to whatever width the stage
 * gives it, so the type grows with them — comfortable above `xl`, compact below. A breakpoint
 * rather than a container query on purpose: the stage IS the viewport minus one fixed-width
 * rail, so viewport width and column width move together, and a breakpoint is the mechanism
 * the rest of this codebase (and its happy-dom tests) already reasons about.
 */
const CELL_TEXT: Readonly<Record<DraftBoardVariant, string>> = {
  room: "text-sm xl:text-md",
  tv: "text-display-md",
};

/**
 * The sticker minimum: the narrowest a column may get before the board stops shrinking and
 * starts scrolling sideways inside its own container. Above it, `w-full` on an auto-layout
 * table spreads the surplus evenly across the columns — which is what "maximize the width"
 * actually means for a board whose column count is the league's, not ours.
 */
const CELL_MIN_WIDTH: Readonly<Record<DraftBoardVariant, string>> = {
  room: "min-w-32 xl:min-w-40",
  tv: "min-w-48",
};

/** The column order: the draft order once it exists, the league's teams before it does. */
function columnIdsOf(view: DraftStateView, teams: readonly TeamCard[]): readonly string[] {
  return view.draftOrder.length > 0 ? view.draftOrder : teams.map((team) => team.id);
}

function pickKey(teamId: string, round: number): string {
  return `${teamId}:${round}`;
}

/**
 * The round each team is about to fill: how many picks they already own, plus one. Derived
 * from the board itself rather than from the pick number, so no turn-order rule is restated
 * here — a team's next row is simply the first empty one.
 */
function nextRoundByTeam(view: DraftStateView): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const pick of view.picks) counts.set(pick.teamId, (counts.get(pick.teamId) ?? 0) + 1);
  return new Map([...counts].map(([teamId, count]) => [teamId, count + 1]));
}

function directionOf(picks: readonly CompletedPick[], columnIds: readonly string[]): "forward" | "reverse" | null {
  if (picks.length < 2) return null;
  const first = picks.reduce((min, pick) => (pick.pickNumber < min.pickNumber ? pick : min));
  const last = picks.reduce((max, pick) => (pick.pickNumber > max.pickNumber ? pick : max));
  return columnIds.indexOf(first.teamId) < columnIds.indexOf(last.teamId) ? "forward" : "reverse";
}

function buildRows(view: DraftStateView, columnIds: readonly string[]): readonly BoardRow[] {
  // The last round with any action; empties beyond the next round fade to quiet the wall.

  const byCell = new Map(view.picks.map((pick) => [pickKey(pick.teamId, pick.round), pick]));
  const byRound = new Map<number, CompletedPick[]>();
  for (const pick of view.picks) byRound.set(pick.round, [...(byRound.get(pick.round) ?? []), pick]);

  const nextRound = nextRoundByTeam(view);
  const onClockTeamId = view.phase === "in_progress" ? view.onClockTeamId : null;
  const isSnake = view.format === "snake";
  const activeRound = Math.max(1, ...view.picks.map((pick) => pick.round), ...(onClockTeamId ? [nextRound.get(onClockTeamId) ?? 1] : []));

  return Array.from({ length: rosterSpots(view.slotConfig) }, (_, index): BoardRow => {
    const round = index + 1;
    return {
      round,
      direction: isSnake ? directionOf(byRound.get(round) ?? [], columnIds) : null,
      cells: columnIds.map((teamId): BoardCell => ({
        teamId,
        pick: byCell.get(pickKey(teamId, round)) ?? null,
        onClock: teamId === onClockTeamId && (nextRound.get(teamId) ?? 1) === round,
        future: round > activeRound + 1,
      })),
    };
  });
}

function StickerCell({
  cell,
  playersById,
  variant,
  slap,
  spotlight,
}: {
  readonly cell: BoardCell;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly variant: DraftBoardVariant;
  readonly slap: boolean;
  readonly spotlight: boolean;
}) {
  if (cell.pick !== null) {
    const player = playersById.get(cell.pick.playerId) ?? null;
    const fill = player === null ? "border border-border bg-surface-elevated text-text-primary" : positionStickerClass(player.position);
    return (
      <div className={`flex h-full flex-col justify-center gap-1 rounded-sm px-2 py-2 shadow-sticker ${fill} ${slap ? "animate-sticker-slap" : ""}`}>
        <span className={`truncate font-display font-semibold leading-display ${CELL_TEXT[variant]}`}>
          {player?.name ?? cell.pick.playerId}
        </span>
        <span className="truncate text-xs font-medium">
          {player?.position ?? cell.pick.slot} · {player?.nflTeam ?? cell.pick.slot}
          {cell.pick.price === null ? "" : ` · $${cell.pick.price}`}
        </span>
      </div>
    );
  }

  if (cell.onClock) {
    return (
      <div data-onclock-cell="true" className="relative flex h-full items-center justify-center rounded-sm border border-dashed border-border px-2 py-2">
        <span aria-hidden="true" className={`pointer-events-none absolute inset-0 rounded-sm ring-2 ring-accent ${spotlight ? "animate-spotlight" : ""}`} />
        <span className="font-display text-xs font-semibold uppercase tracking-wide text-accent">On the clock</span>
      </div>
    );
  }

  return <div aria-hidden="true" className={`h-full min-h-12 rounded-sm border border-dashed ${cell.future ? "border-border/35" : "border-border"}`} />;
}

/**
 * The draft board: teams across, rounds down, one colored sticker per pick. The hero of the
 * room — everything else on the page is support.
 *
 * Every value here comes off `view.picks` / `view.slotConfig` / `view.draftOrder` and the two
 * lookup maps. No rule is computed: the round a team is about to fill is "their first empty
 * row", and a round's serpentine direction is read off the pick numbers already in it rather
 * than from the alternation rule that produced them (which is the engine's, and stays there).
 */
export function DraftBoard({ view, teams, playersById, myTeamId, landedPickNumber = null, variant = "room" }: DraftBoardProps) {
  const reduced = usePrefersReducedMotion();
  const byId = teamsById(teams);
  const columnIds = columnIdsOf(view, teams);
  const rows = buildRows(view, columnIds);
  const slapPickNumber = reduced ? null : landedPickNumber;

  const gridRef = useRef<HTMLDivElement | null>(null);
  const onClockKey = view.phase === "in_progress" ? `${view.onClockTeamId ?? ""}:${view.pickNumber}` : "";
  useEffect(() => {
    // The current pick is the most important cell in the product: keep it in view. happy-dom
    // implements scrollIntoView as a no-op, so tests exercise presence, not scrolling.
    const cell = gridRef.current?.querySelector('[data-onclock-cell="true"]');
    cell?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [onClockKey]);

  const cellFor = (cell: BoardCell) => (
    <StickerCell
      cell={cell}
      playersById={playersById}
      variant={variant}
      slap={cell.pick !== null && cell.pick.pickNumber === slapPickNumber}
      spotlight={!reduced}
    />
  );

  // Rounds worth showing on a phone: the ones that have happened, plus the one in progress,
  // newest first. A board of empty rounds is a scroll, not information.
  const listRows = [...rows]
    .reverse()
    .filter((row) => row.cells.some((cell) => cell.pick !== null || cell.onClock));

  return (
    <section aria-label="Draft board" className="flex h-full min-h-0 flex-col gap-3">
      {/* Wide: the board itself, scrolling inside its own container so the page never does. */}
      <div ref={gridRef} data-testid="draft-board-grid" className="hidden min-h-0 w-full flex-1 overflow-auto sm:block">
        <table className="w-full border-separate border-spacing-1 text-left">
          <caption className="sr-only">The draft board: one row per round, one column per team.</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-surface px-2 py-1 font-display text-xs font-semibold uppercase tracking-wide text-text-muted">
                Rd
              </th>
              {columnIds.map((teamId) => (
                <th
                  key={teamId}
                  scope="col"
                  className={
                    `${CELL_MIN_WIDTH[variant]} truncate rounded-sm px-2 py-1 font-display font-semibold leading-display ` +
                    (teamId === myTeamId ? "ring-2 ring-accent text-accent" : "text-text-primary")
                  }
                >
                  {teamName(byId, teamId)}
                  {teamId === myTeamId ? <span className="ml-2 font-display text-xs uppercase tracking-wide text-accent">You</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.round}>
                <th scope="row" className="sticky left-0 z-10 bg-surface px-2 py-1 align-middle font-display font-semibold text-text-muted">
                  <span className="flex items-center gap-1">
                    {row.round}
                    {row.direction === null ? null : (
                      <span aria-hidden="true" className="text-text-muted">
                        {row.direction === "forward" ? "→" : "←"}
                      </span>
                    )}
                  </span>
                  {row.direction === null ? null : (
                    <span className="sr-only">{row.direction === "forward" ? ", picked left to right" : ", picked right to left"}</span>
                  )}
                </th>
                {row.cells.map((cell) => (
                  <td key={cell.teamId} className="align-top">
                    {cellFor(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Narrow: the same board as a round-by-round list, newest round first. */}
      <ol data-testid="draft-board-list" className="flex flex-col gap-4 sm:hidden">
        {listRows.map((row) => (
          <li key={row.round} className="flex flex-col gap-2">
            {/* `h2`, not `h3`: the rail's league name is the page's only `h1`, and a jump to
                `h3` is a real heading-order violation (axe catches it). */}
            <h2 className="font-display text-display-sm font-semibold leading-display text-text-primary">Round {row.round}</h2>
            <ul className="flex flex-col gap-2">
              {row.cells
                .filter((cell) => cell.pick !== null || cell.onClock)
                .map((cell) => (
                  <li key={cell.teamId} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate font-display font-semibold text-text-muted">{teamName(byId, cell.teamId)}</span>
                    <span className="grow">{cellFor(cell)}</span>
                  </li>
                ))}
            </ul>
          </li>
        ))}
        {listRows.length === 0 ? (
          <li className="rounded-sm border border-dashed border-border p-4 text-sm text-text-muted">
            The board fills in as picks land. Nothing has been drafted yet.
          </li>
        ) : null}
      </ol>
    </section>
  );
}
