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
 * `break-words` because a page title is frequently USER CONTENT — a league's name — and display
 * type at 360px has very little room to spare. A single unbroken 36-character league name made
 * the whole league home scroll sideways (607px of document in a 360px viewport). Fixed in the
 * primitive rather than at one call site, so every page title is safe by construction.
 */
export function PageTitle({ children, size = "md" }: PageTitleProps) {
  return <h1 className={`break-words font-display font-bold leading-display text-text-primary ${SIZE[size]}`}>{children}</h1>;
}
