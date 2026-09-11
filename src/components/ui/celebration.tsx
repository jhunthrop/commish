"use client";

import { useEntranceClass } from "@/design/use-motion";
import { Avatar } from "./avatar";
import { BigNumber } from "./big-number";

export interface CelebrationPerson {
  readonly name: string;
  readonly avatar?: string | null;
}

export interface CelebrationProps {
  readonly title: string;
  readonly detail?: string;
  /** "self" is the user's own moment and gets the louder treatment. */
  readonly emphasis: "self" | "peer";
  /** P8: the frame says which league. */
  readonly leagueName?: string;
  /** P8: the people in the moment, faces and names. */
  readonly people?: readonly CelebrationPerson[];
  /** P8: the number that earned the moment, with its basis. */
  readonly figure?: { readonly value: string; readonly basis: string };
  /** P8: the date, already formatted. */
  readonly date?: string;
  readonly testId?: string;
}

/**
 * THE CELEBRATION FRAME (P8: every moment worth screenshotting has a frame). A self-contained
 * card with the league's name, the people, the number and the date, at a size that looks right
 * in a group text. The frame IS the celebration: there is no confetti layer that means nothing.
 *
 * Your own moment slaps in (Tailgate's entrance, borrowed for celebration scale only, section 5
 * of the first-principles document) on the amber wash; somebody else's springs in on paper.
 * `role="status"` announces it politely. Reduced motion is a real branch: the frame appears
 * with no animation class at all, because losing the fact would be worse than the motion.
 */
export function Celebration({ title, detail, emphasis, leagueName, people, figure, date, testId }: CelebrationProps) {
  const motion = useEntranceClass(emphasis === "self" ? "celebrate" : "in");
  const skin = emphasis === "self" ? "self-wash ring-2 ring-self" : "";
  const faces = people ?? [];
  return (
    <div role="status" data-testid={testId} data-emphasis={emphasis} className={`flex flex-col gap-3 rounded-xl bg-surface-elevated p-4 shadow-card ${skin} ${motion}`.replace(/\s+/g, " ").trimEnd()}>
      {leagueName === undefined && date === undefined ? null : (
        <p className="flex items-baseline justify-between gap-3 text-xs font-semibold text-text-faint">
          <span>{leagueName}</span>
          <span className="font-normal">{date}</span>
        </p>
      )}
      <div className="flex items-center gap-3">
        {faces.length === 0 ? null : (
          <span className="flex shrink-0" aria-hidden="true">
            {faces.map((person, index) => (
              <Avatar key={`${person.name}-${index}`} name={person.name} avatar={person.avatar} size="lg" className={index === 0 ? "" : "-ml-2.5 ring-2 ring-surface-elevated"} />
            ))}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="font-display text-lg font-bold leading-tight text-text-primary">{title}</p>
          {detail === undefined ? null : <p className="text-sm text-text-muted">{detail}</p>}
          {faces.length === 0 ? null : <p className="text-sm text-text-muted">{faces.map((person) => person.name).join(" and ")}</p>}
        </div>
        {figure === undefined ? null : <BigNumber value={figure.value} basis={figure.basis} size="md" />}
      </div>
    </div>
  );
}
