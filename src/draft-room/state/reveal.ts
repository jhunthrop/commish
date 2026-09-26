import type { CompletedPick, DraftClockView, DraftStateView } from "@/draft-engine";
import type { DraftEventFrame } from "./payloads";

/**
 * THE REVEAL (the batched bots round, 2026-09-25). A mock's bot picks are committed in one batch
 * behind the human action before them, each stamped at its own reveal instant: the previous
 * action's stamp plus that pick's seeded think-delay. The log is decided at the commit; only the
 * reveal is time-shaped, and the reveal is the client's. The room folds every frame into the
 * COMMITTED view the moment it arrives (that view is what the wire's sequence continuity and the
 * advisor's fetch key on), and folds the same frames into the REVEALED view — what every surface
 * renders — one at a time, each at its pick's own stamp, through the identical fold
 * (`applyDraftFrame`), so a tile settles, a sheet row strikes, a pool row leaves and a stream
 * line appears exactly as they always did for a pick that arrived alone.
 *
 * This module is the pure half: which picks of a view are still unrevealed at an instant, what
 * the view looks like with them hidden, and the frames that reveal them one by one (a viewer who
 * joins or reconnects mid-batch gets the room's snapshot, and derives the same reveals from the
 * picks' stamps that a viewer who was there derived from the frames). Every instant here is the
 * SERVER's clock: the caller converts with the offset it measured off the stream's own stamps.
 */

export interface RevealPlan {
  /** The view with every unrevealed pick hidden: the player still on the board, the bot on the clock. */
  readonly revealed: DraftStateView;
  /** One frame per hidden pick, in pick order, each to be folded into `revealed` at its stamp. */
  readonly pending: readonly DraftEventFrame[];
}

/** A pick's reveal instant on the server's clock: its own stamp. */
export function revealAtMs(pick: Pick<CompletedPick, "timestamp">): number {
  return Date.parse(pick.timestamp);
}

/** The reveal instant a frame carries: a pick's stamp; every other frame is revealed at once. */
export function frameRevealAtMs(frame: DraftEventFrame): number | null {
  return frame.type === "draft.pick" ? revealAtMs(frame.payload) : null;
}

/**
 * The unrevealed suffix of a view's picks at `serverNowMs`: from the first pick stamped past the
 * instant onward. A suffix, never a scattered set, so the board can never show a later pick before
 * an earlier one; a human's own pick is stamped at its commit and is never in it.
 */
export function hiddenPicksAt(view: DraftStateView, serverNowMs: number): readonly CompletedPick[] {
  const first = view.picks.findIndex((pick) => revealAtMs(pick) > serverNowMs);
  return first === -1 ? [] : view.picks.slice(first);
}

function withoutPicks(rosters: DraftStateView["rosters"], hidden: readonly CompletedPick[]): DraftStateView["rosters"] {
  const hiddenIds = new Set(hidden.map((pick) => pick.playerId));
  return Object.fromEntries(Object.entries(rosters).map(([teamId, slots]) => [teamId, slots.filter((slot) => slot.playerId === null || !hiddenIds.has(slot.playerId))]));
}

/** The clock the room stood at right after `hidden[index]` landed, as the frame for it carries. */
function clockAfter(view: DraftStateView, hidden: readonly CompletedPick[], index: number): DraftClockView {
  const landed = hidden[index]!;
  const next = hidden[index + 1];
  if (next === undefined) {
    return {
      phase: view.phase,
      sequence: view.sequence,
      pickNumber: view.pickNumber,
      onClockTeamId: view.onClockTeamId,
      deadlineAt: view.deadlineAt,
      clockSeconds: view.clockSeconds,
      nextTightening: view.nextTightening,
      upcoming: view.upcoming,
      pausedUntil: view.pausedUntil ?? null,
      owedPicks: view.owedPicks ?? {},
    };
  }
  return {
    phase: "in_progress",
    sequence: view.sequence - (hidden.length - 1 - index),
    pickNumber: next.pickNumber,
    onClockTeamId: next.teamId,
    deadlineAt: deadlineFrom(landed.timestamp, view.clockSeconds),
    clockSeconds: view.clockSeconds,
    nextTightening: view.nextTightening,
    upcoming: upcomingFrom(hidden.slice(index + 1), view.upcoming),
    pausedUntil: null,
    owedPicks: view.owedPicks ?? {},
  };
}

function deadlineFrom(startedAt: string, clockSeconds: number | null): string | null {
  return clockSeconds === null ? null : new Date(Date.parse(startedAt) + clockSeconds * 1000).toISOString();
}

/** The hidden seats ahead, then the view's own upcoming, at the view's own depth. */
function upcomingFrom(ahead: readonly CompletedPick[], upcoming: readonly string[]): readonly string[] {
  return [...ahead.map((pick) => pick.teamId), ...upcoming].slice(0, Math.max(upcoming.length, ahead.length));
}

function frameFor(view: DraftStateView, hidden: readonly CompletedPick[], index: number): DraftEventFrame {
  const pick = hidden[index]!;
  return {
    type: "draft.pick",
    payload: {
      draftId: view.draftId,
      clock: clockAfter(view, hidden, index),
      pickNumber: pick.pickNumber,
      round: pick.round,
      teamId: pick.teamId,
      playerId: pick.playerId,
      slot: pick.slot,
      slotIndex: pick.slotIndex,
      price: pick.price,
      timestamp: pick.timestamp,
      auto: pick.auto,
    },
  };
}

/**
 * The view at `serverNowMs`: every pick stamped past the instant hidden (its player back on the
 * board at the board's end, its roster slot empty, the first hidden seat on the clock with the
 * clock that seat's turn actually runs), and the frames that reveal them in order. A view with
 * nothing hidden is returned as it is.
 */
export function planReveal(view: DraftStateView, serverNowMs: number): RevealPlan {
  const hidden = hiddenPicksAt(view, serverNowMs);
  if (hidden.length === 0) return { revealed: view, pending: [] };
  const shown = view.picks.slice(0, view.picks.length - hidden.length);
  const lastShown = shown[shown.length - 1];
  const first = hidden[0]!;
  const revealed: DraftStateView = {
    ...view,
    phase: "in_progress",
    sequence: view.sequence - hidden.length,
    pickNumber: first.pickNumber,
    onClockTeamId: first.teamId,
    deadlineAt: lastShown === undefined ? null : deadlineFrom(lastShown.timestamp, view.clockSeconds),
    upcoming: upcomingFrom(hidden, view.upcoming),
    pausedUntil: null,
    picks: shown,
    rosters: withoutPicks(view.rosters, hidden),
    availablePlayerIds: [...view.availablePlayerIds, ...hidden.map((pick) => pick.playerId)],
  };
  return { revealed, pending: hidden.map((_, index) => frameFor(view, hidden, index)) };
}
