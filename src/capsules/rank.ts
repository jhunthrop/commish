/**
 * PEER RANKING, PURE (color v2, Task 1) — given one position's own pooled population for a single
 * headline quantity (last season's total points, touches, receiving yards, or one of the usage
 * shares), computes every member's finish, the honest qualifier count, and, for a top-three
 * finish, the name of the peer one rank better than him. `collect.ts`'s own last-season-story and
 * usage builders are the only callers; kept pure and in its own module so the ranking rule itself
 * is unit-tested without a database in the loop.
 *
 * THE QUALIFIER, DOCUMENTED HONESTLY: `qualifierCount` is simply the SIZE of `entries` — the same
 * population `positionRank` is drawn from, never a narrower or wider one invented for the
 * occasion. Each caller documents its own bar for entering that population (a played week, for a
 * season-total quantity; a real, non-null reading of the same share, for a usage share) so "among
 * N backs" always names the real N behind the sentence.
 *
 * TIES: `positionRank` is "one plus the count of strictly-greater peers" — two players tied at the
 * top both read as rank 1, and the next distinct value is rank 3, never rank 2. A true tie has no
 * honest "who's ahead" answer, and skipping the number rather than inventing a tiebreaker is the
 * same convention a golf or racing leaderboard already uses.
 */
export interface RankableStat {
  readonly playerId: string;
  readonly name: string;
  readonly value: number;
}

export interface RankedStat {
  readonly value: number;
  readonly positionRank: number;
  readonly qualifierCount: number;
  /** The name of the peer one rank better than him — present (non-null) only at rank 2 or rank 3.
   *  `null` at rank 1 (he led the population himself; there is no name above him to give) and at
   *  rank 4 or worse (not a top-three finish, so no neighbor is cited at all). `positionRank`
   *  itself is what tells the two `null` cases apart. */
  readonly namedNeighbor: string | null;
}

/** Ranks every entry in `entries` against the rest of that SAME array — the whole population, so
 *  a caller must already have narrowed `entries` to one position (and, for a share, to peers with
 *  a real reading of it) before calling this. Sorted by value descending, then by `playerId`
 *  ascending as a deterministic tiebreaker, so two calls given the identical population always
 *  agree on which peer within a tied group "counts" as the named neighbor for the rank just
 *  above it. */
/** Ranks each group in `groups` independently (a group per position, in every caller today) and
 *  merges the results into one flat map — the "rank within your own position, not the whole
 *  league" shape every headline quantity in this product needs. A pure convenience over calling
 *  `rankPeers` once per group and merging by hand. */
export function rankWithinGroups<TKey>(groups: ReadonlyMap<TKey, readonly RankableStat[]>): ReadonlyMap<string, RankedStat> {
  const out = new Map<string, RankedStat>();
  for (const entries of groups.values()) {
    for (const [playerId, rank] of rankPeers(entries)) out.set(playerId, rank);
  }
  return out;
}

export function rankPeers(entries: readonly RankableStat[]): ReadonlyMap<string, RankedStat> {
  const qualifierCount = entries.length;
  const sorted = [...entries].sort((a, b) => b.value - a.value || a.playerId.localeCompare(b.playerId));

  // One pass in sorted (so rank-ascending) order: the first entry ever seen at a given rank is
  // the name later ranks can cite as "the peer one rank better than him".
  const nameAtRank = new Map<number, string>();
  const withRank = sorted.map((entry) => {
    const positionRank = 1 + entries.filter((peer) => peer.value > entry.value).length;
    if (!nameAtRank.has(positionRank)) nameAtRank.set(positionRank, entry.name);
    return { entry, positionRank };
  });

  const out = new Map<string, RankedStat>();
  for (const { entry, positionRank } of withRank) {
    const namedNeighbor = positionRank > 1 && positionRank <= 3 ? (nameAtRank.get(positionRank - 1) ?? null) : null;
    out.set(entry.playerId, { value: entry.value, positionRank, qualifierCount, namedNeighbor });
  }
  return out;
}
