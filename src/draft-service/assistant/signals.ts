/**
 * THE RUN — spec 3.3's one signal read straight off the live pick log: a position took at least
 * `runThreshold` of the last `runWindow` picks. The tier the card's pick closes comes from
 * `recommendPick`'s own `tier_cliff` reason, and the seats ahead come from the room's runs
 * (`sim/room-odds.ts`), so this module carries nothing else.
 */
import type { Position } from "@/domain/player";
import type { DraftState } from "@/draft-engine";
import { ADVISOR_CONFIG } from "./config";

export interface PositionRun {
  readonly position: Position;
  readonly count: number;
  readonly window: number;
}

/** The run read over the room's own last `runWindow` picks. */
export function detectRun(state: DraftState): PositionRun | null {
  const { runWindow, runThreshold } = ADVISOR_CONFIG.signals;
  const positionOf = new Map(state.pool.map((entry) => [entry.playerId, entry.position] as const));
  const recent = [...state.picks].sort((a, b) => a.pickNumber - b.pickNumber).slice(-runWindow);
  if (recent.length < runThreshold) return null;
  const counts = new Map<Position, number>();
  for (const pick of recent) {
    const position = positionOf.get(pick.playerId);
    if (position !== undefined) counts.set(position, (counts.get(position) ?? 0) + 1);
  }
  const loudest = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (loudest === undefined || loudest[1] < runThreshold) return null;
  return { position: loudest[0], count: loudest[1], window: recent.length };
}
