import type { ReactNode } from "react";

export type PageTitleSize = "md" | "xl";

export interface PageTitleProps {
  readonly children: ReactNode;
  readonly size?: PageTitleSize;
}

const SIZE: Readonly<Record<PageTitleSize, string>> = {
  md: "text-display-md",
  xl: "text-display-xl",
};

/**
 * The one `<h1>` treatment for a PAGE (not a room — `RoomLayout` supplies its own `<h1>`
 * under a different layout contract, see `docs/design-system.md`). Every page under
 * `src/app/**` and `LeagueHome` shared this class string by copy-paste; this is the single
 * definition.
 *
 * `min-w-0 [overflow-wrap:anywhere]`, not `break-words` — the same fix, and the same reasoning,
 * as `Button`'s `BASE` class docblock: a page title is frequently USER CONTENT (a league's name)
 * and display type at 360px has very little room to spare. `break-words`
 * (`overflow-wrap: break-word`) wraps text visually but is explicitly ignored when a browser
 * computes a box's min-content contribution, so a single unbroken league name could still widen
 * the box (and the page) to fit the whole word before wrapping it — which is exactly what made
 * the league home scroll sideways (607px of document in a 360px viewport) before this was first
 * fixed, and what v2's Geist retone (wider glyphs than the old Barlow Condensed) reopened at a
 * smaller scale. `anywhere` is the one value that both wraps AND shrinks min-content; it still
 * only breaks a word that would not otherwise fit, so ordinary titles are untouched. Fixed in
 * the primitive rather than at one call site, so every page title is safe by construction.
 */
export function PageTitle({ children, size = "md" }: PageTitleProps) {
  // `font-semibold`, not `font-bold` (Task 9, the last display-weight residue named by Task 3's
  // and Task 7's reports): every other display heading in the product converged on the mock's
  // 600 weight once its caps transform came off — this primitive is the one spot that still
  // carried the old 700, since nothing here ever wore a caps class for the caps sweep to catch.
  return <h1 className={`min-w-0 [overflow-wrap:anywhere] font-display font-semibold leading-display text-text-primary ${SIZE[size]}`}>{children}</h1>;
}
