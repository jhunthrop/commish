import type { ReactNode } from "react";
import type { Player } from "@/domain/player";
import { PlayerFace } from "./player-face";
import { ROW_META_CLASS, ROW_NAME_CLASS, rowShellClass } from "./player-row";
import { Badge } from "./badge";

export interface TeamRowProps {
  /** The product's team code, "DET". */
  readonly code: string;
  /** "Detroit Lions". */
  readonly name: string;
  /** The facts after the name, mono: "DET · Bye 8". */
  readonly meta?: ReactNode;
  /** THE ONE NUMBER, at the row's right (P2), on the surfaces that have one for a club: a
   *  `BigNumber size="sm"` with its basis caption. `PlayerRow`'s own slot, same contract. */
  readonly figure?: ReactNode;
  readonly highlight?: boolean;
  readonly className?: string;
}

/**
 * A club, drawn in the same row treatment as a player (site search round, 2026-09-08): the
 * `PlayerRow` shell, the club's own colour as a ring around its initials, the name at the same
 * weight, the facts on the same mono line. Where `PlayerRow` puts a position sticker, this puts a
 * neutral "Team" badge, because the one thing a reader must never mistake a team result for is the
 * team's defense row, which sits one line below it carrying "DEF".
 *
 * `PlayerFace` takes a `Player` and reads three fields of it (name, club, headshot), so the row
 * hands it the club as one: no photo, so the face is the initials the club's own name yields.
 * Nothing about that is a claim: the ring is decorative and `aria-hidden` in `PlayerFace` itself,
 * and the code is stated in text beside it.
 */
export function TeamRow({ code, name, meta, figure, highlight = false, className = "" }: TeamRowProps) {
  const asFace: Player = { id: code, name, position: "DEF", nflTeam: code, headshotUrl: null, adp: null };
  return (
    <div data-highlight={highlight ? "true" : undefined} className={rowShellClass(highlight, className)}>
      <PlayerFace player={asFace} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span data-testid="team-row-name" className={ROW_NAME_CLASS}>{name}</span>
        <span className={ROW_META_CLASS}>
          <Badge tone="neutral" className="text-xs">Team</Badge>
          {meta === undefined ? null : <span className="truncate">{meta}</span>}
        </span>
      </div>
      {figure === undefined || figure === null ? null : <div className="shrink-0 text-right">{figure}</div>}
    </div>
  );
}
