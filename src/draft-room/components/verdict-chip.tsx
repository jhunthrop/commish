import { Stat, type StatSize } from "@/components/ui";
import type { Verdict } from "../lib/verdict";

export interface VerdictChipProps {
  /** The judgement, from `verdictFor`/`verdictForPick` (`../lib/verdict`). Null renders
   *  nothing — a pick whose player is not in the snapshotted pool has no honest verdict. */
  readonly verdict: Verdict | null;
  /** @default "sm" */
  readonly size?: StatSize;
}

/**
 * "+11 steal". "-12 reach". The fun pass's single highest-value change, rendered
 * (`docs/design/2026-08-27-fun-pass-spec.md`): *"the difference between a room that records what
 * you did and a room that tells you whether it was any good."*
 *
 * A `Stat` in the inline orientation and nothing else. That is not a thin wrapper for its own
 * sake — it is the ONE decision this chip makes, made once for the three surfaces that render it
 * (the pool, the pick wire, the results debrief) rather than three times. `Stat` is also the only
 * file in the product allowed to name a magnitude colour, so the heat has to arrive this way; the
 * chip's job is to carry the verdict's own word as the label and its slip as the number, and to
 * know when to say nothing.
 *
 * **An `even` verdict renders nothing at all,** and that is the same rule as `neutral` being
 * `textPrimary`: a verdict is worth a chip when there is one, and "you took him about where he
 * was ranked" is the absence of one. Printing "0 even" down sixty pool rows would make the screen
 * louder without making a true thing more legible, which is the test the spec closes with and the
 * one rule 6 rejects a change for failing.
 */
export function VerdictChip({ verdict, size = "sm" }: VerdictChipProps) {
  if (verdict === null || verdict.kind === "even") return null;
  return <Stat label={verdict.kind} value={verdict.value} comparison={verdict.comparison} size={size} orientation="inline" />;
}
