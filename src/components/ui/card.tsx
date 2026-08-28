import type { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  readonly as?: "div" | "section" | "article";
  /**
   * RULE 4'S AMENDED TEST, in code (`docs/design/2026-08-27-fun-pass-spec.md`, founder-approved
   * 2026-08-27): **a thing you act on or compare against its neighbours may be a card; a thing
   * you read down a column stays a row.** Set this when the card is the first kind — a league on
   * the shelf, a player in the pool, a matchup — and leave it off for the second, and for a panel
   * you merely read.
   *
   * The card still never becomes the control: the action inside it does. This adds a depth
   * response and nothing else, which is why it cannot swallow its own button or grow a second
   * click target the view's one-ink-action law (rule 5) never counted.
   */
  readonly interactive?: boolean;
}

/**
 * The depth step a card takes when you point at it, or when the keyboard lands on something
 * inside it. `surfaceRaised` is the role the palette already names "a row hover, a field, a
 * nested tile" — it existed for exactly this and, until the fun pass, was used as a hover on
 * nothing at all. That absence is a real part of what "it feels like a legal website" was
 * describing: a shelf of leagues a manager is meant to compare and then act on sat as still as a
 * page of terms.
 *
 * Depth, deliberately, and never a heavier line: rule 4 did not move. `line` stays the
 * decorative hairline, `edge` stays the boundary of a control, and a card is not a control.
 * `transition-colors` is a response to the reader rather than an animation of its own, and
 * `globals.css`'s reduced-motion block collapses it for anyone who asked for less.
 */
const INTERACTIVE = "transition-colors hover:bg-surface-raised focus-within:bg-surface-raised";

const BASE = "rounded-lg border border-line bg-surface-elevated p-4 shadow-card";

export function Card({ as: Tag = "div", interactive = false, className = "", children, ...rest }: CardProps) {
  // Joined from the non-empty fragments rather than interpolated: a `${cond ? x : ""}` slot
  // leaves a double space in the rendered `class` attribute on every quiet card in the product.
  const classes = [BASE, interactive ? INTERACTIVE : "", className].filter((part) => part !== "").join(" ");
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
