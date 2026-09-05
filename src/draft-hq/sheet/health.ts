/**
 * SHEET HEALTH (spec §4) — the deferral `insights-rail.tsx`'s own docblock named: "positional
 * balance vs. the winning sim shapes" and "a NEVER-DRAFT that would have been the clear value."
 * Both needed the Simulator to exist first (Task 1-4); this is that unblocking, computed from the
 * caller's own real sheet and a real canonical sim (`@/draft-hq/playbook/service.ts`'s
 * `canonicalSimFor`), never from a population of one or an invented shape.
 *
 * THE SHEET'S OWN ORDER BECOMES A HYPOTHETICAL DRAFT: entry rank 1 stands in for "your first
 * pick," rank 2 for "your second," and so on — the exact reading `classifyBuild` needs, and the
 * identical classifier the sim itself uses to label its own runs, so a sheet's own shape and a
 * sim's own shape are named by the same rule.
 */
import type { Position } from "@/domain/player";
import { BUILD_CLASSIFICATION_ROUNDS, classifyBuild, type BuildLabel, type ClassifiablePick } from "@/draft-service/sim/classify";
import type { SimSummary } from "@/draft-service/sim/types";
import { describeBuild } from "@/draft-hq/playbook/service";

export interface SheetHealthEntry {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly tag: "target" | "avoid" | "never" | null;
  /** The evidence board's own overall rank, or null when he is not on it. */
  readonly boardRank: number | null;
}

export interface SheetBuildComparison {
  readonly label: BuildLabel;
  readonly top3FinishRate: number;
  readonly baselineTop3Rate: number;
  readonly sentence: string;
}

export interface NeverDraftFlag {
  readonly playerId: string;
  readonly name: string;
  readonly boardRank: number;
}

export interface SheetHealthReport {
  /** Every label the sheet's own first six entries earn (`classifyBuild`) — zero or more, never
   *  forced into one bucket (the classifier's own docblock). */
  readonly buildLabels: readonly BuildLabel[];
  /** The canonical sim's own numbers for each of those labels — empty when the sim never fired
   *  any of them across its runs. */
  readonly comparisons: readonly SheetBuildComparison[];
  /** Every NEVER-tagged entry the evidence board ranks inside a realistic early range at this
   *  slot — honesty cuts both ways: marking a real value pick "never draft" costs something, and
   *  this says so by name. */
  readonly neverDraftFlags: readonly NeverDraftFlag[];
}

export function sheetHealth(entries: readonly SheetHealthEntry[], sim: SimSummary, teamCount: number): SheetHealthReport {
  const picks: ClassifiablePick[] = entries.slice(0, BUILD_CLASSIFICATION_ROUNDS).map((entry, index) => ({ round: index + 1, position: entry.position }));
  const buildLabels = classifyBuild(picks);

  const comparisons: readonly SheetBuildComparison[] = sim.builds
    .filter((build) => buildLabels.includes(build.label))
    .map((build) => ({
      label: build.label,
      top3FinishRate: build.top3FinishRate,
      baselineTop3Rate: sim.baselineTop3Rate,
      sentence: describeBuild(build, sim.runs, sim.baselineTop3Rate),
    }));

  // "A realistic early range at this slot": the picks a manager at this slot would actually reach
  // through the same six rounds the build classifier itself reads — teamCount players per round,
  // the honest analogue of "still on the board when it would have been your turn."
  const earlyRangeRank = teamCount * BUILD_CLASSIFICATION_ROUNDS;
  const neverDraftFlags: readonly NeverDraftFlag[] = entries
    .filter((entry): entry is SheetHealthEntry & { readonly boardRank: number } => entry.tag === "never" && entry.boardRank !== null && entry.boardRank <= earlyRangeRank)
    .map((entry) => ({ playerId: entry.playerId, name: entry.name, boardRank: entry.boardRank }));

  return { buildLabels, comparisons, neverDraftFlags };
}
