import { eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@research/db/client";
import { nflPlayers, playerCrosswalk, players } from "@research/db/schema";
import {
  TEAM_DEFENSE_UNIVERSE_PREFIX,
  teamDefenseUniverseIdForProviderId,
  teamDefenseUniverseIds as everyTeamDefenseUniverseId,
} from "./nflverse/team-codes";

/**
 * THE BRIDGE BETWEEN THE TWO ID SPACES THIS PRODUCT HOLDS.
 *
 * The projection engine keys everything on nflverse's gsis id (`00-0033280`) because every
 * historical feed carries it and it never changes. The product keys everything on the stats
 * provider's own id (`4362628`) because that is what arrives with a roster. Both choices were
 * right and neither side had a join to the other, so a player's screen could not show him a number
 * the engine had computed about him. `player_crosswalk` is that join.
 *
 * IT IS AN ID JOIN. The provider numbers players in ESPN's space and nflverse publishes an
 * `espn_id`, so the same man carries the same integer on both sides. `players.ts` in this same
 * directory is scathing about name joins and is right; this module holds the line rather than
 * making the one exception that would put one man's projection on another man's screen.
 *
 * A NAME IS A CHECK, NEVER A KEY. `nameAgrees` is computed for every matched pair and reported,
 * because a bad id join and a good one look identical until somebody compares the names. The
 * disagreements it finds are the argument FOR the mechanism: measured on the live data, all 11 of
 * them are the same person spelled differently (`Hollywood Brown` against `Marquise Brown`,
 * `Joshua Palmer` against `Josh Palmer`, `Scotty Miller` against `Scott Miller`), which is eleven
 * people a name join would have lost — before counting the 124 name-and-position collisions in the
 * universe it would have had to guess at. A disagreement is surfaced for a human rather than acted
 * on, because the resolver cannot tell a nickname from a mistake and should not pretend to.
 *
 * NOBODY IS DROPPED. Every league player gets a row, and one who cannot be placed gets a row
 * saying so and why. `metrics.ts`' rule about a sample that cannot answer applies to identity too:
 * a crosswalk that reported only its successes would report 100% every time, and a crosswalk
 * claiming 100% is a crosswalk that is lying.
 */

/** Why a league player has no counterpart in the historical universe. */
export type UnmatchedReason =
  /**
   * NO LONGER THE ANSWER FOR A REAL TEAM DEFENCE (the 2026-09-05 K and DEF round). This used to be
   * every defence's answer, unconditionally, on the true but useless grounds that there is no person
   * behind one. There is still no person, and there is now a deliberate synthetic universe row per
   * club (`nflverse/team-codes.ts`'s `teamDefenseUniverseId`) that the projection store's foreign key
   * and every reader can key on. What still lands here is a provider id shaped like a defence whose
   * team code is not one of the 32 — a fabricated seed row or a club nobody has told `team-codes.ts`
   * about, which is a real absence rather than a philosophical one.
   */
  | "not_an_nfl_player"
  /** A real product defence whose synthetic universe row has not been seeded. `build-crosswalk.ts`
   *  and `kdef-backfill.ts` both seed all 32 before resolving, so this means the seed step was
   *  skipped or failed, and the edge is refused rather than written against a row that is not there. */
  | "no_team_defense_row"
  /** Nobody in the universe carries this ESPN id — a fringe or undrafted man the release has not
   *  listed, or a fabricated seed row that was never an NFL player at all. */
  | "no_espn_id"
  /** Two universe rows claim the id. `nfl_players_espn_id_idx` makes this impossible today; it is
   *  recorded rather than resolved if the release ever breaks that promise. */
  | "ambiguous_espn_id";

/** How a matched player was placed. The column is free text so a second mechanism can be added
 *  without every row losing the ability to say which one placed it. */
export const CROSSWALK_METHOD = {
  espnId: "espn_id",
  /** A team defence, placed on its own synthetic universe row BY TEAM CODE rather than by any id
   *  join, because there is no person and therefore no shared id to join on. */
  teamDefense: "team_defense",
} as const;

/** The position value the product uses for a team defence, which is never a person. */
const TEAM_DEFENSE_POSITION = "DEF";

/** One league player, as the resolver needs to see him. */
export interface ProviderPlayer {
  /** A `players.id`. */
  readonly id: string;
  readonly name: string;
  /** The product's own narrowed position. `DEF` is the one value that means "not a person". */
  readonly position: string;
}

/** One person in the historical universe, as the resolver needs to see him. */
export interface UniversePlayer {
  /** An `nfl_players.id` — a gsis id. */
  readonly id: string;
  readonly espnId: string | null;
  readonly name: string;
}

export interface CrosswalkMatch {
  readonly playerId: string;
  readonly nflPlayerId: string;
  readonly method: string;
  /**
   * Whether the two sides spell his name the same way once punctuation, accents and generational
   * suffixes are set aside. FALSE IS NOT A REJECTION — see the module docblock — it is the audit
   * signal that says a human should look at this pair.
   */
  readonly nameAgrees: boolean;
  readonly providerName: string;
  readonly universeName: string;
}

export interface CrosswalkMiss {
  readonly playerId: string;
  readonly name: string;
  readonly position: string;
  readonly reason: UnmatchedReason;
}

export interface CrosswalkResolution {
  readonly matched: readonly CrosswalkMatch[];
  readonly unmatched: readonly CrosswalkMiss[];
  /**
   * Matched over EVERY league player, including the team defences that can never match. `null` for
   * an empty input, never 1, following `metrics.ts`' rule that a sample which cannot answer says
   * so. Report `matchRateOfPeople` beside it: the honest headline is the one that does not count
   * a defence as a failure, and the honest denominator is the one that does not quietly shrink.
   */
  readonly matchRate: number | null;
  /** Matched over league players who are actual people — everyone except the team defences. */
  readonly matchRateOfPeople: number | null;
}

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * A name reduced to what two feeds can be expected to agree on, for COMPARISON ONLY.
 *
 * Deliberately the same reduction `benchmarks.ts` applies, so the two places in this repository
 * that look at a name cannot disagree about what a name is. That file uses it to join, which it
 * justifies by the narrowness of its spine; this one uses it only to ask whether an id join it has
 * already made looks sane.
 */
export function comparableName(name: string): string {
  const parts = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter((part) => part !== "");
  return parts.filter((part, index) => index === 0 || !NAME_SUFFIXES.has(part)).join(" ");
}

/**
 * Places every league player in the historical universe, or records why he could not be placed.
 *
 * Pure, and takes both sides as arrays rather than reading them, for the reason every measured
 * thing in this engine is pure: a resolution rate is a number a test has to be able to assert on
 * without a database.
 */
export function resolveCrosswalk(
  providers: readonly ProviderPlayer[],
  universe: readonly UniversePlayer[],
  /**
   * Every synthetic team-defence universe id that ACTUALLY EXISTS in `nfl_players`.
   *
   * Defaults to empty, so a caller that has not seeded them gets `no_team_defense_row` — an honest
   * "the row is not there" — rather than an edge pointing at a foreign key the write would then
   * fail on. `crosswalkInputs` reads the real set.
   */
  teamDefenseUniverseIds: ReadonlySet<string> = new Set(),
): CrosswalkResolution {
  const byEspnId = new Map<string, UniversePlayer[]>();
  for (const person of universe) {
    if (person.espnId === null || person.espnId === "") continue;
    const claimants = byEspnId.get(person.espnId);
    if (claimants === undefined) byEspnId.set(person.espnId, [person]);
    else claimants.push(person);
  }

  const matched: CrosswalkMatch[] = [];
  const unmatched: CrosswalkMiss[] = [];
  // Two league players resolving to one gsis id would be the failure this table exists to prevent,
  // and `player_crosswalk_nfl_player_idx` makes it a database error. Caught here first so the
  // message can name both men rather than quoting a constraint.
  const claimed = new Map<string, string>();

  for (const provider of providers) {
    if (provider.position === TEAM_DEFENSE_POSITION) {
      const universeId = teamDefenseUniverseIdForProviderId(provider.id);
      if (universeId === null) {
        unmatched.push({ playerId: provider.id, name: provider.name, position: provider.position, reason: "not_an_nfl_player" });
        continue;
      }
      if (!teamDefenseUniverseIds.has(universeId)) {
        unmatched.push({ playerId: provider.id, name: provider.name, position: provider.position, reason: "no_team_defense_row" });
        continue;
      }
      matched.push({
        playerId: provider.id,
        nflPlayerId: universeId,
        method: CROSSWALK_METHOD.teamDefense,
        // A synthetic row's "name" is its own id, so the two sides can never be compared the way two
        // spellings of a person's name are. TRUE rather than false, because false is the audit
        // signal that says a human should look at a pair, and there is nothing here to look at.
        nameAgrees: true,
        providerName: provider.name,
        universeName: universeId,
      });
      continue;
    }
    const claimants = byEspnId.get(provider.id) ?? [];
    if (claimants.length === 0) {
      unmatched.push({ playerId: provider.id, name: provider.name, position: provider.position, reason: "no_espn_id" });
      continue;
    }
    if (claimants.length > 1) {
      unmatched.push({ playerId: provider.id, name: provider.name, position: provider.position, reason: "ambiguous_espn_id" });
      continue;
    }
    const person = claimants[0]!;
    const already = claimed.get(person.id);
    if (already !== undefined) {
      throw new Error(
        `Two league players resolve to ${person.name} (${person.id}): ${already} and ${provider.id}. ` +
          `One man's projection would be rendered on another man's screen.`,
      );
    }
    claimed.set(person.id, provider.id);
    matched.push({
      playerId: provider.id,
      nflPlayerId: person.id,
      method: CROSSWALK_METHOD.espnId,
      nameAgrees: comparableName(provider.name) === comparableName(person.name),
      providerName: provider.name,
      universeName: person.name,
    });
  }

  // `matchRateOfPeople` excludes every defence FROM BOTH SIDES OF THE RATIO, which it did not have
  // to do while a defence could never be matched at all. Now that it can, taking defences out of the
  // denominator alone would let this rate exceed 1 (two matched, one person, "200% of people
  // placed") — a headline number that is not merely wrong but impossible, which is the kind that
  // survives review because nobody reads past the percent sign. The numerator counts only edges
  // drawn by a PERSON's mechanism.
  const people = providers.filter((provider) => provider.position !== TEAM_DEFENSE_POSITION).length;
  const matchedPeople = matched.filter((match) => match.method !== CROSSWALK_METHOD.teamDefense).length;
  return {
    matched,
    unmatched,
    matchRate: providers.length === 0 ? null : matched.length / providers.length,
    matchRateOfPeople: people === 0 ? null : matchedPeople / people,
  };
}

/** One stored edge, or one stored absence. */
export interface CrosswalkRow {
  readonly playerId: string;
  readonly nflPlayerId: string | null;
  readonly method: string | null;
  readonly unmatchedReason: string | null;
  readonly resolvedAt: Date;
}

/** Every row a resolution implies — the matched and the unmatched together, because the table is
 *  a census of the league's players and not a list of the ones that worked. */
export function crosswalkRows(resolution: CrosswalkResolution, resolvedAt: Date): readonly CrosswalkRow[] {
  return [
    ...resolution.matched.map((match) => ({
      playerId: match.playerId,
      nflPlayerId: match.nflPlayerId,
      method: match.method,
      unmatchedReason: null,
      resolvedAt,
    })),
    ...resolution.unmatched.map((miss) => ({
      playerId: miss.playerId,
      nflPlayerId: null,
      method: null,
      unmatchedReason: miss.reason,
      resolvedAt,
    })),
  ];
}

const INSERT_CHUNK_ROWS = 2_000;

/**
 * Writes the crosswalk, replacing what each row said before.
 *
 * `onConflictDoUpdate` rather than `DoNothing`, which is the opposite of every writer in the
 * point-in-time store and correct for the same reason those are not: identity carries no `as_of`
 * (see the schema docblock), so there is no earlier belief to preserve. A player the release has
 * since listed should stop being unmatched, and a re-run is how that happens.
 */
export async function recordCrosswalk(db: Db, rows: readonly CrosswalkRow[]): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(start, start + INSERT_CHUNK_ROWS).map((row) => ({ ...row }));
    const result = await db
      .insert(playerCrosswalk)
      .values(chunk)
      .onConflictDoUpdate({
        target: playerCrosswalk.playerId,
        set: {
          nflPlayerId: sql`excluded.nfl_player_id`,
          method: sql`excluded.method`,
          unmatchedReason: sql`excluded.unmatched_reason`,
          resolvedAt: sql`excluded.resolved_at`,
        },
      })
      .returning({ playerId: playerCrosswalk.playerId });
    written += result.length;
  }
  return written;
}

/** Reads all three sides of the join out of the database, in the shape `resolveCrosswalk` takes. */
export async function crosswalkInputs(db: ReadonlyDb): Promise<{
  readonly providers: readonly ProviderPlayer[];
  readonly universe: readonly UniversePlayer[];
  readonly teamDefenses: ReadonlySet<string>;
}> {
  const providers = await db.select({ id: players.id, name: players.name, position: players.position }).from(players);
  // Only the people who carry the bridging id: two thirds of the universe cannot participate in
  // this join at all, and hauling 25,000 rows across to discard 8,000 of them in memory is a scan
  // the index can do instead.
  const universe = await db
    .select({ id: nflPlayers.id, espnId: nflPlayers.espnId, name: nflPlayers.name })
    .from(nflPlayers)
    .where(isNotNull(nflPlayers.espnId));
  // The synthetic rows are queried BY THE 32 IDS `team-codes.ts` mints rather than by a position or
  // a prefix filter, so this read cannot pick up anything the mapping does not know about. A club
  // whose row is missing comes back absent, which is exactly what `resolveCrosswalk` needs to refuse.
  const seeded = await db
    .select({ id: nflPlayers.id })
    .from(nflPlayers)
    .where(inArray(nflPlayers.id, [...everyTeamDefenseUniverseId()]));
  return { providers, universe, teamDefenses: new Set(seeded.map((row) => row.id)) };
}

/**
 * Writes the 32 synthetic team-defence universe rows, or confirms they are already there.
 *
 * A SYNTHETIC ROW IN A TABLE OF REAL PEOPLE, AND LABELLED AS ONE FROM EVERY ANGLE: the id carries
 * the `team-def:` prefix nothing else uses, the position is `DEF` which no real `nfl_players` row
 * carries (nflverse spells defenders `DE`, `LB`, `CB` and so on), and the name is the source's own
 * team code rather than a person's name. Nothing that reads this table looking for a person can pick
 * one of these up by accident, and the projection store's foreign key finally has somewhere to point
 * for the one position that has no person behind it.
 *
 * `onConflictDoNothing`: these rows carry no fact that can be corrected, so a re-run is a true
 * no-op and reports 0.
 */
export async function seedTeamDefenseUniverse(db: Db): Promise<number> {
  const rows = everyTeamDefenseUniverseId().map((id) => ({
    id,
    pfrId: null,
    espnId: null,
    name: id,
    position: TEAM_DEFENSE_POSITION,
    latestTeam: id.slice(TEAM_DEFENSE_UNIVERSE_PREFIX.length),
    rookieSeason: null,
    lastSeason: null,
  }));
  const written = await db.insert(nflPlayers).values(rows).onConflictDoNothing().returning({ id: nflPlayers.id });
  return written.length;
}

/**
 * The gsis id for one league player, or `null` when the crosswalk could not place him.
 *
 * `null` is the ONLY answer for an unplaced player and it is the caller's job to print a dash for
 * him. There is no fallback here, by design: the alternative to an id join is a name join, and the
 * one thing worse than a dash on a player's screen is another man's number.
 */
export async function nflPlayerIdFor(db: ReadonlyDb, playerId: string): Promise<string | null> {
  const [row] = await db
    .select({ nflPlayerId: playerCrosswalk.nflPlayerId })
    .from(playerCrosswalk)
    .where(eq(playerCrosswalk.playerId, playerId));
  return row?.nflPlayerId ?? null;
}

/** The same lookup for a set of players, for a surface that draws more than one. Unplaced players
 *  are ABSENT FROM THE MAP rather than present with a null, so `get` returning undefined has one
 *  meaning ("no number for him") instead of two. */
export async function nflPlayerIdsFor(
  db: ReadonlyDb,
  playerIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (playerIds.length === 0) return new Map();
  const rows = await db
    .select({ playerId: playerCrosswalk.playerId, nflPlayerId: playerCrosswalk.nflPlayerId })
    .from(playerCrosswalk)
    .where(inArray(playerCrosswalk.playerId, [...playerIds]));
  return new Map(
    rows.flatMap((row) => (row.nflPlayerId === null ? [] : [[row.playerId, row.nflPlayerId] as const])),
  );
}
