import type { Player } from "@/domain/player";
import type { TierGrade } from "@/design/tokens";
import { DRAFT_ROOM_CONFIG } from "../state/config";

/**
 * One band of the pool's tier ladder — law 1's grade channel, drawn from `players.adp` and
 * nothing else.
 *
 * `id` is the band's own index down the pool, and it exists so a LIST can tell where one band
 * ends and the next begins without re-deriving anything: the pool renders a `TierDivider`
 * wherever two adjacent VISIBLE rows carry different ids. That indirection is what makes the
 * ladder survive filtering. Band membership is a property of the whole consensus board, computed
 * once over every ranked player; the filtered view a manager is actually looking at ("just the
 * running backs", "hide the drafted") then shows the bands it happens to intersect. A band with
 * one player left in it is the most useful thing this ladder ever says, and a ladder recomputed
 * over the filtered rows could never say it.
 */
export interface PoolTier {
  readonly id: number;
  readonly grade: TierGrade;
  /** The band's own consensus span, in the manager's vocabulary: "ADP 13 to 19". */
  readonly label: string;
}

/**
 * The consensus round a player goes in, for a room of `teamCount` seats. Plain arithmetic on a
 * number the feed already publishes — never a projection, never a ranking of ours.
 */
function consensusRound(adp: number, teamCount: number): number {
  return Math.max(1, Math.ceil(adp / teamCount));
}

/** The grade a band's best player earns: the first rung whose round he still falls inside. */
function gradeForRound(round: number): TierGrade {
  const rung = DRAFT_ROOM_CONFIG.tiers.ladder.find((step) => round <= step.throughRound);
  // The ladder's last rung is unbounded (`Number.POSITIVE_INFINITY`), so `find` always hits; the
  // fallback exists because a type cannot know that, and it fails toward the LOWEST grade rather
  // than inventing an S.
  return (rung?.grade ?? DRAFT_ROOM_CONFIG.tiers.ladder[DRAFT_ROOM_CONFIG.tiers.ladder.length - 1]!.grade) as TierGrade;
}

interface OpenBand {
  readonly firstAdp: number;
  lastAdp: number;
  readonly members: string[];
}

function seal(band: OpenBand, id: number, teamCount: number): readonly (readonly [string, PoolTier])[] {
  const tier: PoolTier = {
    id,
    grade: gradeForRound(consensusRound(band.firstAdp, teamCount)),
    // Rounded, because a band's edges are a range a manager reads at a glance, not a measurement
    // he does arithmetic on — and "ADP 12.8 to 19.1" is two false digits of precision about where
    // a cliff is. The underlying values are untouched; only the label rounds.
    label:
      Math.round(band.firstAdp) === Math.round(band.lastAdp)
        ? `ADP ${Math.round(band.firstAdp)}`
        : `ADP ${Math.round(band.firstAdp)} to ${Math.round(band.lastAdp)}`,
  };
  return band.members.map((playerId) => [playerId, tier] as const);
}

/**
 * THE POOL'S TIER LADDER: playerId → the band he sits in, or absent when the ADP feed does not
 * rank him.
 *
 * *"A grade is a fact or it is not drawn."* Two facts make every band, and both come off
 * `players.adp`, which carries a real average draft position for the players the feed ranks:
 *
 * 1. **Where a band BREAKS is measured.** A new band opens at the first pair of adjacent players
 *    whose ADPs sit `DRAFT_ROOM_CONFIG.tiers.cliffAdp` or more apart — a real step down in the
 *    consensus board, not a decorative interval every N rows. The break is also held until the
 *    band it closes has `minBandSize` players in it, so the sparse tail of the feed cannot draw a
 *    rung per player (see that config's own docblock).
 * 2. **What a band is GRADED is measured too.** Its best player's consensus round, for this
 *    room's seat count.
 *
 * WALKED IN THE POOL'S OWN ORDER, not in ADP order. The server ranks the pool and this module
 * never re-ranks it (the same contract `PlayerPool` keeps) — so a gap is the distance between two
 * players the manager will actually read one after the other. Where that order disagrees with ADP
 * the gap goes negative and no band opens, which is the correct answer: a ladder is a claim about
 * a descent, and there is no descent between two players the board has ranked out of ADP order.
 *
 * `teamCount` of zero (a room whose draft order has not been drawn yet) yields an EMPTY ladder
 * rather than a grade computed against a divide-by-zero. A pre-draft pool showing no bands is
 * honest; one showing every player as an S is not.
 */
export function poolTiers(players: readonly Player[], teamCount: number): ReadonlyMap<string, PoolTier> {
  if (teamCount <= 0) return new Map();
  const entries: (readonly [string, PoolTier])[] = [];
  let band: OpenBand | null = null;
  let id = 0;

  for (const player of players) {
    const adp = player.adp;
    if (adp === null) continue;
    if (band === null) {
      band = { firstAdp: adp, lastAdp: adp, members: [player.id] };
      continue;
    }
    const cliff = adp - band.lastAdp >= DRAFT_ROOM_CONFIG.tiers.cliffAdp;
    if (cliff && band.members.length >= DRAFT_ROOM_CONFIG.tiers.minBandSize) {
      entries.push(...seal(band, id, teamCount));
      id += 1;
      band = { firstAdp: adp, lastAdp: adp, members: [player.id] };
      continue;
    }
    band.members.push(player.id);
    band.lastAdp = Math.max(band.lastAdp, adp);
  }

  if (band !== null) entries.push(...seal(band, id, teamCount));
  return new Map(entries);
}

/**
 * A player's ADP as the pool prints it: one decimal, because that is the precision a consensus of
 * real drafts actually carries and rounding it to a whole number would make two genuinely
 * different players look identical. `null` prints nothing at all — never a zero, never a dash
 * dressed as a rank.
 */
export function formatAdp(adp: number | null): string | null {
  return adp === null ? null : `ADP ${adp.toFixed(1)}`;
}
