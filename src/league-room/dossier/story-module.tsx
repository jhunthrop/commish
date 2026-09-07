import { Card } from "@/components/ui";

/**
 * A LOCALLY DECLARED TYPE, ON PURPOSE (dossier plan, controller ruling R-d1) — this does NOT
 * import from `src/projections/availability`, whose own service wiring for a season-ending
 * absence converges post-merge with this branch. This module states its own narrow contract; the
 * service side reshapes into it (or this type is replaced by an import of the converged one) once
 * that lands, without this component's own render logic changing.
 */
export interface SeasonEndingStory {
  readonly season: number;
  readonly lastPlayedWeek: number;
  readonly firstMissedWeek: number;
  readonly reportStatus: string;
  readonly primaryInjury: string;
}

export interface StoryModuleProps {
  /** `null` — the board carries no season-ending absence for him (the common case: most players
   *  finish their own season) — renders nothing at all. The current injury designation lives in
   *  the peek header's own pill and is deliberately NOT repeated here. */
  readonly story: SeasonEndingStory | null;
}

/** Lowercases a phrase for mid-sentence use WITHOUT flattening an acronym — "Torn ACL" reads as
 *  "torn ACL", never "torn acl". A run of two or more capital letters is left alone. Every other
 *  word drops only its own first letter's case. */
function lowercaseSensibly(text: string): string {
  return text
    .split(" ")
    .map((word) => (/^[A-Z]{2,}$/.test(word) ? word : word.length === 0 ? word : word.charAt(0).toLowerCase() + word.slice(1)))
    .join(" ");
}

/**
 * THE STORY MODULE (dossier plan, Task 4) — the season-ending absence sentence, when the board
 * has one. Renders nothing at all otherwise. It used to also carry the current designation pill;
 * that duplicated the header's own pill and, with the story service not yet wired, produced a
 * card whose whole content was the word "Questionable".
 */
export function StoryModule({ story }: StoryModuleProps) {
  if (story === null) return null;
  return (
    <Card as="section" aria-label="Story" className="flex flex-col gap-2">
      <div className="flex flex-col gap-1" data-story="season-ending">
        <p className="text-sm text-text-primary">
          His {story.season} season ended after week {story.lastPlayedWeek}. The report said {lowercaseSensibly(story.primaryInjury)}.
        </p>
        <p className="text-xs text-text-faint">Source: official weekly injury reports.</p>
      </div>
    </Card>
  );
}
