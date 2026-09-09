import type { RosterStatus } from "../nflverse/rosters";
import type { CurrentRosterStatus, RosterStatusKind } from "./roster-status";

/**
 * WHAT THE AVAILABILITY MODEL READS OFF A RESOLVED STATUS (current-status round, 2026-09-09).
 *
 * THE DEFECT THIS CLOSES. The model's `status` input was `preseason_rosters.status`, the coarsened
 * cutdown file stamped the first of September, while the board's gate resolved a status four days
 * fresher from the Tank01 captures. Josh Jacobs was `reserve` in the file and on Green Bay's
 * active roster with an Out designation in the sweep, so the gate stamped nothing and the model
 * multiplied his season by 0.21: two sources, two answers, and the served number followed the
 * staler one. Both readers now take the ONE resolution (`current-status.ts`), and this module is
 * the only place its vocabulary becomes the model's.
 *
 * PURE, and deliberately small: two total functions over the status vocabulary, so the agreement
 * between the gate's treatment and the model's input is a property a test can assert over every
 * kind rather than a coincidence of two switch statements.
 */

/**
 * The finer cell a status can be fitted in, where the fit chooses to (`availability-fit.ts`'s
 * `designationCells`): the five reserve lists apart, injured reserve with a return designation
 * apart from the rest, and an Out designation on an active roster. A player with none of these
 * is on his coarse status alone.
 */
export const AVAILABILITY_DESIGNATIONS = ["out", "injured_reserve", "injured_reserve_return", "pup", "nfi", "suspended", "exempt"] as const;
export type AvailabilityDesignation = (typeof AVAILABILITY_DESIGNATIONS)[number];

const CUTDOWN_STATUS_OF: Readonly<Record<RosterStatusKind, RosterStatus>> = {
  active: "active",
  injured_reserve: "reserve",
  pup: "reserve",
  nfi: "reserve",
  suspended: "reserve",
  exempt: "reserve",
  practice_squad: "practice_squad",
  off_active_roster: "off_roster",
  no_roster: "off_roster",
  retired: "off_roster",
};

/** The resolved kind in the cutdown file's four-word vocabulary, which the fitted multipliers key on. */
export function cutdownStatusOf(kind: RosterStatusKind): RosterStatus {
  return CUTDOWN_STATUS_OF[kind];
}

/**
 * The model's status input: the resolution's word where a source named him, the cutdown file's
 * own status where none did. The fallback is the file the resolution's week-one tier is a finer
 * read of, so a man no dated source names keeps exactly the input he always had.
 */
export function availabilityStatusFor(resolved: CurrentRosterStatus | undefined, fileStatus: RosterStatus): RosterStatus {
  return resolved === undefined ? fileStatus : cutdownStatusOf(resolved.kind);
}

const DESIGNATION_OF_KIND: Readonly<Partial<Record<RosterStatusKind, AvailabilityDesignation>>> = {
  injured_reserve: "injured_reserve",
  pup: "pup",
  nfi: "nfi",
  suspended: "suspended",
  exempt: "exempt",
};

/** The designation cell a resolved status falls in, or `null` where it has none (an active man
 *  with no Out, an off-roster status, a man no source named). */
export function availabilityDesignationOf(resolved: CurrentRosterStatus | undefined): AvailabilityDesignation | null {
  if (resolved === undefined) return null;
  if (resolved.kind === "active") return resolved.detail === "out" ? "out" : null;
  if (resolved.kind === "injured_reserve" && resolved.detail === "designated_to_return") return "injured_reserve_return";
  return DESIGNATION_OF_KIND[resolved.kind] ?? null;
}
