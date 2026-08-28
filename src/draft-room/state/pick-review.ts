import type { Player, Position } from "@/domain/player";
import type { CompletedPick } from "@/draft-engine";

/**
 * One pick's honest facts against the board it was drafted from — no judgment, no color, only
 * arithmetic over the pool order a draft actually started with and the picks that preceded it.
 * This is the derivation the mock-results design review (D3/R2, 2026-08-26) found the page's
 * raw, un-normalized board rank could never state honestly: a kicker taken in round 15 can
 * carry a huge raw rank (dominated by how many players are simply gone by then) while still
 * being the board's own best kicker still on the table — only "who was left" tells that story,
 * never "how many players exist".
 */
export interface PickReview {
  readonly pickNumber: number;
  readonly playerId: string;
  /** How many players ranked ABOVE the one taken (anywhere on the board, any position) were
   *  still available at this exact pick. 0 means this pick took the board's own best player
   *  still on it — the draft's best possible pick, stated as a fact rather than praise. */
  readonly bestAvailableDelta: number;
  /** The player's own 1-based rank within their own position, across the WHOLE board — fixed by
   *  the snapshot order alone, never by who is still available, so "K12" always means the
   *  twelfth-best kicker in the pool, not merely the twelfth kicker anyone happened to draft. */
  readonly positionRank: number;
  /** The same best-available idea, scoped to the player's own position: how many players at
   *  that position ranked above the one taken were still available at this pick. 0 means this
   *  pick took the board's own best player AT THAT POSITION still on the table — the fact a raw
   *  overall rank hides for every kicker, defense and other rarely-drafted position. */
  readonly positionBestDelta: number;
}

/**
 * Every pick the caller (`myTeamId`) made, in pick order, each carrying its own honest facts —
 * including an autopicked one, which is as much a fact of this draft's own log as a human one
 * (never filtered out here; "what happened" does not care who clicked).
 *
 * `players` must be the pool's own ranked snapshot order — `GET /api/drafts/[draftId]/players`'s
 * own docblock: "the same ranked order `START_DRAFT` snapshots" — and `picks` must be EVERY pick
 * of the draft (`view.picks`), not just the caller's: availability at a given pick depends on
 * what every seat, not just this one, has already taken off the board by then.
 *
 * O(picks × rank) in the worst case (a nested scan over players ranked above the one taken) —
 * fine at the sizes this product ever runs (at most a few hundred players, at most a few
 * hundred picks): no draft here is large enough for that to matter.
 */
/**
 * playerId → 1-based rank in the pool order the draft snapshotted, best first.
 *
 * THE BOARD-RANK COMPUTATION, named. It was already here, inline inside `reviewPicks` below, and
 * it is what every "on the board" fact this room states is derived from. The fun pass's verdict
 * chip (`../lib/verdict`) needs the same number and must not recompute it: two rankings of one
 * board is exactly how a room ends up telling a manager two different things about one pick.
 *
 * `players` must be the pool's own ranked snapshot order — `GET /api/drafts/[draftId]/players`'s
 * own docblock, "the same ranked order `START_DRAFT` snapshots" — so a rank is a fact of the
 * board this draft actually started from, never of a live ranking that has moved since.
 */
export function boardRanks(players: readonly Player[]): ReadonlyMap<string, number> {
  return new Map(players.map((player, index) => [player.id, index + 1]));
}

export function reviewPicks(players: readonly Player[], picks: readonly CompletedPick[], myTeamId: string): readonly PickReview[] {
  const positionRankById = new Map<string, number>();
  const positionRunningCount = new Map<Position, number>();
  for (const player of players) {
    const nextRank = (positionRunningCount.get(player.position) ?? 0) + 1;
    positionRunningCount.set(player.position, nextRank);
    positionRankById.set(player.id, nextRank);
  }

  const rankById = boardRanks(players);
  const playersById = new Map(players.map((player) => [player.id, player]));
  const available = new Set(players.map((player) => player.id));

  const reviews: PickReview[] = [];
  const orderedPicks = [...picks].sort((a, b) => a.pickNumber - b.pickNumber);
  for (const pick of orderedPicks) {
    const taken = playersById.get(pick.playerId);
    // Defensive, not an expected shape: every drafted player came FROM this same snapshotted
    // pool. A pick whose player somehow is not in it contributes no review record rather than
    // a fabricated one — the same "degrade to nothing rather than a lie" posture the surface
    // this replaces (`formatBoardDelta`) used to take for a missing rank.
    if (pick.teamId === myTeamId && taken !== undefined) {
      // `boardRanks` is 1-based, so the exclusive bound over the players ranked ABOVE this one is
      // `rank - 1` — the same scan, one subtraction, no second ranking of the same board.
      const rank = rankById.get(pick.playerId)!;
      let bestAvailableDelta = 0;
      let positionBestDelta = 0;
      for (let index = 0; index < rank - 1; index++) {
        const higher = players[index]!;
        if (!available.has(higher.id)) continue;
        bestAvailableDelta += 1;
        if (higher.position === taken.position) positionBestDelta += 1;
      }
      reviews.push({
        pickNumber: pick.pickNumber,
        playerId: pick.playerId,
        bestAvailableDelta,
        positionRank: positionRankById.get(pick.playerId)!,
        positionBestDelta,
      });
    }
    available.delete(pick.playerId);
  }
  return reviews;
}
