import type { ReactElement } from "react";
import { MICRO_LABEL } from "./config";

export type ChapterBandTone = "live" | "warn" | "quiet";

/**
 * `live` is a SOLID fill because the live channel owns one: red means happening right now, and a
 * room filling as you watch is the canonical case.
 *
 * `warn` is an OUTLINE, and that is a token fact rather than a taste one: `warning` ships no
 * `warningText` role, and the semantic-on-fill rule says a semantic fill must be paired with its
 * own `-text` role and never with a raw white or black. So the tightening-clock plate is drawn
 * the way `Badge` draws every semantic label since NEW-5 — the hue as ink and as a boundary.
 */
const PLATE_CLASS: Readonly<Record<ChapterBandTone, string>> = {
  live: "bg-live text-live-text",
  warn: "border border-warning text-warning",
  quiet: "bg-surface-raised text-text-muted",
};

export interface ChapterBandProps {
  /** The chapter's name, on the plate. Two or three words at most. */
  readonly name: string;
  /** What the chapter MEANS, in plain language — "a real drop after this", not a restatement of
   *  the name. Law 5's whole point: the letter is only its name; the consequence is what a band
   *  is for. */
  readonly consequence: string;
  /** `live` is the red plate and is spent ONLY where the rows below it are genuinely happening
   *  right now — law 4 gives red one job and no others, and "overdue" is not that job. A clock
   *  that has run long is `warn`. Everything else is `quiet`. */
  readonly tone?: ChapterBandTone;
}

/**
 * SUNDAY v5, LAW 5 — bands are chapter markers, not hairlines.
 *
 * A hairline divider at sixty rows becomes the loudest thing on the screen while saying the least.
 * A chapter band is a filled plate carrying its name and its **consequence in plain language**,
 * so a reader arriving mid-column learns what the rows beneath it have in common without counting
 * anything.
 *
 * Extracted from the open-league board's own two bands (`public-league-list.tsx`, which still
 * hand-rolls this shape and belongs to another route track today) at its second surface, the
 * moderation queue's age split. One geometry, two boards — the alternative was a second copy of
 * the same four Tailwind classes drifting away from the first.
 *
 * THE PLATE IS NEVER THE ONLY CHANNEL. The name is text on the plate and the consequence is text
 * beside it, so the band survives with the hue channel switched off entirely — the same discipline
 * the tier ladder holds to, where the LETTER is the colourblind channel.
 */
export function ChapterBand({ name, consequence, tone = "quiet" }: ChapterBandProps): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-t border-line bg-gradient-to-r from-surface-raised to-transparent px-2 py-1.5">
      <span className={`${MICRO_LABEL} rounded-sm px-2 py-0.5 font-semibold ${PLATE_CLASS[tone]}`}>{name}</span>
      <span className={`${MICRO_LABEL} text-text-muted`}>{consequence}</span>
    </div>
  );
}
