import type { ReactNode } from "react";
import { Avatar, type AvatarRing, type AvatarSize } from "./avatar";

export interface ManagerProps {
  /** The person's display name, printed beside the face. Always. */
  readonly name: string;
  /** The stored avatar ref, as `Avatar` takes it. */
  readonly avatar?: string | null;
  readonly size?: AvatarSize;
  /** You wear the amber ring; your opponent this week wears the rose one. */
  readonly ring?: AvatarRing;
  /** A second line under the name: a team name, a record, "commissioner". */
  readonly meta?: ReactNode;
  /** Something at the row's right end: a score, a chip, a presence dot. */
  readonly trailing?: ReactNode;
  /**
   * THE ONE SURFACE WHERE A MANAGER IS THE PAGE (the account room): the name is the document's
   * own heading, not a label inside a row. A `<span>` everywhere else, because a manager beside
   * forty other managers is a list item and a page has one heading.
   */
  readonly titleAs?: "span" | "h1" | "h2";
  readonly className?: string;
}

/**
 * HOW LARGE THE NAME IS AT EACH FACE SIZE — read here, never chosen by a call site. A row's
 * manager keeps Sideline's 15px name; the account room's 96px face is the page's own object and
 * its name takes the display scale that makes it the largest thing on the screen (P1: the person
 * comes before the number, and here the person IS the screen).
 */
const NAME_CLASS: Readonly<Record<AvatarSize, string>> = {
  xs: "text-md",
  sm: "text-md",
  md: "text-md",
  lg: "text-lg",
  xl: "text-display-sm leading-display",
  "2xl": "text-display-md leading-display",
  "3xl": "text-display-lg leading-display",
};

/**
 * THE MANAGER AVATAR, BESIDE A NAME ALWAYS (P1: the person comes before the number; Sideline:
 * "manager avatars everywhere, always beside their name"). This is the only way a manager's face
 * renders on a Sideline screen: `Avatar` alone is a face with no one attached, so a surface that
 * wants a face imports this and gets the name with it. The name is the row's largest thing; the
 * meta line is small; the face is decorative because the name is right there.
 */
export function Manager({ name, avatar, size = "md", ring, meta, trailing, titleAs: Title = "span", className = "" }: ManagerProps) {
  return (
    <span data-testid="manager" className={`flex min-w-0 items-center gap-2.5 ${className}`.trimEnd()}>
      <Avatar name={name} avatar={avatar} size={size} ring={ring} />
      <span className="flex min-w-0 flex-1 flex-col">
        <Title className={`truncate font-display font-bold leading-tight text-text-primary ${NAME_CLASS[size]}`}>{name}</Title>
        {/* A ROW's meta line truncates, so the row keeps its rhythm whatever a team is called. A
            HERO's does not: the account room's meta is a stack (an address, then the badges that
            say what this account is), and truncating a stack clips it to one line. */}
        {meta === undefined || meta === null ? null : (
          <span className={`min-w-0 text-sm text-text-muted ${size === "xl" || size === "2xl" || size === "3xl" ? "" : "truncate"}`.trimEnd()}>{meta}</span>
        )}
      </span>
      {trailing === undefined || trailing === null ? null : <span className="ml-auto shrink-0">{trailing}</span>}
    </span>
  );
}
