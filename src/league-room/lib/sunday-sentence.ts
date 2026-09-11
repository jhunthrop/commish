import { formatPoints } from "./format";

export interface SundayInput {
  /** The reader's own team total so far. `null` means nothing has been scored in this week yet. */
  readonly myScore: number | null;
  readonly theirScore: number | null;
  /** Starters on each side whose games have not finished. */
  readonly myRemaining: number;
  readonly theirRemaining: number;
  /** The opponent, as a person. Never a team name (P1). */
  readonly theirManager: string;
  /** The surname of the reader's highest-projected starter who has not played, or `null` when
   *  nobody is left or no projection names one. */
  readonly myBestLeftName: string | null;
}

/** A player's surname, which is how anybody in a group chat says his name once the room knows who
 *  he is. "Skattebo", not "Cam Skattebo". */
export function lastName(name: string): string {
  const parts = name.trim().split(" ");
  return parts[parts.length - 1] ?? name;
}

/**
 * THE ONE SENTENCE SUNDAY HAS COME DOWN TO — Under the Lights' lower third, borrowed for Sunday
 * only (section 5 of `docs/design/2026-09-10-first-principles.md`).
 *
 * **IT ONLY CLAIMS A CATCH WHEN A CATCH IS ARITHMETIC** (whole-branch review, H3). *"You need 11.4
 * from Cook to catch Rachel"* is true if and only if Rachel is DONE. With four of her starters
 * still to play, 11.4 catches nobody: the gap will have moved by the time Cook finishes. The gap
 * itself was always honest board arithmetic; the claim attached to it was not. So the catching
 * sentence is gated on `theirRemaining === 0`, and every other state states the gap and the
 * remaining count with no claim of sufficiency at all.
 *
 * **AND IT NEVER SAYS "needs 0.00"** (H2). A level matchup used to fall through the `margin >= 0`
 * branch and print *"Rachel needs 0.00 from Skattebo to catch you"*, which is three wrong things in
 * one line. Level is now its own branch, and level with nobody left is `null` — there is nothing
 * to say about a tie that has finished except that it happened, and the score bug above already
 * says it.
 *
 * `null` is a real answer everywhere it appears: a week with no scores, a decided fixture, a tie
 * that is over. The lower third then carries its facts and its verb and no sentence, which is what
 * it is on every screen that is not Sunday.
 */
export function sundaySentence(input: SundayInput): string | null {
  const { myScore, theirScore, myRemaining, theirRemaining, theirManager, myBestLeftName } = input;
  if (myScore === null || theirScore === null) return null;
  const margin = myScore - theirScore;
  const gap = formatPoints(Math.abs(margin));

  if (margin < 0) {
    // BEHIND. Only when the opponent is finished is the gap a target a single player can clear.
    if (theirRemaining === 0) {
      if (myBestLeftName === null) return null; // nobody left on either side: the week is decided.
      return `You need ${gap} from ${lastName(myBestLeftName)} to catch ${theirManager}.`;
    }
    return `${theirManager} leads by ${gap}, with ${theirRemaining} of theirs still to play.`;
  }

  if (margin > 0) {
    // AHEAD. The count that matters is whichever side still has somebody on the field.
    if (myRemaining > 0) return `You lead by ${gap}, with ${myRemaining} of yours still to play.`;
    if (theirRemaining > 0) return `You lead by ${gap}, with ${theirRemaining} of theirs still to play.`;
    return null;
  }

  // LEVEL.
  if (myRemaining === 0 && theirRemaining === 0) return null;
  return `Level with ${theirManager}, ${myRemaining} of yours and ${theirRemaining} of theirs still to play.`;
}
