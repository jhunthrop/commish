import type { Tightening } from "@/draft-engine";
import type { Position } from "@/domain/player";
import type { RosterSlotConfig } from "@/domain/roster";
import { UI_CONFIG } from "@/components/ui/config";
import { MINUTES_PER_HOUR, MS_PER_SECOND, formatClockLength, plural } from "@/domain/duration";
import { formatOrdinal } from "@/domain/format";
import type { PickReview } from "./pick-review";

export { formatClockLength };
// Wave-1 review Q9: `formatOrdinal` moved to `@/domain/format` — a shared home both this room
// and `@/admin-room` may legally import — re-exported here so this module's own existing
// consumers (`@/league-room/components/mock-setup-form`, this file's own test) need no import
// path change.
export { formatOrdinal };

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
 * Fills `{token}` placeholders in a `MOCK_COPY` template with the given values — the one
 * mechanism every pick-fact sentence below uses, rather than each caller hand-rolling its own
 * template literal (which is exactly how a bare, ungated sentence like the old `formatBoardDelta`
 * happened, per the mock-results review's E6). A plain string split/join rather than a regex:
 * the token set is small and fixed per template, so no template can accidentally match part of
 * another token.
 */
function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return Object.entries(values).reduce((text, [token, value]) => text.split(`{${token}}`).join(value), template);
}

/**
 * `MockResults`' own pick-fact sentence, in four parts a caller assembles with
 * `formatPickFact` below. Every template is `@/mock-draft`'s own `MOCK_COPY` text, threaded to
 * this client module as data (never a value import — the client boundary,
 * `eslint.config.mjs`'s `SERVER_ONLY_MODULE_GROUPS`) the same way every other mock-room sentence
 * reaches it (`MockRoomInfo`'s own docblock, `../contract`).
 */
export interface PickFactCopy {
  /** `"You took {name} at pick {pickNumber}."` */
  readonly took: string;
  /** `bestAvailableDelta === 0`: the board's own top player, taken at the turn. No placeholder. */
  readonly bestAvailable: string;
  /** `bestAvailableDelta > 0` but `positionBestDelta === 0`: the board's own top player AT THIS
   *  POSITION, taken with skill players still on the board (the round-15-kicker case D3 exists
   *  for). Takes `{position}`. */
  readonly positionBestAvailable: string;
  /** Otherwise: a genuine reach, at this player's own position too. Takes `{count}`. */
  readonly rankedHigherAvailable: string;
  /** Always appended: the player's own position rank on the whole board. Takes `{position}` and
   *  `{rank}`. */
  readonly positionRank: string;
}

/**
 * `MockResults`' own honest line (Task 8, ruling 5: no letter grade; the mock-results review's
 * D3/R2, 2026-08-26: state the pick against the board's own best available AT THAT PICK, and
 * within position, rather than a raw un-normalized rank that implies a verdict it never earned).
 * `review` is a pure fact of this draft's own log (`reviewPicks`, `./pick-review`) — this
 * function only chooses which of the three honest sentences fits it and fills the templates,
 * never judges the pick itself.
 */
export function formatPickFact(copy: PickFactCopy, review: PickReview, playerName: string, position: Position): string {
  const took = fillTemplate(copy.took, { name: playerName, pickNumber: String(review.pickNumber) });
  return `${took} ${formatPickFactClause(copy, review, position)}`;
}

/** The fact WITHOUT the lead-in — the tabular results row (review E1) already states the pick
 *  number and the name in their own columns, so repeating them in prose would name every
 *  player twice, the exact defect the sentence form had. */
export function formatPickFactClause(copy: PickFactCopy, review: PickReview, position: Position): string {
  const delta =
    review.bestAvailableDelta === 0
      ? copy.bestAvailable
      : review.positionBestDelta === 0
        ? fillTemplate(copy.positionBestAvailable, { position })
        : fillTemplate(copy.rankedHigherAvailable, { count: String(review.bestAvailableDelta) });
  const positionRank = fillTemplate(copy.positionRank, { position, rank: String(review.positionRank) });
  return `${delta} ${positionRank}`;
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
 * per-pick estimate below already assumes every intervening turn runs its full, un-paused
 * length — an assumption a six-hour freeze breaks outright, and an ETA that ignores it is
 * worse than no ETA at all. Rather than projecting through the freeze (this room cannot
 * value-import `@/draft-engine`'s own `deadlineAfter` — see `formatTightening`'s docblock for
 * the same boundary), a currently-paused room gets the honest, qualitative answer instead of
 * a wrong number.
 *
 * `botSeats` (Task 10's persona checkpoint, finding 1): a practice opponent's turn never runs
 * the pick clock — the seeded delay lands it in seconds — so pricing every intervening turn
 * at `clockSeconds` overstated a mock's wait roughly tenfold. A bot seat is priced at
 * `pickSeconds` (the delay draw's expected value, `MockRoomInfo.expectedBotPickSeconds`,
 * carried on the wire by the snapshot route); a human seat still gets the full clock. Null —
 * every real league — keeps the flat estimate exactly as it was.
 */
export interface BotSeatPricing {
  readonly ids: ReadonlySet<string>;
  readonly pickSeconds: number;
}

/**
 * How many turns stand between now and yours: `0` while the clock is already yours, and null
 * when there is nothing to count — a spectator with no seat, or a seat the engine's own
 * lookahead (`DraftClockView.upcoming`) does not reach.
 *
 * The same index lookup `formatYourTurn` below states in a sentence, exported as a NUMBER for
 * the on-clock band (Task 6, the fun pass): the rail renders it at display scale, because "when
 * am I up?" is the one question a manager asks all draft long and a digit answers it at a glance
 * where a sentence has to be read. One derivation, two renderings — a component that counted
 * this for itself would be a second turn-order rule living in React, which is exactly what
 * `upcoming` rides the payload to prevent.
 */
export function picksUntilYours(upcoming: readonly string[], myTeamId: string | null): number | null {
  if (myTeamId === null) return null;
  const picksAway = upcoming.indexOf(myTeamId);
  return picksAway < 0 ? null : picksAway;
}

export function formatYourTurn(
  upcoming: readonly string[],
  myTeamId: string | null,
  clockSeconds: number | null,
  pausedUntil: string | null = null,
  botSeats: BotSeatPricing | null = null,
): string | null {
  const picksAway = picksUntilYours(upcoming, myTeamId);
  if (picksAway === null) return null;
  if (picksAway === 0) return "You're on the clock.";
  const picks = plural(picksAway, "pick");
  if (clockSeconds === null) return `You're up in ${picks}.`;
  if (pausedUntil !== null) return `You're up in ${picks}, once picks resume.`;
  const waitMs = upcoming
    .slice(0, picksAway)
    .reduce((total, teamId) => total + (botSeats !== null && botSeats.ids.has(teamId) ? botSeats.pickSeconds : clockSeconds) * MS_PER_SECOND, 0);
  const wait = waitMs < UI_CONFIG.countdown.coarseRemainingMinuteMs ? "any moment" : `~${formatGap(waitMs)}`;
  return `You're up in ${picks} (${wait}).`;
}
