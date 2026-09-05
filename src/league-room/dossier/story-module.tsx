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
   *  finish their own season) — renders no season-ending sentence at all. */
  readonly story: SeasonEndingStory | null;
  /** His CURRENT injury designation ("Q", "O", "IR"), the same feed `player-peek.tsx` already
   *  reads (`PlayerSeasonBody.injuryDesignation`) — a separate, present-tense fact from the
   *  season-ending story above, and rendered independently of it: a player can carry a current
   *  designation with no season-ending story (he is merely questionable this week) or a
   *  season-ending story from last year with no current designation (healthy now). `null` or
   *  omitted prints no pill. */
  readonly designation?: string | null;
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
 * has one, and the current injury designation pill, when the feed names one. Renders nothing at
 * all only when BOTH are absent; each half renders independently of the other otherwise, since a
 * current designation and a past season-ending story are different facts about different moments.
 */
export function StoryModule({ story, designation = null }: StoryModuleProps) {
  if (story === null && designation === null) return null;

  return (
    <Card as="section" aria-label="Story" className="flex flex-col gap-2">
      {designation === null ? null : (
        <span className="w-fit rounded-sm bg-negative px-1.5 py-0.5 font-mono text-sm font-semibold text-negative-text" data-story="designation">
          {designation}
        </span>
      )}
      {story === null ? null : (
        <div className="flex flex-col gap-1" data-story="season-ending">
          <p className="text-sm text-text-primary">
            His {story.season} season ended after week {story.lastPlayedWeek}. The report said {lowercaseSensibly(story.primaryInjury)}.
          </p>
          <p className="text-xs text-text-faint">Source: official weekly injury reports.</p>
        </div>
      )}
    </Card>
  );
}
