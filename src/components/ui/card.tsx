import type { HTMLAttributes } from "react";

/**
 * How much room a card gives its contents. `comfortable` is the default panel-sized card;
 * `compact` is a card that is also a ROW in a dense list.
 *
 * The padding lives HERE and not in `BASE`: two utilities of equal specificity resolve by
 * stylesheet order, so a base padding plus an override is a bet on Tailwind's emission order.
 * One padding declaration per card, chosen by name, races nothing.
 */
export type CardPadding = "comfortable" | "compact";

/**
 * SIDELINE'S ONE MATERIAL: a layered surface, paper on chalk, 20px corners, the soft shadow
 * token. `outline` keeps the hairline for the few places a border is SEMANTIC rather than
 * material (a dashed placeholder, a boundary a reader is meant to notice as a line). Your own
 * card or the card that needs you is a wash at its call site (`self-wash`), never a heavier
 * card variant here.
 */
export type CardVariant = "soft" | "outline";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** The element a card needs to BE is a semantic fact about its surroundings: a page's title
   *  block is a `header`, a card that is a list row is an `li`. */
  readonly as?: "div" | "section" | "article" | "header" | "li";
  /**
   * Set this when the card is a thing you act on or compare against its neighbours (a league on
   * the shelf, a matchup), and leave it off for a panel you merely read. The card still never
   * becomes the control: the action inside it does. This adds a depth response and nothing else.
   */
  readonly interactive?: boolean;
  /** @default "comfortable" */
  readonly padding?: CardPadding;
  /** @default "soft" */
  readonly variant?: CardVariant;
}

/**
 * The depth step a card takes when you point at it, or when the keyboard lands on something
 * inside it. Depth, never a heavier line: `line` stays the hairline, `edge` stays the boundary
 * of a control, and a card is not a control. `transition-colors` is a response to the reader
 * rather than an animation of its own, and the reduced-motion block collapses it.
 */
const INTERACTIVE = "transition-colors hover:bg-surface-raised focus-within:bg-surface-raised";

const BASE = "rounded-xl bg-surface-elevated shadow-card";

const VARIANT: Readonly<Record<CardVariant, string>> = {
  soft: "",
  outline: "border border-line",
};

const PADDING: Readonly<Record<CardPadding, string>> = {
  comfortable: "p-4",
  compact: "px-2.5 py-2",
};

export function Card({ as: Tag = "div", interactive = false, padding = "comfortable", variant = "soft", className = "", children, ...rest }: CardProps) {
  // Joined from the non-empty fragments rather than interpolated: a `${cond ? x : ""}` slot
  // leaves a double space in the rendered `class` attribute on every quiet card in the product.
  const classes = [BASE, VARIANT[variant], PADDING[padding], interactive ? INTERACTIVE : "", className].filter((part) => part !== "").join(" ");
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
