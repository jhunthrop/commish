"use client";

import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import { Celebration } from "@/components/ui";
import { useTransientVisibility } from "@/design/use-transient-visibility";
import { teamsById, teamName, playerName } from "../lib/lookups";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import type { LandedPick } from "../hooks/use-draft-room";

export interface PickCelebrationProps {
  readonly lastPick: LandedPick | null;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly teams: readonly TeamCard[];
}

/**
 * The moment a pick lands. Keyed on `pickNumber`, so a redelivered pick never re-animates and
 * no clock is consulted. The panel itself is the shared `Celebration` — the league's
 * matchup-win moment is the same component with different words.
 */
export function PickCelebration({ lastPick, playersById, teams }: PickCelebrationProps) {
  const pickNumber = lastPick?.pick.pickNumber ?? null;
  const visible = useTransientVisibility(pickNumber, DRAFT_ROOM_CONFIG.celebrationMs);
  if (lastPick === null || !visible) return null;

  const { pick, isMine } = lastPick;
  const player = playerName(playersById, pick.playerId);
  const team = teamName(teamsById(teams), pick.teamId);

  return (
    // Keyed on the pick number so a NEW pick landing mid-celebration remounts the panel and
    // replays the entrance animation — same-key rerenders keep the node (no replay).
    <Celebration
      key={pickNumber}
      testId="pick-celebration"
      emphasis={isMine ? "self" : "peer"}
      title={isMine ? `You drafted ${player}!` : `${team} drafted ${player}.`}
      detail={pick.price === null ? undefined : `Won for $${pick.price}.`}
    />
  );
}
