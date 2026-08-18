"use client";

import { useEffect, useState } from "react";
import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { teamsById, teamName, playerName } from "../lib/lookups";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import type { LandedPick } from "../hooks/use-draft-room";

export interface PickCelebrationProps {
  readonly lastPick: LandedPick | null;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly teams: readonly TeamCard[];
}

/**
 * The moment a pick lands. Keyed on `pickNumber`, so the same pick never re-animates and no
 * clock is consulted. Reduced motion is a real branch — the panel still appears, it just
 * carries no animation class, because losing the information would be worse than the motion.
 */
export function PickCelebration({ lastPick, playersById, teams }: PickCelebrationProps) {
  const reduced = usePrefersReducedMotion();
  const [visible, setVisible] = useState(false);
  const pickNumber = lastPick?.pick.pickNumber ?? null;

  useEffect(() => {
    if (pickNumber === null) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), DRAFT_ROOM_CONFIG.celebrationMs);
    return () => clearTimeout(timer);
  }, [pickNumber]);

  if (lastPick === null || !visible) return null;

  const { pick, isMine } = lastPick;
  const teamsMap = teamsById(teams);
  const playerDisplayName = playerName(playersById, pick.playerId);
  const teamDisplayName = teamName(teamsMap, pick.teamId);
  const motion = reduced ? "" : isMine ? "animate-pick-mine" : "animate-pick-landed";

  return (
    <div
      role="status"
      data-testid="pick-celebration"
      data-own={isMine ? "true" : "false"}
      data-pick-number={pickNumber}
      key={pickNumber}
      className={`rounded-lg border p-3 text-center ${isMine ? "border-accent bg-accent/10" : "border-border bg-surface-elevated"} ${motion}`}
    >
      <p className="text-lg font-semibold text-text-primary">
        {isMine ? `You drafted ${playerDisplayName}!` : `${teamDisplayName} drafted ${playerDisplayName}.`}
      </p>
      {pick.price === null ? null : <p className="text-sm text-text-muted">Won for ${pick.price}.</p>}
    </div>
  );
}
