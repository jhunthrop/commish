import type { ReactNode } from "react";
import type { Player } from "@/domain/player";
import { PlayerFace } from "./player-face";
import { PositionBadge } from "./position-badge";

export interface PlayerRowProps {
  readonly player: Player;
  /** This player's rank among his own position on the board rendering him — the "4" in "RB4",
   *  printed on the sticker rather than in a column of its own. Omitted by every surface with no
   *  ranked board behind it, which is most of them. */
  readonly positionRank?: number;
  /** The facts after the position sticker: "IND · Bye 13 · RB4". A node, not a string, so a
   *  caller can put a live chip or a kickoff time in the run without this file learning about
   *  either. */
  readonly meta?: ReactNode;
  /** The judgement, if the surface has one — a `Stat` in its `inline` orientation ("+11 steal").
   *  `Stat` is the ONLY component allowed to name a magnitude colour
   *  (`magnitude-budget.source.test.ts`), which is exactly why this is a slot and not a prop this
   *  row renders itself. */
  readonly verdict?: ReactNode;
  /** The verb: `<Button variant="verb">Draft</Button>`. The row never builds it — see the
   *  docblock. */
  readonly action?: ReactNode;
  /** The top-of-board row: the one a manager is meant to act on next. */
  readonly highlight?: boolean;
  readonly className?: string;
}

/**
 * The row's two skins, each spelling its OWN border colour rather than layering one over a shared
 * base.
 *
 * That is a correctness choice, not tidiness, and it is the same one `Card`'s padding docblock
 * makes: `border-line` and `border-accent` are utilities of equal specificity, so a base class
 * plus an override resolves by STYLESHEET ORDER — decided by Tailwind's own emission sequence,
 * which follows the order the colour aliases happen to appear in `globals.css`. That bet is
 * silently winnable today and silently lost the day somebody sorts the alias block. Choosing the
 * whole skin by name races nothing.
 *
 * `accent-wash` is a `globals.css` utility, and it is the answer to a real constraint rather than
 * a preference: `accent-budget.source.test.ts` bans the substring `bg-accent` from every `.tsx`
 * outside a six-file allowlist, which catches `bg-accent/10` too. The budget's target was eleven
 * hand-rolled copies of one CTA class drifting apart, so the fix it actually wants is ONE address
 * for the tint — and the product already had that shape for the hero's `.floodlight`. The wash is
 * its row-sized sibling: same `accentGlow` role (a tint the palette designs per theme, never an
 * opaque fill), named once in CSS, asked for by name here. Green still means "press this", and
 * the pressable thing in this row is the button the row does not own.
 */
const SKIN: Readonly<Record<"plain" | "highlight", string>> = {
  plain: "border-line bg-surface-elevated",
  highlight: "border-accent bg-surface-elevated accent-wash",
};

/**
 * A player, drawn as a thing you act on — law 3 ("a player is an object") and law 5 ("the verb is
 * obvious") in one atom, and the unit the draft board, the pool and the queue are all made of.
 *
 * FOUR REGIONS, LEFT TO RIGHT, AND THE ORDER IS THE ARGUMENT: the face on its club colour, the
 * name over its meta line, the verdict, the verb. A manager scanning sixty of these reads
 * identity, then facts, then judgement, then what he can do about it — and the verb ends up in the
 * same horizontal position on every row, which is what makes it findable when it repeats forty
 * times down a board. v3's "one ink action per view" hid exactly this button on exactly this
 * screen; law 5 replaces that rule and this layout is what replacing it looks like.
 *
 * THE ROW DOES NOT BUILD ITS OWN BUTTON. `action` is a slot, so the same atom carries "Draft" in a
 * snake room, "Nominate" in an auction, "Queue" in the watch list and nothing at all on a board
 * you are only reading. A row that hard-coded the verb would have to learn every room's rules
 * about when a manager may act, which is server truth and belongs nowhere near a presentation
 * primitive. The same reasoning makes `verdict` a slot: a magnitude colour may only be named by
 * `Stat` (`magnitude-budget.source.test.ts`), and that budget is what keeps green meaning "press
 * this" everywhere else in the product.
 *
 * TRUNCATION IS LOAD-BEARING AT 360px (`TOKENS.minViewport`). The name column is `min-w-0` and the
 * name itself truncates — without BOTH, a flex child's automatic minimum size is its content, so
 * one long name ("Amon-Ra St. Brown" beside a verdict chip and a button) pushes the row wider than
 * the viewport and the whole PAGE scrolls sideways. Not the row: the page. It is the single most
 * common way a dense list breaks on a phone, and the fix has to live here rather than at sixty
 * call sites.
 *
 * The row is a `<div>` and never a control. It carries no `role`, no `tabIndex` and no click
 * handler: the thing you act on is the button inside it, which is a real focus stop with a real
 * name, and wrapping a second click target around it is how a board ends up with two ways to draft
 * the wrong man.
 */
export function PlayerRow({ player, positionRank, meta, verdict, action, highlight = false, className = "" }: PlayerRowProps) {
  return (
    <div
      data-highlight={highlight ? "true" : undefined}
      className={`flex items-center gap-3 rounded-lg border py-2 pl-2 pr-3 ${SKIN[highlight ? "highlight" : "plain"]} ${className}`}
    >
      {/* `md` (44px) is the approved composition's own face size, not a default taken on trust —
          the mock sets `.face { width: 2.75rem }` and the row's whole left edge is built around
          it. It is the one measurement here that law 4 does NOT get to tighten: law 3 says a
          player is an object, and the face IS the object. Shrink it and the row degrades into the
          line of text law 3 replaced. */}
      <PlayerFace player={player} size="md" />
      {/* `min-w-0` on the column AND `truncate` on the name — see the docblock; either one alone
          leaves the page scrolling sideways at 360px. */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* `text-md`/600 is the approved composition's own name treatment (`.pname` is 1rem at
            weight 600). Law 2 says the largest thing on a screen is a number or a NAME, and on a
            board of sixty rows the name is the thing being scanned — it outranks the meta line
            under it rather than matching it. 600 is the cap, not a step toward 700. */}
        <span className="truncate text-md font-semibold leading-tight text-text-primary">{player.name}</span>
        {/* Law 3's third attribute rides here rather than beside the face: the sticker is a fact
            about the player and belongs with the other facts, and putting it on the tile would
            cover the club colour that is the tile's only job. Mono because this line is data —
            a team code, a bye week, a positional rank — and mono keeps those columns aligned as
            the eye runs down sixty rows. */}
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-text-muted">
          <PositionBadge position={player.position} rank={positionRank} size="sm" />
          {meta === undefined ? null : <span className="truncate">{meta}</span>}
          {/* THE VERDICT RIDES THE DATA LINE (founder, 2026-08-28: "you cant see the players
              name on the pick list"). As a third sibling on the primary axis it was a fixed-width
              tenant beside the star and the verb, and the name — the thing law 2 says a board is
              FOR — truncated at six characters in a 540px rail. A verdict is a fact about the
              player, so it sits with the facts, pushed to the line's right edge where the eye
              expects a figure. The name now loses width only to the face and the act. */}
          {verdict === undefined || verdict === null ? null : <span className="ml-auto shrink-0 pl-2">{verdict}</span>}
        </span>
      </div>
      {action === undefined ? null : <div className="shrink-0">{action}</div>}
    </div>
  );
}
