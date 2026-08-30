import type { Player } from "@/domain/player";
import { TOKENS } from "@/design/tokens";
import { Avatar, type AvatarSize } from "./avatar";

/**
 * How large the face reads. Four steps because four surfaces need it and no more: `sm` is a
 * dense list row (the draft room's pool, sixty of them in a 320px rail — the size this component
 * shipped at when it lived in that room), `md` is a card or a roster slot, `lg` is a heading a
 * player shares with other content, and `xl` is a player's OWN screen, where the face is the
 * subject rather than a marker. The tile is always a few pixels larger than the `Avatar` inside
 * it, which is what makes the club colour read as a FRAME rather than as a ground the headshot
 * has to survive.
 */
export type PlayerFaceSize = "sm" | "md" | "lg" | "xl";

export interface PlayerFaceProps {
  readonly player: Player;
  /** @default "md" */
  readonly size?: PlayerFaceSize;
}

/**
 * The tile size and the `Avatar` step that sits on it, paired. Written as one map rather than two
 * because the pairing is the design: the gap between them IS the visible colour, and picking the
 * two halves at a call site is how one surface ends up with a 2px frame and its neighbour with 6.
 * Tailwind sees every class literally, so this can never be built from a template.
 */
const SIZE: Readonly<Record<PlayerFaceSize, { readonly tile: string; readonly avatar: AvatarSize }>> = {
  sm: { tile: "size-8", avatar: "sm" },
  md: { tile: "size-11", avatar: "md" },
  lg: { tile: "size-14", avatar: "lg" },
  // The frame widens with the tile rather than staying 8px: at 112px a hairline of colour reads
  // as a rendering artefact, and the whole point of the step is that the club is the ground the
  // player stands on.
  xl: { tile: "size-28", avatar: "xl" },
};

/**
 * A player's face on his club's own colour — law 3, *"a player is an object: face, team colour,
 * position, number"*, and the one primitive that owns the first two of those four.
 *
 * WHERE THE FOURTH ONE IS. The domain `Player` (`src/domain/player.ts`) carries id, name,
 * position, `nflTeam`, `headshotUrl` and `adp` — there is no jersey number anywhere in the feed
 * we map (`src/stats/tank01/map.ts`), so this component renders three of law 3's four attributes
 * and no more. Inventing a number would be the exact honesty failure the spec forbids ("no
 * invented data"), and a placeholder number is worse than an absent one because a manager reads it
 * as a fact. When the feed carries jersey numbers the field lands on `Player` first and this
 * component gains it second; the gap is stated here so the next person does not read the omission
 * as an oversight.
 *
 * THE COLOUR IS A TILE AND NOTHING ELSE, which is rule 1's team-identity amendment applied
 * exactly as narrowly as it is written (`docs/design-system.md`, "The fun-pass amendments"):
 * *"A team's own colour, behind a player's face only. Never on a surface, never behind text."*
 * So it never becomes the row's background, it never sits under the player's name, and it is
 * `aria-hidden` because it carries no fact a screen reader needs — the team code is already stated
 * in text beside it, which is also the second channel that keeps this from being colour-only
 * information. No contrast threshold applies and none is claimed, for that same reason.
 *
 * The `Avatar` sits ON the tile at its own size rather than being tinted by it: an ESPN headshot
 * is a cutout on a light background, and tinting behind it would look like a printing error on
 * half the league.
 *
 * A team we have no colour for (a free agent, a code the feed changed its mind about) renders the
 * bare face with no tile at all. Degrading to nothing rather than to a grey rectangle pretending
 * to be somebody's colours is the same posture every other "we do not know" branch takes, and
 * `TOKENS.team`'s own docblock commits to it from the palette's side.
 *
 * PROMOTED FROM `src/draft-room/components/player-face.tsx` (Gameday, v4): a player object is now
 * every surface's vocabulary rather than the draft room's, so the component lives with the other
 * primitives and the room imports it like everyone else.
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
      // A CIRCLE, not a square (founder, 2026-08-30: "maybe it's the squares behind the
      // players?" — the hard-cornered tile read as a chip, not a person). The club colour is
      // now a RING around the circular face, the construction every incumbent's avatar uses;
      // the colour's meaning and its aria-hidden posture are unchanged.
      className={`flex shrink-0 items-center justify-center rounded-full ${step.tile}`}
      style={{ backgroundColor: color }}
    >
      <Avatar name={player.name} avatar={player.headshotUrl} size={step.avatar} />
    </span>
  );
}
