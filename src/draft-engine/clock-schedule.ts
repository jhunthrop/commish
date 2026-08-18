import { MS_PER_SECOND } from "@/domain/duration";
import { DRAFT_CLOCK_SCHEDULE, type ClockTier } from "./config";

// Re-exported for the module's existing consumers (`selectors.ts` imports it from here) —
// `src/domain/duration.ts` is the one source of this constant now (controller ruling D-P1).
export { MS_PER_SECOND };

const MS_PER_HOUR = 60 * 60 * MS_PER_SECOND;

export interface Tightening {
  /** The instant the next, shorter tier takes effect. */
  readonly at: string;
  readonly pickSeconds: number;
}

function parseIso(value: string, label: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Expected an ISO timestamp for ${label}, got "${value}".`);
  return ms;
}

/**
 * Hours from `fromIso` until kickoff — negative once kickoff has passed. Parses supplied
 * timestamps only; it never reads the wall clock, which is why the engine stays pure.
 */
export function hoursUntil(fromIso: string, kickoffIso: string): number {
  return (parseIso(kickoffIso, "kickoff") - parseIso(fromIso, "the current time")) / MS_PER_HOUR;
}

/**
 * Index of the tier in force. Tiers are ordered farthest-out first and a tier applies while
 * the draft is strictly more than `untilHoursBeforeKickoff` hours from kickoff, so the last
 * tier is the floor that applies at and after kickoff.
 */
export function tierIndexFor(
  atIso: string,
  kickoffIso: string,
  schedule: readonly ClockTier[] = DRAFT_CLOCK_SCHEDULE,
): number {
  if (schedule.length === 0) throw new Error("The draft clock schedule must have at least one tier.");
  const hours = hoursUntil(atIso, kickoffIso);
  const index = schedule.findIndex((tier) => hours > tier.untilHoursBeforeKickoff);
  return index === -1 ? schedule.length - 1 : index;
}

export function clockTierFor(
  atIso: string,
  kickoffIso: string,
  schedule: readonly ClockTier[] = DRAFT_CLOCK_SCHEDULE,
): ClockTier {
  // `tierIndexFor` throws for an empty schedule and otherwise returns an index within
  // bounds, so this lookup can never miss.
  return schedule[tierIndexFor(atIso, kickoffIso, schedule)]!;
}

/**
 * When the clock next shortens, and to what — the data behind "picks shorten to 10 minutes
 * in 2h 14m". Null once the shortest tier is in force.
 */
export function nextTighteningAfter(
  atIso: string,
  kickoffIso: string,
  schedule: readonly ClockTier[] = DRAFT_CLOCK_SCHEDULE,
): Tightening | null {
  const index = tierIndexFor(atIso, kickoffIso, schedule);
  const next = schedule[index + 1];
  if (next === undefined) return null;
  // The current tier applies while the draft is more than its threshold from kickoff, so the
  // clock tightens the moment that threshold is reached — and it tightens to the NEXT tier's
  // pick clock. (8h picks run until 168h before kickoff, then become 4h picks.)
  const current = schedule[index]!;
  const at = new Date(parseIso(kickoffIso, "kickoff") - current.untilHoursBeforeKickoff * MS_PER_HOUR).toISOString();
  return { at, pickSeconds: next.pickSeconds };
}
