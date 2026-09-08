import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { QUILT_CONFIG } from "./config";

/**
 * THE QUILT'S OWN GEOMETRY — rounds by teams, every round always present, zero scroll (law 4:
 * the quilt self-compacts). Pure derivation over the view so the compaction rule is testable
 * without a DOM, and so lenses can recolor the same rows without anything moving.
 */

export type QuiltRowKind =
  /** A finished (or far-future) round: 14px micro color tiles. */
  | "micro"
  /** The round being drafted right now: full cells with names. */
  | "full"
  /** The round(s) just ahead: full-height empty tracks, so the eye sees what is coming. */
  | "track";

export interface QuiltCell {
  readonly teamId: string;
  readonly pick: CompletedPick | null;
  /** True on the one cell whose turn is running. */
  readonly onClock: boolean;
  /** "2.05" on the caller's own upcoming cell in a full/track round; null everywhere else. */
  readonly yourPickLabel: string | null;
}

export interface QuiltRow {
  readonly round: number;
  readonly kind: QuiltRowKind;
  readonly cells: readonly QuiltCell[];
}

/** "2.05" — the sport's own round.pick grammar, zero-padded like every mock prints it. One
 *  spelling for the whole product (`@/domain/pick-label`), re-exported under the name this
 *  module's callers already import. */
export { pickLabelOf as pickLabel } from "@/domain/pick-label";

/** The seat (1-based) a team picks at in a snake round. */
function snakeSeat(draftOrder: readonly string[], teamId: string, round: number): number | null {
  const index = draftOrder.indexOf(teamId);
  if (index === -1) return null;
  return round % 2 === 1 ? index + 1 : draftOrder.length - index;
}

/** The round each team fills next: picks it already owns, plus one. */
function nextRoundByTeam(picks: readonly CompletedPick[], draftOrder: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>(draftOrder.map((teamId) => [teamId, 0]));
  for (const pick of picks) counts.set(pick.teamId, (counts.get(pick.teamId) ?? 0) + 1);
  return new Map([...counts].map(([teamId, count]) => [teamId, count + 1]));
}

export function totalRounds(view: DraftStateView): number {
  return view.slotConfig.reduce((sum, config) => sum + config.count, 0);
}

/**
 * Every round of the quilt, compacted: the active round plus the prior
 * `QUILT_CONFIG.fullRoundsBehind` stay full (clamped at the draft's start), the next
 * `QUILT_CONFIG.fullRoundsAhead` rounds stay full-height empty tracks, and everything further
 * — older than the window, or past the tracks — compresses to micro rows. All rounds, always —
 * the zero-scroll law.
 */
export function buildQuiltRows(view: DraftStateView, myTeamId: string | null): readonly QuiltRow[] {
  const rounds = totalRounds(view);
  const nextRound = nextRoundByTeam(view.picks, view.draftOrder);
  const byCell = new Map(view.picks.map((pick) => [`${pick.teamId}:${pick.round}`, pick]));
  const activeRound = Math.max(
    1,
    ...view.picks.map((pick) => pick.round),
    ...(view.onClockTeamId !== null ? [nextRound.get(view.onClockTeamId) ?? 1] : []),
  );

  return Array.from({ length: rounds }, (_, index): QuiltRow => {
    const round = index + 1;
    const kind: QuiltRowKind =
      round <= activeRound && round >= activeRound - QUILT_CONFIG.fullRoundsBehind
        ? "full"
        : round > activeRound && round <= activeRound + QUILT_CONFIG.fullRoundsAhead
          ? "track"
          : "micro";
    const cells = view.draftOrder.map((teamId): QuiltCell => {
      const pick = byCell.get(`${teamId}:${round}`) ?? null;
      const onClock = teamId === view.onClockTeamId && (nextRound.get(teamId) ?? 1) === round;
      const mineUpcoming = pick === null && !onClock && teamId === myTeamId && round >= (nextRound.get(teamId) ?? 1);
      const seat = mineUpcoming ? snakeSeat(view.draftOrder, teamId, round) : null;
      return { teamId, pick, onClock, yourPickLabel: seat === null ? null : pickLabel(round, seat) };
    });
    return { round, kind, cells };
  });
}

/** A landed pick's place in the sport's grammar: global pick number → "2.05" for this room. */
export function pickPlace(pick: CompletedPick, teamCount: number): string {
  return pickLabel(pick.round, pick.pickNumber - (pick.round - 1) * teamCount);
}
