import type { HTMLAttributes } from "react";

/**
 * How much room a card gives its contents. `comfortable` is the default panel-sized card;
 * `compact` is a card that is also a ROW in a dense list — the draft room's player pool, sixty of
 * them in a 320px rail, where the panel's own padding fits eight.
 *
 * The padding lives HERE and not in `BASE`, and that is a correctness choice rather than
 * tidiness. `BASE` carried `p-4` and the first cut of this prop layered `px-2 py-1.5` on top of
 * it, which only works if Tailwind reliably emits every shorthand ahead of its longhands — a bet
 * on stylesheet ORDER, decided by the framework's sort rather than by anything stated here. One
 * padding declaration per card, chosen by name, races nothing and needs no bet.
 */
export type CardPadding = "comfortable" | "compact";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /**
   * Both `header` and `li` joined the union during the fun pass, from opposite ends of the
   * product, and both for the same reason: the element a card needs to BE is a semantic fact
   * about its surroundings, and a card that cannot be that element gets reimplemented inline.
   *
   * `header` (Task 11) — a page's own title block is a card in every visual respect and a
   * `<header>` in every semantic one. Spelling `Card`'s base classes inline to keep the element
   * was exactly how the league home ended up carrying a second copy of the surface vocabulary.
   *
   * `li` (Task 8) — a `<ul>`/`<ol>` may only contain `<li>` children, so a card that IS a list
   * row has to be able to be one rather than sit inside a second wrapper element.
   */
  readonly as?: "div" | "section" | "article" | "header" | "li";
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
  /** @default "comfortable" */
  readonly padding?: CardPadding;
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

const BASE = "rounded-lg border border-line bg-surface-elevated shadow-card";

const PADDING: Readonly<Record<CardPadding, string>> = {
  comfortable: "p-4",
  compact: "px-2 py-1.5",
};

export function Card({ as: Tag = "div", interactive = false, padding = "comfortable", className = "", children, ...rest }: CardProps) {
  // Joined from the non-empty fragments rather than interpolated: a `${cond ? x : ""}` slot
  // leaves a double space in the rendered `class` attribute on every quiet card in the product.
  const classes = [BASE, PADDING[padding], interactive ? INTERACTIVE : "", className].filter((part) => part !== "").join(" ");
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
