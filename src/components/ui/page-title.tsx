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
 */
export function PageTitle({ children, size = "md" }: PageTitleProps) {
  return <h1 className={`font-display font-bold leading-display text-text-primary ${SIZE[size]}`}>{children}</h1>;
}
