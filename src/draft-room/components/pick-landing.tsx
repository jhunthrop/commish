"use client";

import type { Player } from "@research-ts/domain/player";
import type { TeamCard } from "@/domain/league";
import type { CompletedPick } from "@/draft-engine";
import { Celebration, type CelebrationProps } from "@/components/ui/celebration";
import { pickLabel } from "@/domain/pick-label";

export interface PickLandingProps {
  readonly pick: CompletedPick;
  readonly team: TeamCard | null;
  readonly player: Player | null;
  readonly mine: boolean;
  readonly leagueName: string;
  readonly teamCount: number;
}

const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

/**
 * The words and people of a pick's frame (P8): who, whom, the pick in the sport's grammar, the
 * manager's face, the league and the clock. Shared by the stream's landing and the auction
 * shell's transient celebration so the two frames never drift.
 */
export function pickFrame({ pick, team, player, mine, leagueName, teamCount }: PickLandingProps): Pick<CelebrationProps, "title" | "detail" | "emphasis" | "leagueName" | "people" | "date"> {
  const who = mine ? "You" : (team?.name ?? "A team");
  const name = player?.name ?? "a player";
  const detail = [teamCount > 0 ? `pick ${pickLabel(pick.pickNumber, teamCount)}` : null, player === null ? null : `${player.position} · ${player.nflTeam}`, pick.price === null ? null : `won for $${pick.price}`]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" · ");
  return {
    title: `${who} drafted ${name}.`,
    detail,
    emphasis: mine ? "self" : "peer",
    leagueName,
    people: team === null ? undefined : [{ name: team.ownerDisplayName, avatar: team.ownerAvatarUrl }],
    date: new Date(pick.timestamp).toLocaleTimeString(undefined, TIME_FORMAT),
  };
}

/**
 * THE PICK LANDING IN THE STREAM: the latest pick as the frame worth sending, persistent until
 * the next one lands. Your own pick slaps in at celebration scale; a peer's springs. Keyed on
 * the pick number so a redelivered pick never replays and a new one always does.
 */
export function PickLanding(props: PickLandingProps) {
  return <Celebration key={props.pick.pickNumber} testId="pick-celebration" {...pickFrame(props)} />;
}
