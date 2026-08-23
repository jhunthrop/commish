import type { Tightening } from "@/draft-engine";
import type { RosterSlotConfig } from "@/domain/roster";
import { UI_CONFIG } from "@/components/ui/config";
import { MINUTES_PER_HOUR, MS_PER_SECOND, formatClockLength, plural } from "@/domain/duration";

export { formatClockLength };

const MS_PER_MINUTE = 60_000;

/** A coarse distance: "2h 14m", "14m", "under a minute". */
export function formatGap(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / MS_PER_MINUTE);
  if (totalMinutes < 1) return "under a minute";
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * "Picks shorten to 10 minutes in 2h 14m" — the auto-tightening clock made visible, which is
 * the only thing that turns it from an engine feature into a product feature. `nowMs` is
 * supplied by the caller (from `useNow`), never read here.
 *
 * `pausedUntil` is `DraftClockView.pausedUntil` (Task 4's overnight freeze) — when the room is
 * currently paused and the schedule's own tightening threshold would otherwise fall before the
 * freeze lifts, the gap shown is to the RESUME instant instead. This engine cannot import
 * `@/draft-engine`'s own `deadlineAfter` to compute that properly (client room code goes
 * through the HTTP/SSE boundary only — `eslint.config.mjs`'s `SERVER_ONLY_MODULE_GROUPS`), so
 * this is deliberately the coarser fix available from data the room already has on `view`
 * rather than an un-routable import: an ETA landing IN the freeze is corrected to the instant
 * right after it, not silently left to undercount a six-hour freeze.
 */
export function formatTightening(next: Tightening | null, nowMs: number, pausedUntil: string | null = null): string | null {
  if (next === null) return null;
  const at = pausedUntil !== null && Date.parse(next.at) < Date.parse(pausedUntil) ? pausedUntil : next.at;
  return `Picks shorten to ${formatClockLength(next.pickSeconds)} in ${formatGap(Date.parse(at) - nowMs)}`;
}

/**
 * "Picks are paused until 5:00 AM Eastern. You can still make yours." — Task 4's overnight
 * freeze, worded so nobody reads a frozen countdown as a stalled connection. `resumeAt` is
 * `DraftClockView.pausedUntil`; this only FORMATS it, it never decides whether the room is
 * paused (that live check is `RoomRail`'s own `now < Date.parse(pausedUntil)`, since a payload's
 * `pausedUntil` is only ever fresh as of the event that carried it, and the room keeps ticking
 * after that).
 */
export function formatPausedUntil(resumeAt: string): string {
  const clock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true }).format(
    new Date(resumeAt),
  );
  return `Picks are paused until ${clock} Eastern. You can still make yours.`;
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
 * `@/components/ui/countdown`'s own `formatCoarseRemaining` uses, from the SAME
 * `UI_CONFIG.countdown.coarseRemainingMinuteMs` rather than a second literal, so the two
 * "under a minute"/"any moment" cutoffs can never drift apart.
 *
 * `pausedUntil` is `DraftClockView.pausedUntil` (Task 4's overnight freeze). The flat
 * `picksAway * clockSeconds` estimate below already assumes every intervening turn runs its
 * full, un-paused length — an assumption a six-hour freeze breaks outright, and an ETA that
 * ignores it is worse than no ETA at all. Rather than projecting through the freeze (this room
 * cannot value-import `@/draft-engine`'s own `deadlineAfter` — see `formatTightening`'s
 * docblock for the same boundary), a currently-paused room gets the honest, qualitative answer
 * instead of a wrong number.
 */
export function formatYourTurn(
  upcoming: readonly string[],
  myTeamId: string | null,
  clockSeconds: number | null,
  pausedUntil: string | null = null,
): string | null {
  if (myTeamId === null) return null;
  const picksAway = upcoming.indexOf(myTeamId);
  if (picksAway < 0) return null;
  if (picksAway === 0) return "You're on the clock.";
  const picks = plural(picksAway, "pick");
  if (clockSeconds === null) return `You're up in ${picks}.`;
  if (pausedUntil !== null) return `You're up in ${picks}, once picks resume.`;
  const waitMs = picksAway * clockSeconds * MS_PER_SECOND;
  const wait = waitMs < UI_CONFIG.countdown.coarseRemainingMinuteMs ? "any moment" : `~${formatGap(waitMs)}`;
  return `You're up in ${picks} (${wait}).`;
}
