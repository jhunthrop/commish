import type { Tightening } from "@/draft-engine";
import type { RosterSlotConfig } from "@/domain/roster";
import { MS_PER_SECOND, MINUTES_PER_HOUR, SECONDS_PER_HOUR, SECONDS_PER_MINUTE, formatClockLength, plural } from "@/domain/duration";
import { DRAFT_ROOM_CONFIG } from "./config";

export { formatClockLength };

const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;
const MS_PER_HOUR = MS_PER_MINUTE * MINUTES_PER_HOUR;

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/** "0:09", "2:05", "1:04:09". Clamped at zero — a passed deadline reads 0:00, never negative. */
export function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.ceil(msRemaining / MS_PER_SECOND));
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = total % SECONDS_PER_MINUTE;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** A coarse distance: "2h 14m", "14m", "under a minute". */
export function formatGap(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / MS_PER_MINUTE);
  if (totalMinutes < 1) return "under a minute";
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * A coarse, rarely-changing summary of time remaining — "About 8 hours left", "About 2 minutes
 * left", "Under a minute left" — for a screen-reader `aria-live` region paired with
 * `Countdown`'s (`aria-hidden`) ticking digits. Rounds to the nearest whole minute or hour, so
 * it updates on a boundary crossing rather than every second; the boundaries themselves are
 * `DRAFT_ROOM_CONFIG.coarseRemainingMinuteMs` / `coarseRemainingHourMs`, not inline literals.
 */
export function formatCoarseRemaining(msRemaining: number): string {
  const remaining = Math.max(0, msRemaining);
  if (remaining < DRAFT_ROOM_CONFIG.coarseRemainingMinuteMs) return "Under a minute left";
  if (remaining < DRAFT_ROOM_CONFIG.coarseRemainingHourMs) return `About ${plural(Math.round(remaining / MS_PER_MINUTE), "minute")} left`;
  return `About ${plural(Math.round(remaining / MS_PER_HOUR), "hour")} left`;
}

/**
 * "Picks shorten to 10 minutes in 2h 14m" — the auto-tightening clock made visible, which is
 * the only thing that turns it from an engine feature into a product feature. `nowMs` is
 * supplied by the caller (from `useNow`), never read here.
 */
export function formatTightening(next: Tightening | null, nowMs: number): string | null {
  if (next === null) return null;
  return `Picks shorten to ${formatClockLength(next.pickSeconds)} in ${formatGap(Date.parse(next.at) - nowMs)}`;
}

/**
 * How many roster spots the league declares. Config arithmetic, not a draft rule — which is
 * why it lives here rather than being value-imported from `@/draft-engine` (the room imports
 * types from the engine and nothing else, so no rule can leak into React). The test above
 * asserts it agrees with the engine's `totalRosterSlots`, so the two cannot silently diverge.
 */
export function rosterSpots(slotConfig: readonly RosterSlotConfig[]): number {
  return slotConfig.reduce((sum, config) => sum + config.count, 0);
}

/**
 * The anxiety-killer: "You're up in 7 picks (~24m)." — the dock's standing answer to "when am
 * I up?", with no turn-order rule anywhere near it. `upcoming` is the engine's own lookahead
 * (`DraftClockView.upcoming`, computed by `upcomingOnClock` and carried on every event's
 * clock), so this is an index lookup plus display arithmetic over two server values.
 *
 * Null when there is nothing to say: a spectator with no team, or a team the lookahead does
 * not reach (a long rotation, or a draft that isn't running). A sub-minute wait reads "any
 * moment" rather than a duration rounded away to nothing — against the same one-minute floor
 * `formatCoarseRemaining` uses, from the same config value rather than a second literal.
 */
export function formatYourTurn(upcoming: readonly string[], myTeamId: string | null, clockSeconds: number | null): string | null {
  if (myTeamId === null) return null;
  const picksAway = upcoming.indexOf(myTeamId);
  if (picksAway < 0) return null;
  if (picksAway === 0) return "You're on the clock.";
  const picks = plural(picksAway, "pick");
  if (clockSeconds === null) return `You're up in ${picks}.`;
  const waitMs = picksAway * clockSeconds * MS_PER_SECOND;
  const wait = waitMs < DRAFT_ROOM_CONFIG.coarseRemainingMinuteMs ? "any moment" : `~${formatGap(waitMs)}`;
  return `You're up in ${picks} (${wait}).`;
}
