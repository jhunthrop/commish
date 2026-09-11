import type { ReactNode } from "react";
import type { Player } from "@/domain/player";
import { PlayerFace } from "./player-face";
import { PositionBadge } from "./position-badge";

export interface PlayerRowProps {
  readonly player: Player;
  /** This player's rank among his own position on the board rendering him, printed on the
   *  sticker. Omitted by every surface with no ranked board behind it. */
  readonly positionRank?: number;
  /** The facts after the position sticker: "IND · Bye 13". A node, so a caller can put a live
   *  chip or a kickoff time in the run. */
  readonly meta?: ReactNode;
  /** Reason chips on their own line under the meta line; omitted rows keep their height. */
  readonly chips?: ReactNode;
  /** The judgement, if the surface has one: a `Stat` in its `inline` orientation. `Stat` is the
   *  ONLY component allowed to name a magnitude colour, which is why this is a slot. */
  readonly verdict?: ReactNode;
  /** THE ONE NUMBER, at the row's right (P2): a `BigNumber size="sm"` with its basis caption. */
  readonly figure?: ReactNode;
  /** The one control: `<Button variant="verb" size="sm">Draft</Button>`. The row never builds it. */
  readonly action?: ReactNode;
  /** The row that is yours, or the one the moment is about: the amber wash. */
  readonly highlight?: boolean;
  readonly className?: string;
}

/**
 * SIDELINE'S ROW SKINS, each spelled whole. Plain is paper with a chalk hover plate; highlight
 * is your own row's amber wash (`self-wash`, a `globals.css` utility over the per-theme
 * `selfGlow` role). No hairline in either: rows sit inside a card and separate by rhythm.
 */
const SKIN: Readonly<Record<"plain" | "highlight", string>> = {
  plain: "hover:bg-surface",
  highlight: "self-wash",
};

/**
 * THE ROW'S SHELL, SHARED with `TeamRow`: 48px tall (`min-h-12`, `TOKENS.density.rowPx`), a
 * 12px plate, the face, then the name column, then the number, then the control. Four regions
 * at most (`TOKENS.density.maxColumns`).
 */
export function rowShellClass(highlight: boolean, className = ""): string {
  return `flex min-h-12 items-center gap-3 rounded-md px-2.5 py-1 ${SKIN[highlight ? "highlight" : "plain"]} ${className}`.trimEnd();
}

/** The name: 17px in the display face at 700, the largest thing on the row (P1). */
export const ROW_NAME_CLASS = "truncate font-display text-lg font-bold leading-tight text-text-primary";

/** The meta line: small, quiet, in the body face. */
export const ROW_META_CLASS = "flex min-w-0 items-center gap-1.5 text-sm text-text-muted";

/**
 * A player as a row you can read from arm's length and act on with one thumb (P1, P2, P3, P10):
 * the face on his club's ring, the name largest, the facts small, one number at the right with
 * its basis, one control. The row is a `<div>` and never a control: it carries no role, no
 * tabIndex and no click handler, because the thing you act on is the button inside it.
 *
 * TRUNCATION IS LOAD-BEARING AT 360px: the name column is `min-w-0` and the name truncates, or a
 * flex child's automatic minimum size lets one long name push the whole PAGE sideways.
 */
export function PlayerRow({ player, positionRank, meta, chips, verdict, figure, action, highlight = false, className = "" }: PlayerRowProps) {
  return (
    <div data-highlight={highlight ? "true" : undefined} className={rowShellClass(highlight, className)}>
      <PlayerFace player={player} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* `pool-player-name` is a TEST CONTRACT (e2e makeTopPick helpers read the picked name
            through it, never through DOM adjacency). */}
        <span data-testid="pool-player-name" className={ROW_NAME_CLASS}>{player.name}</span>
        <span className={ROW_META_CLASS}>
          <PositionBadge position={player.position} rank={positionRank} size="sm" />
          {meta === undefined ? null : <span className="truncate">{meta}</span>}
          {verdict === undefined || verdict === null ? null : <span className="ml-auto shrink-0 pl-2">{verdict}</span>}
        </span>
        {chips === undefined || chips === null ? null : <span className="flex flex-wrap items-center gap-1">{chips}</span>}
      </div>
      {figure === undefined || figure === null ? null : <div className="shrink-0 text-right">{figure}</div>}
      {action === undefined ? null : <div className="shrink-0">{action}</div>}
    </div>
  );
}
