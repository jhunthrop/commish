/**
 * THE TWO BENCHMARKS THE SPEC NAMES AND THE REPOSITORY DID NOT HAVE.
 *
 * The engine spec's rule is "benchmarks, all three, always: naive, ADP, ECR". Phases 1 to 5 had
 * one. `docs/research/2026-08-27-decision-quality.md` names the gap as its second-highest priority
 * and is blunt about what it cost: with no dated market price, the draft replay had to use its own
 * projected-points rank as the market, so the survival model was asked to predict a synthetic room
 * and the sleeper list had nothing real to disagree with.
 *
 * A preseason board is the one place a market price exists in public and dated form. Average draft
 * position is computed from real drafts in the last days of August, and expert consensus is
 * published on a board with a year on it. Both are fetched by an operator script, resolved to the
 * historical universe here, and written to `preseason_rankings` with the day they were published.
 * Neither is ever a runtime dependency and neither is ever a FEATURE — consuming a competitor's
 * ranking as an input would make our board derivative of theirs, which is the one thing the spec
 * forbids outright.
 *
 * RESOLUTION IS BY NAME, WHICH THIS CODEBASE OTHERWISE REFUSES TO DO. `players.ts` is scathing
 * about name joins and is right: they lose ten points of resolution per season going backwards
 * against a current roster snapshot. There is no alternative here, because neither publisher emits
 * a gsis id. What makes it defensible is the SPINE: the candidate set is that season's own week-one
 * roster, roughly two thousand people who were demonstrably in the league that August, rather than
 * the twenty-five thousand in the all-time universe. The two Josh Allens problem does not arise,
 * because the retired centre is not on anybody's 2023 roster.
 *
 * And the resolution rate is REPORTED, never assumed. A benchmark that silently resolved sixty
 * percent of a board would be scored on the sixty percent that happened to match, which selects on
 * exactly the players both sources found easy.
 */

/**
 * THE EARLIEST SEASON THIS STORE HOLDS A PUBLISHED PRESEASON BOARD FOR — an ASSET bound on the two
 * benchmark feeds, the same kind of fact `ROSTER_ASSET_FLOOR` records for the weekly-roster release.
 *
 * NAMED HERE IN ITS OWN RIGHT (fit-round Task 1), because until now the two fits that need it
 * (`scripts/market-curve-fit.ts`, `scripts/blend-fit.ts`) borrowed `HISTORICAL_ROSTER_FLOOR` for it.
 * That worked only while the two numbers happened to be equal. The roster floor moved to 2003 in
 * this round and this one did not move with it: both boards are fetched per season by
 * `preseason-ingest.ts` and the store holds them for 2013 onward and for nothing earlier. A fit whose
 * train window started at the roster floor would silently pool ten seasons with no market price in
 * them at all and report the same curve as though it had a decade more evidence.
 *
 * ONE CONSTANT FOR BOTH SOURCES, because both start in the same place and the store says so:
 * `preseason_rankings` was read directly on 2026-09-02 and each of `ffc_adp_ppr_12` and
 * `fantasypros_ecr_ppr` has rows for every season 2013 through 2026 and for no season before 2013.
 * Should one feed ever reach further back than the other, this splits into two constants rather than
 * quietly becoming the minimum of them.
 */
import { productTeamCode, sourceTeamCode, teamDefenseUniverseId } from "../nflverse/team-codes";

export const BENCHMARK_BOARD_FLOOR = 2013;

/** Where a published preseason ranking came from. Free text, matching the store's `source` column. */
export const BENCHMARK_SOURCES = {
  /** Fantasy Football Calculator's twelve-team PPR average draft position — the MARKET. */
  adp: "ffc_adp_ppr_12",
  /** The same publisher's twelve-team HALF-PPR board (the scoring-formats round, 2026-09-08).
   *  Published from 2018 onward and for no season before; `BENCHMARK_BOARD_FLOOR` does not
   *  describe it, and a fit over it reports the seasons it actually found rows for. */
  adpHalf: "ffc_adp_half_12",
  /** The same publisher's twelve-team STANDARD (non-PPR) board, published from 2013 onward. */
  adpStd: "ffc_adp_std_12",
  /** FantasyPros' expert consensus ranking, PPR draft board — the CONSENSUS we replace. */
  ecr: "fantasypros_ecr_ppr",
} as const;

/** One line of a published board, as the publisher spells it. */
export interface RankingCandidate {
  readonly name: string;
  /** The publisher's position spelling (`QB`, `RB`, `WR`, `TE`, `DST`, `K`). */
  readonly position: string;
  /** The publisher's team abbreviation, or null where it carries none. A tiebreak, never a filter. */
  readonly team: string | null;
  /** Lower is better. An average draft position is fractional; a consensus rank is an integer. */
  readonly rank: number;
}

/** One person on the season's week-one roster, as the resolver needs to see him. */
export interface RosterIdentity {
  readonly playerId: string;
  readonly name: string;
  /** nflverse's spelling. Compared after both sides are narrowed, so `FB` matches `RB`. */
  readonly position: string;
  readonly team: string;
}

export interface ResolvedRanking {
  readonly playerId: string;
  readonly rank: number;
}

export interface RankingResolution {
  readonly resolved: readonly ResolvedRanking[];
  /** Everyone the roster could not place, in published order. Named, never silently dropped. */
  readonly unresolved: readonly RankingCandidate[];
  /** Matched over published, or `null` for an empty board — never 1, following `metrics.ts`. */
  readonly resolutionRate: number | null;
}

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * A name reduced to what two publishers can be expected to agree on.
 *
 * Diacritics, apostrophes, periods and hyphens all differ between feeds for the same man
 * (`Ja'Marr` / `JaMarr`, `D.J.` / `DJ`, `Amon-Ra` / `Amon Ra`), and generational suffixes are
 * carried by some publishers and not others. Everything else is left alone: a matcher that also
 * dropped middle names or matched on a first initial would start joining brothers together, and a
 * wrong join is far worse than an unresolved one — it puts one man's market price on another's
 * board line and nothing downstream can see it.
 */
export function normalizeName(name: string): string {
  const stripped = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter((part) => part !== "");
  const withoutSuffix = stripped.filter((part, index) => index === 0 || !NAME_SUFFIXES.has(part));
  return withoutSuffix.join(" ");
}

/** Both sides' position spellings reduced to the groups a fantasy board actually distinguishes. */
function positionGroup(position: string): string {
  const upper = position.trim().toUpperCase();
  if (upper === "FB" || upper === "HB") return "RB";
  // THE KICKER'S TWO SPELLINGS (the 2026-09-05 round). The market board publishes him as `PK` and
  // the roster this resolver joins against spells him `K`, so every kicker on every published board
  // failed the name-and-position key and landed in `unresolved`. Measured against the real 2025
  // FFC board: 249 rows published, 205 resolved, and 20 of the 44 misses were kickers. The same
  // class of translation `FB` gets on the line above, and the same reason: two feeds naming one
  // position two ways is not a reason to lose the position.
  if (upper === "PK") return "K";
  // The market board's own spelling for a team defence. `DST` appears on other publishers' boards
  // and is folded here so this resolver's DEF branch below sees one spelling.
  if (upper === "DST" || upper === "D/ST" || upper === "DEF") return "DEF";
  return upper;
}

function keyOf(name: string, position: string): string {
  return `${normalizeName(name)}|${positionGroup(position)}`;
}

/** The position value the product uses for a team defence, which is never a person. */
const TEAM_DEFENSE_POSITION = "DEF";

/**
 * The synthetic universe id a published defence row belongs to, or `null` for a row whose team code
 * neither feed recognises (which the resolver records as unresolved rather than guessing at).
 *
 * `productTeamCode` then `sourceTeamCode` on purpose: the market's own list mixes the two spellings
 * (`LAR` from the product's vocabulary, `WAS` from the source's), and running it through both in
 * that order normalises either into the source spelling the universe id is minted from.
 */
function teamDefenseUniverseIdOf(team: string | null): string | null {
  if (team === null) return null;
  const code = team.trim().toUpperCase();
  if (code === "") return null;
  try {
    return teamDefenseUniverseId(sourceTeamCode(productTeamCode(code)));
  } catch {
    return null;
  }
}

/**
 * The fallback key: last name, first initial and position.
 *
 * Publishers disagree about given names far more often than about surnames — `Josh` against
 * `Joshua`, `Cam` against `Cameron`, `Mike` against `Michael` — and every one of those is the same
 * man beyond any doubt. It is used ONLY where the full name found nothing and where exactly one
 * person on the roster answers to it, so the loosening cannot pick between two candidates. Two
 * brothers at the same position on the same board would collide here, and the uniqueness rule is
 * what makes that an unresolved line rather than a wrong one.
 */
function looseKeyOf(name: string, position: string): string | null {
  const parts = normalizeName(name).split(" ");
  if (parts.length < 2) return null;
  return `${parts[0]!.slice(0, 1)}|${parts[parts.length - 1]!}|${positionGroup(position)}`;
}

/**
 * Matches a published board to the season's own roster.
 *
 * Name and position must both agree; team is consulted ONLY to choose between two men who agree on
 * both, which happens a handful of times a season. Where a name-and-position key is claimed by two
 * people and the team does not separate them, NEITHER is matched: a coin flip between two players
 * would put a real market price on the wrong man, and an unresolved line is visible in the
 * resolution rate while a wrong one is invisible forever.
 */
export function resolveRankings(
  candidates: readonly RankingCandidate[],
  identities: readonly RosterIdentity[],
): RankingResolution {
  const byKey = new Map<string, RosterIdentity[]>();
  const byLooseKey = new Map<string, RosterIdentity[]>();
  const add = (index: Map<string, RosterIdentity[]>, key: string | null, identity: RosterIdentity): void => {
    if (key === null) return;
    const claimants = index.get(key);
    if (claimants === undefined) index.set(key, [identity]);
    else claimants.push(identity);
  };
  for (const identity of identities) {
    add(byKey, keyOf(identity.name, identity.position), identity);
    add(byLooseKey, looseKeyOf(identity.name, identity.position), identity);
  }

  const resolved: ResolvedRanking[] = [];
  const unresolved: RankingCandidate[] = [];
  const taken = new Set<string>();
  for (const candidate of candidates) {
    // A TEAM DEFENCE IS PLACED BY TEAM CODE, NEVER BY NAME (the 2026-09-05 round). It is not a
    // person, so it has no row on the week-one roster this resolver joins against and could never
    // resolve at all: every published defence on every board landed in `unresolved`, which is why
    // the store held no market price for the position. Its published `team` is a code rather than a
    // spelling of a name, so this is an id-ish join and strictly safer than the name join every
    // person goes through. `team-codes.ts` absorbs the market's own mixed spelling — the real FFC
    // board carries `LAR` (the product's) and `WAS` (the source's) in the same list.
    if (positionGroup(candidate.position) === TEAM_DEFENSE_POSITION) {
      const universeId = teamDefenseUniverseIdOf(candidate.team);
      if (universeId === null || taken.has(universeId)) {
        unresolved.push(candidate);
        continue;
      }
      taken.add(universeId);
      resolved.push({ playerId: universeId, rank: candidate.rank });
      continue;
    }
    const exact = byKey.get(keyOf(candidate.name, candidate.position)) ?? [];
    const loose = byLooseKey.get(looseKeyOf(candidate.name, candidate.position) ?? "") ?? [];
    const claimants = exact.length > 0 ? exact : loose.length === 1 ? loose : [];
    const team = candidate.team === null ? null : candidate.team.trim().toUpperCase();
    const narrowed = claimants.length > 1 ? claimants.filter((claimant) => claimant.team === team) : claimants;
    const chosen = narrowed.length === 1 ? narrowed[0] : undefined;
    // A publisher listing the same man twice (it happens where a board carries a player under two
    // spellings) keeps the FIRST, better rank, rather than writing two rows that the store's unique
    // index would then reject as a batch.
    if (chosen === undefined || taken.has(chosen.playerId)) {
      unresolved.push(candidate);
      continue;
    }
    taken.add(chosen.playerId);
    resolved.push({ playerId: chosen.playerId, rank: candidate.rank });
  }

  return {
    resolved,
    unresolved,
    resolutionRate: candidates.length === 0 ? null : resolved.length / candidates.length,
  };
}
