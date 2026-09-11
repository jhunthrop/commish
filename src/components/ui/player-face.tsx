import type { Player } from "@/domain/player";
import { TOKENS } from "@/design/tokens";
import { Avatar, type AvatarSize } from "./avatar";

/**
 * How large the face reads. `sm` (32) is a dense research row (the pool, a game log), `md` (36)
 * is THE row (Sideline's 48px row carries a 36px face), `lg` (56) is a card's subject (the
 * advisor's recommendation, a landing frame), and `xl` (132) is a player's OWN screen. The ring
 * is 2px at every step: the club's colour is a ring around the circle, never a plate behind it.
 */
export type PlayerFaceSize = "xs" | "sm" | "md" | "lg" | "xl";

export interface PlayerFaceProps {
  readonly player: Player;
  /** @default "md" */
  readonly size?: PlayerFaceSize;
}

/**
 * The ring's box and the `Avatar` step inside it, paired: the difference is exactly 4px, which is
 * the 2px club ring on each side. Written as one map so a call site can never pick a 6px ring.
 * Tailwind reads every class literally, so this is never built from a template.
 */
const SIZE: Readonly<Record<PlayerFaceSize, { readonly ring: string; readonly avatar: AvatarSize }>> = {
  /** 28: a sheet row at 44px, seven columns wide, where the name needs the width (P1). */
  xs: { ring: "size-7", avatar: "xs" },
  sm: { ring: "size-8", avatar: "sm" },
  md: { ring: "size-9", avatar: "md" },
  lg: { ring: "size-14", avatar: "xl" },
  xl: { ring: "size-33", avatar: "2xl" },
};

/**
 * A player's face in a circle with a 2px ring in his club's colour (Sideline: "headshots in
 * circles with a 2px club-colour ring", and the refusal list's "no team colour behind text").
 *
 * The colour is a ring and nothing else. It never becomes the row's background, it never sits
 * under the name, and it is `aria-hidden` because it carries no fact a screen reader needs: the
 * team code is stated in text beside it, which is also the second channel that keeps this from
 * being colour-only information. It reaches the DOM as an inline style because the palette is
 * keyed by a team code that arrives at runtime (`TOKENS.team`'s own docblock).
 *
 * A team we have no colour for (a free agent, a code the feed changed its mind about) renders
 * the bare face with no ring: degrading to nothing rather than to a grey ring pretending to be
 * somebody's colours. The domain `Player` carries no jersey number, so none is drawn.
 */
export function PlayerFace({ player, size = "md" }: PlayerFaceProps) {
  const color = TOKENS.team[player.nflTeam.toUpperCase()];
  const step = SIZE[size];
  if (color === undefined) return <Avatar name={player.name} avatar={player.headshotUrl} size={step.avatar} />;
  return (
    <span
      aria-hidden="true"
      data-testid="player-face-team"
      data-team={player.nflTeam}
      className={`flex shrink-0 items-center justify-center rounded-full ${step.ring}`}
      style={{ backgroundColor: color }}
    >
      <Avatar name={player.name} avatar={player.headshotUrl} size={step.avatar} />
    </span>
  );
}
