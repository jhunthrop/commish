"use client";

import type { Player } from "@research/domain/player";
import type { TeamCard } from "@/domain/league";
import { Celebration } from "@/components/ui";
import { useTransientVisibility } from "@/design/use-transient-visibility";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import type { LandedPick } from "../hooks/use-draft-room";
import { pickFrame } from "./pick-landing";

export interface PickCelebrationProps {
  readonly lastPick: LandedPick | null;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly teams: readonly TeamCard[];
  /** P8: the frame says which league. The auction shell and the TV pass it when they hold it. */
  readonly leagueName?: string;
  readonly teamCount?: number;
}

/**
 * The moment a pick lands, shown for a beat (the auction shell and the TV board). Keyed on
 * `pickNumber`, so a redelivered pick never re-animates and no clock is consulted. The frame is
 * the shared `pickFrame`, so it says the same words as the snake room's stream landing.
 */
export function PickCelebration({ lastPick, playersById, teams, leagueName = "", teamCount = 0 }: PickCelebrationProps) {
  const pickNumber = lastPick?.pick.pickNumber ?? null;
  const visible = useTransientVisibility(pickNumber, DRAFT_ROOM_CONFIG.celebrationMs);
  if (lastPick === null || !visible) return null;
  const { pick, isMine } = lastPick;
  const frame = pickFrame({ pick, team: teams.find((team) => team.id === pick.teamId) ?? null, player: playersById.get(pick.playerId) ?? null, mine: isMine, leagueName, teamCount });
  // Keyed on the pick number so a NEW pick landing mid-celebration remounts the panel and
  // replays the entrance animation.
  return <Celebration key={pickNumber} testId="pick-celebration" {...frame} leagueName={leagueName === "" ? undefined : leagueName} />;
}
