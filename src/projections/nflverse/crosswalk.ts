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

/**
 * Surname plus first initial — `joshua palmer` and `josh palmer` both become `palmer|j`.
 *
 * The last resort, and it exists because measurement demanded it: the four largest unresolved
 * groups in a full 2023 backfill were all one person under two given names (Josh/Joshua Palmer,
 * Kenny/Kenneth Gainwell, Chig/Chigoziem Okonkwo) — feeds disagree about whether to print the
 * name on the birth certificate or the one on the jersey. It stays SAFE because it is only ever
 * consulted after both full-name lookups have found nobody, and because it still refuses when it
 * finds more than one candidate the team cannot separate. What it deliberately does not catch is a
 * true nickname (`Hollywood` for `Marquise`), which shares no initial and would need an alias
 * table — guessing there would be guessing, and this file does not guess.
 */
function surnameKey(name: string): string {
  const parts = normalizeName(name).split(" ");
  const surname = parts.length > 1 ? parts[parts.length - 1]! : parts[0]!;
  return `${surname}|${parts[0]!.charAt(0)}`;
}

/** The identity of a candidate, for de-duplicating the unresolved report. */
function candidateKey({ name, position, team }: CrosswalkCandidate): string {
  return `${normalizeName(name)}|${position}|${team}`;
}

export function buildCrosswalk(roster: readonly CrosswalkPlayer[]): Crosswalk {
  const byNameAndPosition = new Map<string, CrosswalkPlayer[]>();
  const byName = new Map<string, CrosswalkPlayer[]>();
  const bySurnameAndPosition = new Map<string, CrosswalkPlayer[]>();
  const push = (index: Map<string, CrosswalkPlayer[]>, key: string, entry: CrosswalkPlayer) => {
    (index.get(key) ?? index.set(key, []).get(key)!).push(entry);
  };
  for (const entry of roster) {
    const name = normalizeName(entry.name);
    push(byNameAndPosition, `${name}|${entry.position}`, entry);
    push(byName, name, entry);
    push(bySurnameAndPosition, `${surnameKey(entry.name)}|${entry.position}`, entry);
  }

  /**
   * A lookup's answer plus WHICH rule produced it, strictest first (0 = full name and position,
   * 1 = full name alone, 2 = surname and initial). `resolveAll` needs the tier to arbitrate when
   * two candidates claim the same person — a looser rule must never outrank a stricter one.
   */
  type Lookup = ({ readonly id: string } | { readonly reason: UnresolvedReason }) & { readonly tier: number };

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
   * Three lookups, strictest first: full name with position, full name alone, then surname with
   * first initial and position. The ORDER is the safety property. Trying the name alone first would
   * let a receiver and a defensive back who happen to share a name resolve to each other; trying
   * the surname first would marry two brothers. Each step only ever runs when the stricter one
   * above it found nobody at all, so a looser rule can widen coverage but can never overrule a
   * better match.
   */
  const lookup = (candidate: CrosswalkCandidate): Lookup => {
    const name = normalizeName(candidate.name);
    const exact = byNameAndPosition.get(`${name}|${candidate.position}`) ?? [];
    if (exact.length > 0) return { ...pick(exact, candidate.team), tier: 0 };
    const anyPosition = byName.get(name) ?? [];
    if (anyPosition.length > 0) return { ...pick(anyPosition, candidate.team), tier: 1 };
    return { ...pick(bySurnameAndPosition.get(`${surnameKey(candidate.name)}|${candidate.position}`) ?? [], candidate.team), tier: 2 };
  };

  return {
    resolve(candidate) {
      const outcome = lookup(candidate);
      return "id" in outcome ? outcome.id : null;
    },

    resolveAll(candidates) {
      const resolved = new Map<string, string>();
      const unresolved = new Map<string, UnresolvedPlayer>();
      /** Every candidate identity that claimed a roster player, with the rule that got it there. */
      const claims = new Map<string, { readonly candidate: CrosswalkCandidate; readonly id: string; readonly tier: number; occurrences: number }>();

      const reject = (candidate: CrosswalkCandidate, reason: UnresolvedReason, occurrences: number) => {
        const key = candidateKey(candidate);
        const already = unresolved.get(key);
        unresolved.set(
          key,
          already === undefined
            ? { ...candidate, reason, occurrences }
            : { ...already, occurrences: already.occurrences + occurrences },
        );
      };

      for (const candidate of candidates) {
        const key = candidateKey(candidate);
        const existing = claims.get(key);
        if (existing !== undefined) {
          existing.occurrences += 1;
          continue;
        }
        if (unresolved.has(key)) {
          reject(candidate, unresolved.get(key)!.reason, 1);
          continue;
        }
        const outcome = lookup(candidate);
        if ("id" in outcome) claims.set(key, { candidate, id: outcome.id, tier: outcome.tier, occurrences: 1 });
        else reject(candidate, outcome.reason, 1);
      }

      /**
       * THE COLLISION GUARD, and the reason `resolveAll` exists rather than a bare `resolve` in a
       * loop: each lookup answers in isolation, so two DIFFERENT people can both land on one roster
       * player — and that is not a near-miss, it is a whole season of one man's snaps written onto
       * another. It was found the only way such a thing ever is: a full-season backfill tripped the
       * store's own coherence check with one player holding two different snap counts for one week.
       *
       * One person legitimately produces several candidate identities (a midseason trade changes
       * his team, and the team is part of the identity), so a shared id is only a collision when the
       * NAMES differ. When they do, the strictest rule that reached the player wins and everything
       * looser is rejected; if the strictest tier is itself contested, nobody wins. Refusing both is
       * the only safe answer — a wrong join is invisible forever after, while a rejection is printed.
       */
      const byPlayerId = new Map<string, (typeof claims extends Map<string, infer V> ? V : never)[]>();
      for (const claim of claims.values()) {
        (byPlayerId.get(claim.id) ?? byPlayerId.set(claim.id, []).get(claim.id)!).push(claim);
      }
      for (const contenders of byPlayerId.values()) {
        const names = new Set(contenders.map((claim) => normalizeName(claim.candidate.name)));
        if (names.size <= 1) continue;
        const strictest = Math.min(...contenders.map((claim) => claim.tier));
        const winners = contenders.filter((claim) => claim.tier === strictest);
        const winnerNames = new Set(winners.map((claim) => normalizeName(claim.candidate.name)));
        for (const claim of contenders) {
          if (winnerNames.size === 1 && claim.tier === strictest) continue;
          claims.delete(candidateKey(claim.candidate));
          reject(claim.candidate, "ambiguous", claim.occurrences);
        }
      }

      for (const [key, claim] of claims) resolved.set(key, claim.id);
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
