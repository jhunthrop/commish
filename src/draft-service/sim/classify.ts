/**
 * THE BUILD CLASSIFIER — a pure, after-the-fact READING of a roster's own first six rounds, never
 * a strategy a sim is told to follow. Every simulated draft lets its bots (including the target
 * slot's own seat, which drafts under the identical `chooseBotPick` sampler as everyone else,
 * `run.ts`'s own docblock) pick whatever the room's board and need scoring produce; this function
 * only NAMES the shape that emerged, so "what wins from your slot" is a real distribution over
 * outcomes the sim did not steer toward any one label.
 *
 * FIVE INDEPENDENT LABELS (spec §5), not a mutually-exclusive partition: a single build can carry
 * more than one (a room that takes one RB in round 1 and no quarterback in six rounds is both
 * hero-RB and late-QB at once), so a caller aggregating "top-3 finish rate per build" sums each
 * label across every run it fired in rather than forcing one bucket per run. Definitions, exact:
 *
 *  - `hero-RB`: EXACTLY one running back drafted in rounds 1-3.
 *  - `zero-RB`: NO running back drafted in rounds 1-3.
 *  - `robust-RB`: TWO OR MORE running backs drafted in rounds 1-3.
 *  - `early-TE`: at least one tight end drafted in rounds 1-2.
 *  - `late-QB`: no quarterback drafted anywhere in the first six rounds.
 *
 * `hero-RB`/`zero-RB`/`robust-RB` ARE mutually exclusive with each other (they partition every
 * possible round-1-3 running back count into exactly one bucket), which is what lets a caller
 * read them as one three-way split when it wants to; `early-TE` and `late-QB` are independent
 * axes layered on top, matching the mock's own compound naming ("Hero-RB, TE early").
 */
import type { Position } from "@/domain/player";

export type BuildLabel = "hero-RB" | "zero-RB" | "robust-RB" | "early-TE" | "late-QB";

export const BUILD_LABELS: readonly BuildLabel[] = ["hero-RB", "zero-RB", "robust-RB", "early-TE", "late-QB"];

/** One drafted pick, as the classifier needs to see it — round-1-based, matching
 *  `CompletedPick.round` (`@/draft-engine`). */
export interface ClassifiablePick {
  readonly round: number;
  readonly position: Position;
}

/** How many of the first six rounds this function reads — named so a test can state it once
 *  rather than repeating the literal `6`. */
export const BUILD_CLASSIFICATION_ROUNDS = 6;

function countThroughRound(picks: readonly ClassifiablePick[], position: Position, throughRound: number): number {
  return picks.filter((pick) => pick.position === position && pick.round <= throughRound).length;
}

/**
 * Every label `picks`' own first six rounds earns, per the definitions above. `picks` may carry
 * rounds beyond six (a full roster's worth) or fewer than six (a sim run stopped early); only
 * rounds 1 through `BUILD_CLASSIFICATION_ROUNDS` are ever read.
 */
export function classifyBuild(picks: readonly ClassifiablePick[]): readonly BuildLabel[] {
  const rbRounds1to3 = countThroughRound(picks, "RB", 3);
  const teRounds1to2 = countThroughRound(picks, "TE", 2);
  const qbThroughSix = countThroughRound(picks, "QB", BUILD_CLASSIFICATION_ROUNDS);

  const labels: BuildLabel[] = [];
  if (rbRounds1to3 === 0) labels.push("zero-RB");
  else if (rbRounds1to3 === 1) labels.push("hero-RB");
  else labels.push("robust-RB");
  if (teRounds1to2 > 0) labels.push("early-TE");
  if (qbThroughSix === 0) labels.push("late-QB");
  return labels;
}
