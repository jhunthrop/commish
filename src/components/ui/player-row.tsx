import type { ReactNode } from "react";
import type { Player } from "@research-ts/domain/player";
import { PlayerFace } from "./player-face";
import { PositionBadge } from "./position-badge";

export interface PlayerRowProps {
  readonly player: Player;
  /**
   * HIS PLACE IN A RANKED LIST, before the face (the draft board, a ladder). Body size in the
   * quiet ink and NEVER display type: P1 rules out "rows that begin with a rank numeral in display
   * type", and the test it sets is that covering the numbers still leaves a readable list of
   * people. This is not a fifth region — the ordinal and the face are one identity block, which is
   * why the board's four data regions (identity, facts, the number, the control) are unchanged.
   * Omitted by every surface with no ordering of its own.
   */
  readonly lead?: ReactNode;
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
  /**
   * THE RESEARCH DENSITY (`TOKENS.density.denseRowPx`, 44) — the pool, a game log, the draft
   * board: "research screens go dense to 44px with a face still present". The face steps down to
   * 32 with the row; nothing else about the row changes, because a dense row that also dropped the
   * face would be the table this vocabulary replaced.
   */
  readonly dense?: boolean;
  /**
   * The name rendered as the product's pressable name (`PlayerName`, the one season-peek
   * primitive) where a surface has one. Omitted, the row prints the player's name as text. The
   * slot sits inside the name column's own span, so the size, the weight and the truncation are
   * the row's whatever the call site hands in.
   */
  readonly name?: ReactNode;
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
 * THE ROW'S SHELL, SHARED with `TeamRow`: 48px tall (`min-h-12`, `TOKENS.density.rowPx`) or 44 on
 * a research surface (`min-h-11`, `TOKENS.density.denseRowPx`), a 12px plate, the face, then the
 * name column, then the number, then the control. Four regions at most
 * (`TOKENS.density.maxColumns`).
 *
 * THE HEIGHT IS CHOSEN HERE AND NEVER APPENDED BY A CALLER. Two `min-h-*` utilities in one class
 * string is not a last-one-wins: Tailwind emits them in ITS order, so `min-h-11 min-h-12` renders
 * 48 and the dense row silently is not dense. One ternary, one utility.
 */
export function rowShellClass(highlight: boolean, className = "", dense = false): string {
  // The dense row spends its two vertical pixels on content rather than on padding: the name and
  // the facts line alone are 42px at Sideline's own type sizes, so `py-1` would put a "44px" row at
  // 50 and the density token would be a number nothing measured.
  // The dense row also closes its gaps from 12 to 8. Four gaps at 12px is 48 of a 360px row spent
  // on air, and the column that pays for it is the NAME — measured on the draft board at 360,
  // where "Puka Nacua" truncated to "Puka Na…" and P1's own test (cover the numbers, can you still
  // read who is on the list) failed on the product's densest surface.
  return `flex items-center rounded-md px-2.5 ${dense ? "min-h-11 gap-2 py-0.5" : "min-h-12 gap-3 py-1"} ${SKIN[highlight ? "highlight" : "plain"]} ${className}`.trimEnd();
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
export function PlayerRow({ player, lead, positionRank, meta, chips, verdict, figure, action, name, dense = false, highlight = false, className = "" }: PlayerRowProps) {
  return (
    <div data-highlight={highlight ? "true" : undefined} className={rowShellClass(highlight, className, dense)}>
      {lead === undefined || lead === null ? null : <span className="shrink-0 text-right text-sm tabular-nums text-text-faint">{lead}</span>}
      <PlayerFace player={player} size={dense ? "sm" : "md"} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* `pool-player-name` is a TEST CONTRACT (e2e makeTopPick helpers read the picked name
            through it, never through DOM adjacency). */}
        <span data-testid="pool-player-name" className={ROW_NAME_CLASS}>{name ?? player.name}</span>
        <span className={ROW_META_CLASS}>
          <PositionBadge position={player.position} rank={positionRank} size="sm" />
          {meta === undefined ? null : <span className="min-w-0 truncate">{meta}</span>}
          {verdict === undefined || verdict === null ? null : <span className="ml-auto shrink-0 pl-2">{verdict}</span>}
        </span>
        {chips === undefined || chips === null ? null : <span className="flex flex-wrap items-center gap-1">{chips}</span>}
      </div>
      {figure === undefined || figure === null ? null : <div className="shrink-0 text-right">{figure}</div>}
      {action === undefined ? null : <div className="shrink-0">{action}</div>}
    </div>
  );
}
