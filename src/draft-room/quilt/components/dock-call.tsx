"use client";

import { memo, useMemo } from "react";
import { mustPickLine } from "@research/domain/must-pick";
import type { Player } from "@research/domain/player";
import { positionLabel } from "@research/domain/position-words";
import type { RosterSlotType } from "@research/domain/roster";
import { restrictedPositions } from "@research/domain/roster-eligibility";
import type { DraftStateView } from "@/draft-engine";
import type { AdvisorView } from "@/draft-service/assistant/view";
import { BigNumber, Button, PlayerFace, PositionBadge } from "@/components/ui";
import { pickLabel } from "@/domain/pick-label";
import { sharePercent, stillThereAt } from "../../advisor/format";
import { rosterFillRows } from "../../state/roster-fill";
import type { RoomActs } from "./room-acts";

export interface DockCallProps extends Pick<RoomActs, "canDraft" | "submitting" | "queuedPlayerIds" | "onDraft" | "onQueueToggle"> {
  readonly view: DraftStateView;
  readonly myTeamId: string | null;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly advisor: AdvisorView | null;
  /** True while a fresh answer is on its way: the figure dims and the block says "updating". */
  readonly recomputing: boolean;
  /** The caller's queue, best first. */
  readonly queue: readonly string[];
  readonly byeWeeks: ReadonlyMap<string, number>;
  /** "3.07": your next pick after this one, the odds' basis. */
  readonly nextPickLabel: string | null;
  /** The room's one available set, built once by the room. */
  readonly available: ReadonlySet<string>;
  /** Phone: the why hides so the fixed block stays short. */
  readonly compact?: boolean;
}

/** Who the verb drafts, and where the name came from, said plainly beside it. */
export interface CallModel {
  readonly player: Player;
  readonly source: string;
  readonly why: string | null;
  readonly fills: RosterSlotType | null;
  readonly survived: number | null;
  readonly runs: number | null;
}

/**
 * Our call, or the honest fallback (ruling 3): the advisor's pick when it has one for the pick
 * the advice decides (`AdvisorView.pickNumber`, yours, never the room's on-clock pick); failing
 * that the top of your queue; failing that the best player left on our board. The source is
 * printed beside the name, so a queue pick is never dressed as our call.
 *
 * THE FALLBACK ONLY EVER NAMES A MAN THE ROSTER CAN TAKE (the 2026-09-12 round, founder report
 * 3): with the bench full, only the positions of the open starting slots qualify
 * (`restrictedPositions`, the same rule the engine refuses by), and the line under the name is
 * the league's own sentence about what the roster still owes.
 */
export function callFor(view: DraftStateView, myTeamId: string, advisor: AdvisorView | null, queue: readonly string[], available: ReadonlySet<string>, playersById: ReadonlyMap<string, Player>, teamCount: number): CallModel | null {
  const pick = advisor?.pick ?? null;
  const runs = advisor === null || advisor.odds === null || advisor.odds.runs === 0 ? null : advisor.odds.runs;
  if (pick !== null && advisor !== null) {
    const player = playersById.get(pick.playerId);
    if (player !== undefined && available.has(player.id)) {
      const survived = pick.makeItBack === null ? null : Math.round(pick.makeItBack.survival * pick.makeItBack.runs);
      return { player, source: `our call for ${pickLabel(advisor.pickNumber, teamCount)}`, why: pick.why, fills: pick.fillsSlot, survived, runs: pick.makeItBack?.runs ?? null };
    }
  }
  const owed = restrictedPositions(view.slotConfig, view.rosters[myTeamId] ?? []);
  const fits = (playerId: string): boolean => {
    if (!available.has(playerId)) return false;
    const position = playersById.get(playerId)?.position;
    return position !== undefined && (owed === null || owed.includes(position));
  };
  const queued = queue.find(fits);
  const fallbackId = queued ?? view.availablePlayerIds.find(fits) ?? null;
  if (fallbackId === null) return null;
  const player = playersById.get(fallbackId);
  if (player === undefined) return null;
  const survived = runs === null ? null : (advisor?.odds?.survived[player.id] ?? null);
  const why = owed === null || owed.length === 0 ? null : mustPickLine(owed);
  return { player, source: queued !== undefined ? "top of your queue" : "best left on our board", why, fills: null, survived: runs === null ? null : survived, runs };
}

/** "QB 0/1 · RB 1/2 · FLEX 0/1": every starting spot's fill, from the engine's own roster. */
function fillChips(view: DraftStateView, myTeamId: string | null): readonly { readonly slot: RosterSlotType; readonly filled: number; readonly total: number }[] {
  if (myTeamId === null) return [];
  const rows = rosterFillRows(view.slotConfig, view.rosters[myTeamId] ?? []);
  const bySlot = new Map<RosterSlotType, { filled: number; total: number }>();
  for (const row of rows) {
    if (row.slot === "BENCH") continue;
    const held = bySlot.get(row.slot) ?? { filled: 0, total: 0 };
    bySlot.set(row.slot, { filled: held.filled + (row.playerId === null ? 0 : 1), total: held.total + 1 });
  }
  return [...bySlot].map(([slot, counts]) => ({ slot, ...counts }));
}

/** A slot's printed name: the position's own badge word where the slot is a position's. */
const SLOT_WORD: Partial<Record<RosterSlotType, string>> = { DEF: positionLabel("DEF") };

/**
 * OUR CALL BESIDE THE VERB (founder ruling 3, 2026-09-10): the advice sits with the action
 * whatever the stream's width. His face on the club ring, his name largest, the position, the
 * club, the slot he fills and where the name came from, the why in two lines, and the one big
 * number with its basis (how many of the runs still have him at your next pick). On your clock
 * the room's ONE solid pill drafts him; off it the block carries a quiet Queue and no verb at
 * all (P3: never a verb for a decision you cannot make yet). While a fresh answer is on its way
 * the block says "updating" and the figure dims, so a number from the pick before never passes
 * as current. The fill line under it is your starting roster, spot by spot.
 */
export const DockCall = memo(function DockCall({ view, myTeamId, playersById, advisor, recomputing, queue, byeWeeks, nextPickLabel, available, compact = false, canDraft, submitting, queuedPlayerIds, onDraft, onQueueToggle }: DockCallProps) {
  const teamCount = view.draftOrder.length;
  const call = useMemo(() => (myTeamId === null || teamCount === 0 ? null : callFor(view, myTeamId, advisor, queue, available, playersById, teamCount)), [view, advisor, queue, available, playersById, myTeamId, teamCount]);
  const fills = useMemo(() => fillChips(view, myTeamId), [view, myTeamId]);

  if (myTeamId === null) {
    return (
      <div data-testid="dock-call" data-empty="true" className="flex h-full items-center px-4 text-sm text-text-faint">
        You have no seat in this draft, so nothing here is yours to pick.
      </div>
    );
  }
  if (call === null) {
    return (
      <div data-testid="dock-call" data-empty="true" className="flex h-full items-center px-4 text-sm text-text-faint">
        {recomputing ? "Reading the board." : "Nobody left to call."}
      </div>
    );
  }

  const { player } = call;
  const bye = byeWeeks.get(player.nflTeam);
  const queued = queuedPlayerIds.has(player.id);
  return (
    <div data-testid="dock-call" data-on-clock={canDraft ? "true" : "false"} className="grid h-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <PlayerFace player={player} size={compact ? "md" : "lg"} />
        <div className="min-w-0">
          <p data-testid="dock-call-name" className="truncate font-display text-lg font-extrabold leading-tight text-text-primary">
            {player.name}
          </p>
          <p className="flex items-center gap-x-1.5 text-xs text-text-muted">
            <PositionBadge position={player.position} size="sm" />
            <span className="truncate">
              {player.nflTeam}
              {compact || bye === undefined ? "" : ` · bye ${bye}`}
              {compact || call.fills === null ? "" : ` · fills your ${SLOT_WORD[call.fills] ?? call.fills}`}
              {` · ${call.source}`}
            </span>
          </p>
          {compact || call.why === null ? null : (
            <p data-testid="dock-call-why" className="mt-1 line-clamp-2 text-sm leading-snug text-text-primary">
              {call.why}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end">
        <BigNumber size={compact ? "sm" : "md"} value={sharePercent(call.survived, call.runs)} basis={call.runs === null ? "no runs yet" : stillThereAt(nextPickLabel)} className={recomputing ? "opacity-60" : ""} />
        {/* Always in the flow under the figure, silent when idle: a word appearing must never
            shift the block, and here it takes no width from the name line. */}
        <span data-testid="advisor-recomputing" data-active={recomputing ? "true" : "false"} aria-hidden={!recomputing} className={`text-xs text-text-faint ${recomputing ? "" : "invisible"}`}>
          updating
        </span>
      </div>
      <div className="col-span-2 flex flex-col gap-1.5">
        {canDraft ? (
          <Button data-testid="dock-verb" variant="verb" size="lg" className="w-full" disabled={submitting} onClick={() => onDraft(player.id)}>
            Draft {player.name}
          </Button>
        ) : (
          <div className="flex items-center gap-3">
            <Button data-testid="dock-queue-verb" variant="secondary" size="md" disabled={submitting} aria-pressed={queued} onClick={() => onQueueToggle(player.id)}>
              {queued ? "Queued" : `Queue ${player.name}`}
            </Button>
            {advisor === null ? null : <span className="text-xs text-text-faint">{advisor.picksUntilYourTurn === 1 ? "your pick is next" : `your pick is in ${advisor.picksUntilYourTurn}`}</span>}
          </div>
        )}
        {fills.length === 0 ? null : (
          <p data-testid="dock-fills" className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-text-muted">
            {fills.map((fill) => (
              <span key={fill.slot} className="tabular-nums">
                {SLOT_WORD[fill.slot] ?? fill.slot} <span className={fill.filled < fill.total ? "font-semibold text-negative" : "font-semibold text-text-primary"}>{fill.filled}/{fill.total}</span>
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
});
