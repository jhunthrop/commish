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
  readonly className?: string;
}

/**
 * THE MANAGER AVATAR, BESIDE A NAME ALWAYS (P1: the person comes before the number; Sideline:
 * "manager avatars everywhere, always beside their name"). This is the only way a manager's face
 * renders on a Sideline screen: `Avatar` alone is a face with no one attached, so a surface that
 * wants a face imports this and gets the name with it. The name is the row's largest thing; the
 * meta line is small; the face is decorative because the name is right there.
 */
export function Manager({ name, avatar, size = "md", ring, meta, trailing, className = "" }: ManagerProps) {
  return (
    <span data-testid="manager" className={`flex min-w-0 items-center gap-2.5 ${className}`.trimEnd()}>
      <Avatar name={name} avatar={avatar} size={size} ring={ring} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-display text-md font-bold leading-tight text-text-primary">{name}</span>
        {meta === undefined || meta === null ? null : <span className="truncate text-sm text-text-muted">{meta}</span>}
      </span>
      {trailing === undefined || trailing === null ? null : <span className="ml-auto shrink-0">{trailing}</span>}
    </span>
  );
}
