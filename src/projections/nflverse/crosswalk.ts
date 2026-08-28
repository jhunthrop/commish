import type { Position } from "@/domain/player";

/**
 * PLAYER IDENTITY, which is the hazard in this whole module.
 *
 * nflverse keys players by its own ids (`gsis_id` in the weekly stats, `pfr_player_id` in the snap
 * counts); our `players` table is keyed by the stats provider's id. Nothing joins the two, so the
 * join is on the only thing both sides carry: a name, a position and a team.
 *
 * THE FAILURE MODE THIS FILE EXISTS TO PREVENT: a player who does not match is silently absent
 * from the store, and an absent player is INDISTINGUISHABLE from a player who did not play. A join
 * that quietly loses eight percent of receivers does not look broken — it looks like a lot of
 * healthy scratches, and every target share computed downstream is quietly wrong in the same
 * direction. So nothing here ever drops a row: an unmatched candidate comes back on a named list,
 * with a reason and a count, and the caller is expected to look at it.
 *
 * The match is deliberately conservative in one direction and generous in the other. It is
 * GENEROUS about spelling and position, because feeds genuinely disagree there — punctuation,
 * generational suffixes and Taysom Hill being a quarterback to one source and a tight end to
 * another are all noise. It REFUSES to guess when two men share a name and neither is on the
 * stated team, because picking one would attach a whole season of somebody else's snaps to a
 * player, and that error is invisible forever after.
 */

/** Our side of the join — the columns of `players` this needs, and nothing more. */
export interface CrosswalkPlayer {
  readonly id: string;
  readonly name: string;
  readonly position: Position;
  readonly nflTeam: string;
}

/** Their side — what an nflverse row carries about who a person is. */
export interface CrosswalkCandidate {
  readonly name: string;
  /** nflverse's own position spelling. Not narrowed to `Position`: the snap-counts file carries
   *  linemen (`T`, `G`, `C`) that we do not project but do need for a team snap denominator. */
  readonly position: string;
  readonly team: string;
}

/**
 * Why a candidate did not resolve — the two reasons want different fixes. `absent` usually means a
 * player who retired or never reached our roster feed, which is expected in a historical backfill
 * and mostly benign. `ambiguous` means two people we carry share a name and the team did not
 * separate them: a real gap, and one a human can close by hand.
 */
export type UnresolvedReason = "absent" | "ambiguous";

export interface UnresolvedPlayer extends CrosswalkCandidate {
  readonly reason: UnresolvedReason;
  /** How many rows wanted this person. A star missing from eighteen weeks matters more than a
   *  practice-squad end missing from one. */
  readonly occurrences: number;
}

export interface ResolveAllResult {
  /** Candidate key → our player id, for everyone who matched. */
  readonly resolved: ReadonlyMap<string, string>;
  readonly unresolved: readonly UnresolvedPlayer[];
  /**
   * Matched candidates over total candidates, or `null` for an empty input — never `1`, following
   * `metrics.ts`'s rule that a sample which cannot answer says so rather than reporting a
   * flattering number. This is the figure the plan's own stop condition is written against.
   */
  readonly resolutionRate: number | null;
}

export interface Crosswalk {
  resolve(candidate: CrosswalkCandidate): string | null;
  resolveAll(candidates: readonly CrosswalkCandidate[]): ResolveAllResult;
}

/**
 * One spelling of a name, for comparison only — never for display.
 *
 * Strips case, the punctuation feeds disagree about (`A.J.` / `AJ`, `Ka'imi` / `Kaimi`,
 * `Amon-Ra` / `Amon Ra`) and generational suffixes, which one feed appends and the other does not.
 * Deliberately NOT a fuzzy or phonetic match: an edit-distance join would happily marry two
 * different rookies with similar names, and that error is silent and permanent.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'`’]/g, "")
    .replace(/[-]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The identity of a candidate, for de-duplicating the unresolved report. */
function candidateKey({ name, position, team }: CrosswalkCandidate): string {
  return `${normalizeName(name)}|${position}|${team}`;
}

export function buildCrosswalk(roster: readonly CrosswalkPlayer[]): Crosswalk {
  const byNameAndPosition = new Map<string, CrosswalkPlayer[]>();
  const byName = new Map<string, CrosswalkPlayer[]>();
  for (const entry of roster) {
    const name = normalizeName(entry.name);
    const withPosition = `${name}|${entry.position}`;
    (byNameAndPosition.get(withPosition) ?? byNameAndPosition.set(withPosition, []).get(withPosition)!).push(entry);
    (byName.get(name) ?? byName.set(name, []).get(name)!).push(entry);
  }

  /** One candidate list narrowed to a single answer, or the reason it could not be. */
  const pick = (
    candidates: readonly CrosswalkPlayer[],
    team: string,
  ): { readonly id: string } | { readonly reason: UnresolvedReason } => {
    if (candidates.length === 1) return { id: candidates[0]!.id };
    const onTeam = candidates.filter((entry) => entry.nflTeam === team);
    if (onTeam.length === 1) return { id: onTeam[0]!.id };
    return { reason: candidates.length === 0 ? "absent" : "ambiguous" };
  };

  /**
   * Position first, then name alone. The order matters: trying the name alone first would let a
   * receiver and a defensive back who happen to share a name resolve to each other, while trying
   * it SECOND means it only ever runs when the position-qualified lookup found nobody — which is
   * precisely the position-drift case it exists for.
   */
  const lookup = (candidate: CrosswalkCandidate): { readonly id: string } | { readonly reason: UnresolvedReason } => {
    const name = normalizeName(candidate.name);
    const exact = byNameAndPosition.get(`${name}|${candidate.position}`) ?? [];
    if (exact.length > 0) return pick(exact, candidate.team);
    return pick(byName.get(name) ?? [], candidate.team);
  };

  return {
    resolve(candidate) {
      const outcome = lookup(candidate);
      return "id" in outcome ? outcome.id : null;
    },

    resolveAll(candidates) {
      const resolved = new Map<string, string>();
      const unresolved = new Map<string, UnresolvedPlayer>();
      for (const candidate of candidates) {
        const key = candidateKey(candidate);
        const outcome = lookup(candidate);
        if ("id" in outcome) {
          resolved.set(key, outcome.id);
          continue;
        }
        const already = unresolved.get(key);
        unresolved.set(
          key,
          already === undefined
            ? { ...candidate, reason: outcome.reason, occurrences: 1 }
            : { ...already, occurrences: already.occurrences + 1 },
        );
      }
      // Rate is over DISTINCT people, not over rows: a star who appears in eighteen weekly rows
      // would otherwise weigh eighteen times as much as a backup in the one number the plan's stop
      // condition is checked against, and the question that condition asks is "how much of the
      // player universe did we fail to join", not "how many rows".
      const distinct = resolved.size + unresolved.size;
      return {
        resolved,
        unresolved: [...unresolved.values()],
        resolutionRate: distinct === 0 ? null : resolved.size / distinct,
      };
    },
  };
}

/** The key `resolveAll`'s map is keyed by — callers hold a candidate and need its id back. */
export function crosswalkKey(candidate: CrosswalkCandidate): string {
  return candidateKey(candidate);
}
