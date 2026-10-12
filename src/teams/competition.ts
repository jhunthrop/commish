import { PBP_PLAYER_METRICS } from "@research-ts/projections/nflverse/pbp-players";
import { TEAM_PAGE_CONFIG } from "./config";
import type { TeamCompetition, UsageCount, UsageShare } from "./contract";

/**
 * WHO EATS ON THIS OFFENCE (coordinator's section 6): last season's top target earners with their
 * share of the club's attributed targets, the top rushers with their share of the attributed
 * carries, and the red-zone touch leaders. Pure over the play-by-play attribution rows
 * (`nflverse_pbp_player`) the fact-sheet round's scoring-usage reader already trusts.
 *
 * THE DENOMINATOR IS THE CLUB'S OWN ATTRIBUTED TOTAL over the players the caller placed on it,
 * stated as such on the page. `targetCompetitionFor` (`capsules/facts/role.ts`) uses the
 * participation feed's `team_targets`; that feed stops at 2024 on this store, and a share against
 * a denominator the store does not hold would be a share against nothing. Four decimals, the same
 * register precision `role.ts` keeps, so two runs over the same rows agree in the last bit.
 *
 * A CLUB WITH NO ATTRIBUTED TOUCHES YIELDS NOTHING, never three empty columns.
 */

/** One observation row, as `observationsAsOf` returns it, narrowed to what this needs. */
export interface UsageRow {
  readonly playerId: string;
  readonly metric: string;
  readonly value: number;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function sumsBy(rows: readonly UsageRow[], metrics: readonly string[]): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (!metrics.includes(row.metric)) continue;
    out.set(row.playerId, (out.get(row.playerId) ?? 0) + row.value);
  }
  return out;
}

/** The two things a leader is named by: his display name, and the product id a link needs. Both
 *  keyed by universe id; a player the universe or the crosswalk does not hold is absent from
 *  either map and renders by id or as plain text respectively. */
export interface LeaderIdentity {
  readonly names: ReadonlyMap<string, string>;
  readonly productIds: ReadonlyMap<string, string>;
}

/** Count descending, then player id, so a tie resolves the same way on every run. */
function leaders(sums: ReadonlyMap<string, number>, identity: LeaderIdentity, limit: number): readonly UsageCount[] {
  return [...sums]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([nflPlayerId, count]) => ({ nflPlayerId, playerId: identity.productIds.get(nflPlayerId) ?? null, name: identity.names.get(nflPlayerId) ?? nflPlayerId, count }));
}

function shares(sums: ReadonlyMap<string, number>, identity: LeaderIdentity, limit: number): readonly UsageShare[] {
  const total = [...sums.values()].reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];
  return leaders(sums, identity, limit).map((leader) => ({ ...leader, share: round4(leader.count / total) }));
}

/** The club's competition for `season`, or `null` when the rows hold no touch at all. */
export function competitionFor(season: number, rows: readonly UsageRow[], identity: LeaderIdentity): TeamCompetition | null {
  const limit = TEAM_PAGE_CONFIG.competitionLeaders;
  const targets = shares(sumsBy(rows, [PBP_PLAYER_METRICS.targets]), identity, limit);
  const carries = shares(sumsBy(rows, [PBP_PLAYER_METRICS.carries]), identity, limit);
  const redZoneTouches = leaders(sumsBy(rows, [PBP_PLAYER_METRICS.redZoneCarries, PBP_PLAYER_METRICS.redZoneTargets]), identity, limit);
  if (targets.length === 0 && carries.length === 0 && redZoneTouches.length === 0) return null;
  return { season, targets, carries, redZoneTouches };
}
