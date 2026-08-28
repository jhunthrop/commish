import type { Player } from "@/domain/player";
import { Avatar } from "@/components/ui";
import { TOKENS } from "@/design/tokens";

export interface PlayerFaceProps {
  readonly player: Player;
}

/**
 * A player's face on his club's own colour — rule 1's team-identity amendment, applied exactly
 * as narrowly as it is written (`docs/design-system.md`, "The fun-pass amendments"): *"A team's
 * own colour, behind a player's face only. Never on a surface, never behind text."*
 *
 * So the colour is a tile the size of the face and nothing else. It never becomes the row's
 * background, it never sits under the player's name, and it is `aria-hidden` because it carries
 * no fact a screen reader needs — the team code is already stated in text two lines below, which
 * is also the second channel that keeps this from being colour-only information.
 *
 * The `Avatar` sits ON the tile at its own size, so the colour reads as a frame rather than as a
 * ground the headshot has to survive: an ESPN headshot is a cutout on a light background, and
 * tinting behind it would look like a printing error on half the league. No contrast threshold
 * applies and none is claimed, for the same reason the tile is decorative.
 *
 * A team we have no colour for (a free agent, a code the feed changed its mind about) renders
 * the bare face. Degrading to nothing rather than to a grey rectangle pretending to be somebody's
 * colours is the same posture every other "we do not know" branch in this room takes.
 */
export function PlayerFace({ player }: PlayerFaceProps) {
  const color = TOKENS.team[player.nflTeam.toUpperCase()];
  if (color === undefined) return <Avatar name={player.name} avatar={player.headshotUrl} size="sm" />;
  return (
    <span
      aria-hidden="true"
      data-testid="player-face-team"
      data-team={player.nflTeam}
      className="flex size-8 shrink-0 items-center justify-center rounded-sm"
      style={{ backgroundColor: color }}
    >
      <Avatar name={player.name} avatar={player.headshotUrl} size="sm" />
    </span>
  );
}
