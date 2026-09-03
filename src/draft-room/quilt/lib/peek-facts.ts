import type { Player } from "@/domain/player";
import type { BoardReason } from "@/projections/preseason/board";
import type { CheatSheet } from "../state/sheet";
import type { PeekFacts } from "../components/peek-sheet";

export interface PeekSources {
  readonly playersById: ReadonlyMap<string, Player>;
  readonly boardRanks: ReadonlyMap<string, number>;
  readonly sheetRanks: ReadonlyMap<string, number>;
  readonly sheet: CheatSheet;
  readonly byeWeeks: ReadonlyMap<string, number>;
  readonly reasons: ReadonlyMap<string, readonly BoardReason[]>;
  readonly available: ReadonlySet<string>;
  readonly queuedPlayerIds: ReadonlySet<string>;
}

/** Assemble the peek's facts from the room's own stores — one builder shared by the desktop
 *  peek and the mobile full card, so the two can never show different truths. */
export function peekFactsFor(playerId: string, sources: PeekSources): PeekFacts | null {
  const player = sources.playersById.get(playerId);
  if (player === undefined) return null;
  return {
    player,
    boardRank: sources.boardRanks.get(playerId) ?? null,
    sheetRank: sources.sheetRanks.get(playerId) ?? null,
    byeWeek: sources.byeWeeks.get(player.nflTeam) ?? null,
    reasons: sources.reasons.get(playerId) ?? [],
    note: sources.sheet.notes[playerId] ?? null,
    drafted: !sources.available.has(playerId),
    queued: sources.queuedPlayerIds.has(playerId),
  };
}
