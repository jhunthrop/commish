import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "./badge";

/**
 * `hot` is the live family — the same `negative` pigment `Countdown`'s hot tone, the draft room's
 * my-turn rail and `GameStateChip`'s live state already spend. It is NOT decoration and not a
 * severity: it is reserved for the two chips that carry real urgency on a Sunday screen, "3 yet
 * to play" (points that can still arrive) and the bench-regret figure (points that already
 * didn't). Everything else is `neutral`.
 *
 * A two-name tone rather than passing `BadgeTone` straight through, because the chip's vocabulary
 * is smaller than a badge's on purpose: a `Pill` that could be `warning` or `accent` would be a
 * second badge with a different font, and the map below is what keeps the two primitives from
 * collapsing into each other.
 */
export type PillTone = "neutral" | "hot";

const TONE: Readonly<Record<PillTone, BadgeTone>> = {
  neutral: "neutral",
  hot: "negative",
};

export interface PillProps {
  readonly tone?: PillTone;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * The figure-carrying chip: "3 yet to play", "18.4 on your bench".
 *
 * **WHY IT IS `Badge` PLUS MONO AND NOT ITS OWN GEOMETRY.** One pill shape in this product, one
 * home for it. `Badge` already owns the radius, the padding, the `whitespace-nowrap` a chip needs
 * in a narrow column, and the tone borders; duplicating any of that here is how two chips that
 * are meant to look identical stop looking identical. What this adds is the one thing `Badge` is
 * wrong about for this job: the face. A `Badge` labels a STATE in the body face ("Live", "Fix
 * lineup"); a `Pill` states a NUMBER inside a sentence, and mono's tabular figures are what stop
 * a row of them jittering as the count ticks from 3 to 2 to 1 — the same reason every score in
 * the product is tabular.
 *
 * **WHAT IT IS FOR.** Gameday's spec asks for two facts a generic scoreboard omits: yet-to-play
 * ("Answer 'can I still win?', not only 'am I winning?'") and regret ("State regret plainly —
 * bench points, missed waivers — because the manager is already computing it"). Both are small,
 * both are a number wrapped in three words, and both were going to be hand-rolled `<span>`s on
 * whichever surface needed them first. This is that span, once.
 */
export function Pill({ tone = "neutral", children, className = "" }: PillProps) {
  return (
    <Badge tone={TONE[tone]} className={`font-mono ${className}`}>
      {children}
    </Badge>
  );
}
