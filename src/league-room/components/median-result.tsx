import type { MedianResult } from "@/league";
import { EYEBROW } from "@/components/ui";
import { formatPoints } from "../lib/format";

const VERB: Readonly<Record<MedianResult, string>> = { win: "won", loss: "lost", tie: "tied" };

export interface MedianResultLineProps {
  /** The team this sentence is about — used only when `isMine` is false, the same way
   *  `MatchupScoreboard`'s own "YOU" mark is the one place identity is compared at all. */
  readonly teamName: string;
  /** Whether this is the viewer's own team, exactly like `MatchupScoreboard`'s "YOU" mark
   *  (`teamId === myTeamId`). Second-person copy ("You scored...") only ever applies to the
   *  viewer's own side; every other team's sentence is written about them, in the third person. */
  readonly isMine: boolean;
  readonly score: number;
  readonly medianScore: number;
  readonly result: MedianResult;
}

/**
 * "You scored 118.40. The league median was 104.20, so you won that one too." — the second
 * result a median league adds to every week, said in the same sentence shape whichever way it
 * landed: a win, a loss, or a tie, against the SAME median score the head-to-head result never
 * touches. Null-rendered by the caller (`MatchupPanel`), never here: this component only ever
 * receives a real result, matching the same "the caller decides whether there's a story to
 * tell" idiom `MatchupCelebration` already uses for `won`.
 *
 * Numbers go through `formatPoints` (two decimal places, `toFixed(2)`) — the SAME formatting
 * every other score on this page already uses (`MatchupScoreboard`, the starters table), so a
 * reader never sees two different precisions for what is otherwise the same kind of number.
 *
 * Step 3: given its own shape, an inset block with a "Median" eyebrow, distinct from the
 * head-to-head scoreboard above it — the gauntlet's finding is that reusing one block for both
 * results reads as a team named LEAGUE MEDIAN. `bg-surface-inset` is the design system's own
 * "a track, a slot well" depth step (`docs/design-system.md`, "Color roles"), one step recessed
 * from the `Card` this renders inside, so the median result reads as a second, quieter fact
 * rather than a continuation of the same block.
 */
export function MedianResultLine({ teamName, isMine, score, medianScore, result }: MedianResultLineProps) {
  const subject = isMine ? "You" : teamName;
  const subjectLower = isMine ? "you" : "they";
  return (
    <div className="rounded-md bg-surface-inset px-2 py-1.5">
      <p className={`${EYEBROW} text-text-faint`}>Median</p>
      <p className="text-sm text-text-muted">
        {`${subject} scored ${formatPoints(score)}. The league median was ${formatPoints(medianScore)}, so ${subjectLower} ${VERB[result]} that one too.`}
      </p>
    </div>
  );
}
