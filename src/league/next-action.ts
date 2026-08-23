import type { DraftStatus } from "@/domain/draft";
import type { WeekStatus } from "./week-status";

/**
 * Every next-action a cross-league home card can point a manager at, plus the null case: a
 * league with nothing to do right now. `"none"` is part of the union rather than a separate
 * `| null` on the input side so a switch/precedence ladder over it stays exhaustive and every
 * branch — including "nothing to do" — is a named, testable case in this gated directory.
 */
export type NextActionKind =
  | "join-draft" // the draft is live and you have a seat in it
  | "open-draft-room" // scheduled, not started
  | "invite-managers" // you are the commissioner and seats are empty
  | "set-lineup" // the week is still scheduled and you have a team
  | "watch-scores" // the week is in progress
  | "review-week" // the week is final
  | "none";

/** What a card renders for a real (non-`"none"`) action: a kind to link off of, and the exact,
 *  plain-language copy — no em-dashes, active voice — that goes on the button. */
export interface NextAction {
  readonly kind: Exclude<NextActionKind, "none">;
  readonly label: string;
}

/** Everything `nextAction` needs to know about one league to name its one next action. Every
 *  field is a fact `crossLeagueHome` already has in hand from its own reads — this function
 *  does no I/O of its own. */
export interface NextActionInput {
  readonly isCommissioner: boolean;
  readonly filledTeams: number;
  readonly teamCount: number;
  readonly myTeamId: string | null;
  readonly draftStatus: DraftStatus | null;
  readonly weekStatus: WeekStatus | null;
}

/** The one sentence-fragment for each next action, owned here and nowhere else (C2) — a caller
 *  that needs the exact button copy (`action`, below) or a shorter accessible-name fragment
 *  (`LeagueRail`'s per-league sentence, `@/components/app-shell/league-rail.tsx`) imports this
 *  rather than typing its own copy of the same words. */
export const COPY: Readonly<Record<Exclude<NextActionKind, "none">, string>> = {
  "join-draft": "Join the draft",
  "open-draft-room": "Open the draft room",
  "invite-managers": "Invite managers",
  "set-lineup": "Set your lineup",
  "watch-scores": "Watch the scores",
  "review-week": "See how the week went",
};

function action(kind: Exclude<NextActionKind, "none">): NextAction {
  return { kind, label: COPY[kind] };
}

/**
 * The one place a league's state becomes the single thing a manager should do about it. Pure
 * and total over every combination of the input's fields — a gated directory means every branch
 * below has a test of its own (`next-action.test.ts`), so the precedence ladder is written as a
 * short, ordered list of returns rather than a nested ternary a reviewer has to unwind.
 *
 * Precedence, read top to bottom:
 *   1. A live draft beats everything — nothing else matters while your league is on the clock.
 *   2. Next, an unfilled league still needs its commissioner to go recruit, whatever the draft
 *      or week are doing — a league that can't field two full sides can't play.
 *   3. Everything after that is the league's own phase: a draft that hasn't started yet, and
 *      then the current week's own three states (scheduled/in progress/final). A league with
 *      none of the above — no team, no current week, nothing pending — gets `null`: the card
 *      renders no action rather than a disabled one.
 */
export function nextAction(input: NextActionInput): NextAction | null {
  if (input.draftStatus === "in_progress" && input.myTeamId !== null) {
    return action("join-draft");
  }
  if (input.isCommissioner && input.filledTeams < input.teamCount) {
    return action("invite-managers");
  }
  if (input.draftStatus === "scheduled") {
    return action("open-draft-room");
  }
  if (input.myTeamId !== null && input.weekStatus === "scheduled") {
    return action("set-lineup");
  }
  if (input.weekStatus === "in_progress") {
    return action("watch-scores");
  }
  if (input.weekStatus === "final") {
    return action("review-week");
  }
  return null;
}
