import type { ExperienceTier } from "@/domain/user";
import type { HelpLevel } from "./preferences";

export type FirstRunPathKey = "create" | "join" | "browse";

export interface FirstRunPath {
  readonly key: FirstRunPathKey;
  readonly title: string;
  readonly detail: string;
  readonly cta: string;
}

export interface FirstRunPlan {
  readonly headline: string;
  readonly paths: readonly FirstRunPath[];
  readonly showsExplainer: boolean;
}

/**
 * Copy for the three paths, fixed regardless of ordering — `firstRunPlan` only ever reorders
 * this table, never rewrites it. Guidance is ordering, never removal: whichever manager reads
 * this, all three read the same plain, active-voice sentence for the same key.
 */
const PATH_COPY: Readonly<Record<FirstRunPathKey, FirstRunPath>> = {
  create: {
    key: "create",
    title: "Start a league",
    detail: "You pick the format, the scoring and who's in it.",
    cta: "Start a league",
  },
  join: {
    key: "join",
    title: "Join with an invite",
    detail: "Paste the link or code your commissioner sent you.",
    cta: "Use an invite",
  },
  browse: {
    key: "browse",
    title: "Find an open league",
    detail: "Browse leagues that still have seats and join one today.",
    cta: "Browse open leagues",
  },
};

/** Order for a manager who told us they're new: they're looking for a game, not standing up
 *  their own — browse and join lead, create trails. */
const BEGINNER_ORDER: readonly FirstRunPathKey[] = ["browse", "join", "create"];

/** Order for a manager who told us they've done this before and still has zero leagues on this
 *  product: that combination is almost always someone who came here to RUN one. */
const EXPERIENCED_ORDER: readonly FirstRunPathKey[] = ["create", "join", "browse"];

/**
 * The ONE rule behind every ordered rendering of create/join/browse, first-run or not:
 * `firstRunPlan` (below) uses it for a zero-leagues manager, and `StartOrJoinDisclosure`
 * (`@/league-room/components/start-or-join-disclosure.tsx`) reuses this exact function for a
 * returning manager's collapsed "start or join another league" — an experienced manager reaching
 * for that disclosure is usually reaching for Create, same as the fork itself says, so the two
 * surfaces order the same way rather than each encoding its own opinion.
 */
export function firstRunPathOrder(experienceTier: ExperienceTier): readonly FirstRunPathKey[] {
  return experienceTier === "experienced" ? EXPERIENCED_ORDER : BEGINNER_ORDER;
}

/**
 * The first-run fork: which of create/join/browse a brand-new manager sees first, and whether
 * the plain-language explainer runs above them. Pure and total over its whole input space —
 * `ExperienceTier` and `HelpLevel` are both two-value unions, so the two checks below already
 * cover every combination without a default branch to fall through.
 *
 * Returns `null` the moment the caller has a league (`leagueCount > 0`): the fork is a first-run
 * surface, not a nag, and it disappears entirely rather than staying around unwanted.
 */
export function firstRunPlan(input: {
  readonly experienceTier: ExperienceTier;
  readonly helpLevel: HelpLevel;
  readonly leagueCount: number;
}): FirstRunPlan | null {
  if (input.leagueCount > 0) return null;

  return {
    headline: "Pick how you want to get started.",
    paths: firstRunPathOrder(input.experienceTier).map((key) => PATH_COPY[key]),
    showsExplainer: input.helpLevel === "guided",
  };
}
