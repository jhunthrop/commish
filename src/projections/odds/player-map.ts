import { and, eq, lte, gte } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@/db/client";
import { nflPlayers, playerPropObservations, propsPlayerMap } from "@/db/schema";

/**
 * THE PROP-NAME RESOLVER — props-backfill Task 1, the "next round's problem" `player_prop_
 * observations`'s own docblock deferred.
 *
 * RESOLUTION IS BY NAME, the same considered exception `preseason/benchmarks.ts` already carries
 * for the identical class of join: the odds API emits no player id of any kind, only a
 * `description` string, so there is no alternative. What makes it defensible is the SAME spine
 * `benchmarks.ts` leans on -- the candidate set for one prop name is that ONE SEASON's own roster
 * (`candidateSeasonRoster`), a few thousand people who demonstrably played that season, not the
 * whole all-time universe. `normalizePropName` and the exact/loose two-tier match are a direct
 * port of `benchmarks.ts`'s `normalizeName`/`resolveRankings`, minus position and team -- the odds
 * API's outcome carries neither, so this resolver has one fewer signal to disambiguate with, and
 * leans harder on the season scope and the uniqueness rule to keep a wrong join from ever landing.
 */

export type PlayerMapMethod = "exact" | "loose";

export interface PlayerMapRow {
  readonly propName: string;
  readonly season: number;
  readonly playerId: string;
  readonly method: PlayerMapMethod;
}

/** One person on a season's own roster, as the resolver needs to see them. */
export interface PlayerMapCandidate {
  readonly playerId: string;
  readonly name: string;
}

export interface PropNameToResolve {
  readonly propName: string;
  readonly season: number;
}

export type UnmatchedReason = "not_found" | "ambiguous";

export interface UnmatchedPropName {
  readonly propName: string;
  readonly season: number;
  readonly reason: UnmatchedReason;
}

export interface PlayerMapResolution {
  readonly matched: readonly PlayerMapRow[];
  readonly unmatched: readonly UnmatchedPropName[];
}

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** `preseason/benchmarks.ts`'s `normalizeName`, verbatim in behaviour -- diacritics, apostrophes,
 *  periods and hyphens stripped, lowercased, generational suffix dropped. Kept as its own copy
 *  (rather than imported across the `preseason/` <-> `odds/` boundary) because the two modules
 *  resolve against different candidate spines and nothing should couple them structurally. */
export function normalizePropName(name: string): string {
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

/** Last name, first initial only -- used ONLY when the full name matched nobody and exactly one
 *  season candidate answers to it (see `resolvePropNames`'s own docblock). */
function looseKeyOf(name: string): string | null {
  const parts = normalizePropName(name).split(" ");
  if (parts.length < 2) return null;
  return `${parts[0]!.slice(0, 1)}|${parts[parts.length - 1]!}`;
}

interface SeasonIndex {
  readonly byExact: ReadonlyMap<string, readonly PlayerMapCandidate[]>;
  readonly byLoose: ReadonlyMap<string, readonly PlayerMapCandidate[]>;
}

function buildSeasonIndex(candidates: readonly PlayerMapCandidate[]): SeasonIndex {
  const byExact = new Map<string, PlayerMapCandidate[]>();
  const byLoose = new Map<string, PlayerMapCandidate[]>();
  const add = (index: Map<string, PlayerMapCandidate[]>, key: string | null, candidate: PlayerMapCandidate): void => {
    if (key === null) return;
    const claimants = index.get(key);
    if (claimants === undefined) index.set(key, [candidate]);
    else claimants.push(candidate);
  };
  for (const candidate of candidates) {
    add(byExact, normalizePropName(candidate.name), candidate);
    add(byLoose, looseKeyOf(candidate.name), candidate);
  }
  return { byExact, byLoose };
}

/**
 * Resolves observed prop names to a player id, scoped to each name's own season.
 *
 * Name alone must identify exactly one season candidate. Where the exact normalized name is
 * claimed by two or more people that season, NEITHER is matched -- a coin flip would put a real
 * archived line on the wrong man, permanently and invisibly, and an unresolved name is visible in
 * the report while a wrong match never is. The loose (first-initial + surname) fallback is tried
 * only when the exact key found nobody, and is itself refused under the same ambiguity rule.
 */
export function resolvePropNames(
  propNames: readonly PropNameToResolve[],
  candidatesBySeason: ReadonlyMap<number, readonly PlayerMapCandidate[]>,
): PlayerMapResolution {
  const matched: PlayerMapRow[] = [];
  const unmatched: UnmatchedPropName[] = [];
  const indexBySeason = new Map<number, SeasonIndex>();
  const indexFor = (season: number): SeasonIndex => {
    const cached = indexBySeason.get(season);
    if (cached !== undefined) return cached;
    const built = buildSeasonIndex(candidatesBySeason.get(season) ?? []);
    indexBySeason.set(season, built);
    return built;
  };

  for (const { propName, season } of propNames) {
    const { byExact, byLoose } = indexFor(season);
    const exact = byExact.get(normalizePropName(propName)) ?? [];
    if (exact.length === 1) {
      matched.push({ propName, season, playerId: exact[0]!.playerId, method: "exact" });
      continue;
    }
    if (exact.length > 1) {
      unmatched.push({ propName, season, reason: "ambiguous" });
      continue;
    }
    const looseKey = looseKeyOf(propName);
    const loose = looseKey === null ? [] : byLoose.get(looseKey) ?? [];
    if (loose.length === 1) {
      matched.push({ propName, season, playerId: loose[0]!.playerId, method: "loose" });
      continue;
    }
    unmatched.push({ propName, season, reason: loose.length > 1 ? "ambiguous" : "not_found" });
  }

  return { matched, unmatched };
}

/**
 * Which NFL season a kickoff belongs to. The regular season runs September through early January
 * and the playoffs run into February, so a game in January or February belongs to the PREVIOUS
 * calendar year's season (week 18 of the 2023 season kicks off in January 2024). This backfill only
 * ever touches regular-season kickoffs (`kickoffInstantsByWeek`'s own guarantee), but the rule holds
 * for the postseason too, which is why it is written generally rather than as an 18-week special
 * case.
 */
export function seasonOfKickoff(commenceTime: Date): number {
  const month = commenceTime.getUTCMonth(); // 0 = January, 1 = February
  const year = commenceTime.getUTCFullYear();
  return month <= 1 ? year - 1 : year;
}

/**
 * The season-scoped candidate set: every `nfl_players` row whose recorded career span covers
 * `season`. A player with no recorded `rookie_season`/`last_season` (verified against the live
 * universe: the two columns are always both-null or both-set, never one alone) is EXCLUDED rather
 * than assumed active -- the same "never guess" discipline the rest of this store keeps.
 */
export async function candidateSeasonRoster(db: ReadonlyDb, season: number): Promise<readonly PlayerMapCandidate[]> {
  const rows = await db
    .select({ playerId: nflPlayers.id, name: nflPlayers.name })
    .from(nflPlayers)
    .where(and(lte(nflPlayers.rookieSeason, season), gte(nflPlayers.lastSeason, season)));
  return rows;
}

/**
 * Every distinct (raw prop name, season) pair the archive has observed -- the resolver's own input.
 * Season is derived from each row's `commence_time` (`player_prop_observations` carries no season
 * column of its own; see that table's own docblock for why it stays a flat event/market store).
 */
export async function distinctObservedPropNames(db: ReadonlyDb): Promise<readonly PropNameToResolve[]> {
  // `ReadonlyDb` exposes no `selectDistinct` (`db/client.ts`'s own narrowing) -- the `Map` below
  // does the de-duplication instead, so a plain `select` is all this needs.
  const rows = await db
    .select({ playerName: playerPropObservations.playerName, commenceTime: playerPropObservations.commenceTime })
    .from(playerPropObservations);
  const seen = new Map<string, PropNameToResolve>();
  for (const row of rows) {
    const season = seasonOfKickoff(row.commenceTime);
    const key = `${row.playerName}|${season}`;
    if (!seen.has(key)) seen.set(key, { propName: row.playerName, season });
  }
  return [...seen.values()];
}

/**
 * How many observation ROWS each (prop name, season) pair carries -- `scripts/odds-props-resolve.ts`'s
 * own weighting for "match rate by observation count," distinct from "match rate by distinct name"
 * (a name with a hundred archived lines and a name with one both count as ONE miss in the distinct-
 * name rate, but the observation-count rate weights the hundred-line miss appropriately heavier).
 * Keyed identically to `distinctObservedPropNames`'s own pairing (`` `${propName}|${season}` ``).
 */
export async function observationCountsByPropName(db: ReadonlyDb): Promise<ReadonlyMap<string, number>> {
  const rows = await db
    .select({ playerName: playerPropObservations.playerName, commenceTime: playerPropObservations.commenceTime })
    .from(playerPropObservations);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.playerName}|${seasonOfKickoff(row.commenceTime)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Writes resolved mappings idempotently (`onConflictDoNothing` on the (prop_name, season) unique
 * index -- a re-resolved name/season pair is not a restatement, matching this store's other
 * point-in-time-adjacent writers). Returns how many rows were ACTUALLY new.
 */
export async function recordPropPlayerMap(db: Db, rows: readonly PlayerMapRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(propsPlayerMap)
    .values(rows.map((row) => ({ ...row })))
    .onConflictDoNothing()
    .returning({ id: propsPlayerMap.id });
  return inserted.length;
}

/** THE READER — a resolved player id for one (prop name, season) pair, or `null` if the map holds
 *  no resolution for it (unresolved, or never observed). */
export async function playerIdForPropName(db: ReadonlyDb, propName: string, season: number): Promise<string | null> {
  const [row] = await db
    .select({ playerId: propsPlayerMap.playerId })
    .from(propsPlayerMap)
    .where(and(eq(propsPlayerMap.propName, propName), eq(propsPlayerMap.season, season)))
    .limit(1);
  return row?.playerId ?? null;
}
