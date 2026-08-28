import type { Position } from "@/domain/player";
import type { CsvRow } from "./csv";

/**
 * THE HISTORICAL PLAYER UNIVERSE — everyone who has ever played, resolved by ID rather than by name.
 *
 * Phase 1 joined nflverse to our `players` table on name, position and team, and measured exactly
 * what that costs: 98.1% of 2024 resolved, 87.1% of 2023, degrading the further back a backfill
 * reached. The cause was never the matching — it was the spine. `players` is a CURRENT roster
 * snapshot, so a man who has retired is genuinely absent from it, and a model that needs five
 * seasons cannot be built on a table that only knows this one.
 *
 * nflverse publishes its own `players` release, which holds every player back to 1999 with the
 * NFL's own `gsis_id` and Pro Football Reference's `pfr_id`. Both files we ingest carry one of
 * those two ids — `stats_player_week` the gsis id, `snap_counts` the pfr id — so identity becomes
 * an ID JOIN and this whole class of problem retires. The fixture proves the point better than any
 * argument: it contains two men named Josh Allen, a quarterback and a centre who retired in 2016.
 * A name join has to guess between them. This never sees the name.
 *
 * What survives from Phase 1 is the REPORTING discipline, not the matching: nothing here silently
 * drops a row. An unresolved candidate comes back named and counted, because an absent player is
 * otherwise indistinguishable from one who did not play, and a join that quietly loses eight
 * percent of receivers looks like a lot of healthy scratches rather than like a bug.
 */

/** One person in the universe. `id` is the gsis id and is the id the whole engine keys on. */
export interface NflPlayer {
  readonly id: string;
  /** Pro Football Reference's id — the ONLY way into the snap-counts file. Null when unlisted. */
  readonly pfrId: string | null;
  /**
   * ESPN's own player id — the ONLY way to the roster this product drafts from, whose stats
   * provider numbers players in ESPN's space. Null for roughly a third of the universe, mostly
   * people who never appeared in a game. See `nfl_players.espn_id` and `crosswalk.ts`.
   */
  readonly espnId: string | null;
  readonly name: string;
  /** nflverse's own spelling, not narrowed — see `projectedPosition` for why. */
  readonly position: string;
  readonly latestTeam: string | null;
  readonly rookieSeason: number | null;
  readonly lastSeason: number | null;
}

function text(row: CsvRow, column: string): string | null {
  const raw = row[column];
  return raw === undefined || raw.trim() === "" ? null : raw.trim();
}

function season(row: CsvRow, column: string): number | null {
  const raw = text(row, column);
  if (raw === null) return null;
  const value = Number(raw);
  // 0 appears in the release for players with no recorded season, and it is not a year. Reading it
  // as one would put a 1970 rookie in the universe and make any "seasons of experience" feature
  // built on this column quietly wrong for exactly those players.
  return Number.isInteger(value) && value > 1900 ? value : null;
}

/**
 * Reads the `players` release into universe rows.
 *
 * Throws on a row with no `gsis_id` rather than skipping it, because a player without the id every
 * other feed keys on cannot be joined to anything, and a silent skip here would surface later as an
 * unexplained hole in the resolution rate rather than as a schema change upstream.
 */
export function mapNflPlayers(rows: readonly CsvRow[]): readonly NflPlayer[] {
  return rows.map((row) => {
    const id = text(row, "gsis_id");
    if (id === null) {
      throw new Error(
        `An nflverse players row has no gsis_id (${JSON.stringify(text(row, "display_name") ?? "unnamed")}); the universe is keyed on it.`,
      );
    }
    const name = text(row, "display_name");
    const position = text(row, "position");
    if (name === null || position === null) {
      throw new Error(`nflverse player ${id} has no display_name or position; the players release schema has moved.`);
    }
    return {
      id,
      pfrId: text(row, "pfr_id"),
      espnId: text(row, "espn_id"),
      name,
      position,
      latestTeam: text(row, "latest_team"),
      rookieSeason: season(row, "rookie_season"),
      lastSeason: season(row, "last_season"),
    };
  });
}

/**
 * nflverse's position spelling narrowed to the four this engine projects, or `null` for everyone
 * else.
 *
 * The universe deliberately holds linemen — they are a third of the offensive snap denominator and
 * dropping them would inflate every share by roughly half — so most of it narrows to nothing, and
 * that is the correct answer rather than a failure.
 *
 * FB is the one real translation: nflverse calls Kyle Juszczyk a fullback, the snap-counts file
 * calls him a running back, and every fantasy scoring system in existence treats him as one. A
 * handful of players carry a position from a later career move (a tight end the release now lists
 * as a linebacker); they narrow to null and drop out, which is the honest outcome for a person we
 * cannot confidently score.
 */
export function projectedPosition(nflversePosition: string): Position | null {
  switch (nflversePosition) {
    case "QB":
      return "QB";
    case "RB":
    case "FB":
    case "HB":
      return "RB";
    case "WR":
      return "WR";
    case "TE":
      return "TE";
    default:
      return null;
  }
}

/** Which id space a candidate is speaking in. The two files use different ones. */
export type PlayerIdKind = "gsis" | "pfr";

/** A reference to a person from one of the ingested files. `name` is for the report, never the join. */
export interface PlayerRef {
  readonly kind: PlayerIdKind;
  readonly id: string;
  readonly name: string;
}

export interface UnresolvedRef extends PlayerRef {
  /** How many rows wanted this person — a star missing from eighteen weeks is not a stray. */
  readonly occurrences: number;
}

export interface UniverseResolution {
  /** Candidate id → `nfl_players.id`, for everyone who resolved. */
  readonly resolved: ReadonlyMap<string, string>;
  readonly unresolved: readonly UnresolvedRef[];
  /**
   * Matched people over distinct people, or `null` for an empty input — never `1`, following
   * `metrics.ts`' rule that a sample which cannot answer says so. This is the figure the plan's
   * stop condition is written against.
   */
  readonly resolutionRate: number | null;
}

export interface PlayerUniverse {
  byGsisId(id: string): NflPlayer | null;
  byPfrId(id: string): NflPlayer | null;
  resolveAll(refs: readonly PlayerRef[]): UniverseResolution;
}

export function buildPlayerUniverse(universe: readonly NflPlayer[]): PlayerUniverse {
  const byGsis = new Map<string, NflPlayer>();
  const byPfr = new Map<string, NflPlayer>();
  for (const player of universe) {
    if (byGsis.has(player.id)) {
      throw new Error(`The nflverse players release lists gsis id ${player.id} twice; the universe cannot be keyed on it.`);
    }
    byGsis.set(player.id, player);
    if (player.pfrId === null) continue;
    const claimed = byPfr.get(player.pfrId);
    // Refuses rather than picking one, for the reason Phase 1's coherence check existed: two people
    // sharing an id means a whole season of one man's snaps written onto another, and that error is
    // invisible forever after. `nfl_players_pfr_id_idx` enforces the same thing in Postgres; this
    // catches it before the insert, where the message can name both men.
    if (claimed !== undefined) {
      throw new Error(
        `nflverse pfr id ${player.pfrId} is claimed by both ${claimed.name} (${claimed.id}) and ${player.name} (${player.id}).`,
      );
    }
    byPfr.set(player.pfrId, player);
  }

  const lookup = (ref: PlayerRef): NflPlayer | null =>
    (ref.kind === "gsis" ? byGsis.get(ref.id) : byPfr.get(ref.id)) ?? null;

  return {
    byGsisId: (id) => byGsis.get(id) ?? null,
    byPfrId: (id) => byPfr.get(id) ?? null,

    resolveAll(refs) {
      const resolved = new Map<string, string>();
      const unresolved = new Map<string, UnresolvedRef>();
      for (const ref of refs) {
        if (resolved.has(ref.id)) continue;
        const already = unresolved.get(ref.id);
        if (already !== undefined) {
          unresolved.set(ref.id, { ...already, occurrences: already.occurrences + 1 });
          continue;
        }
        const player = lookup(ref);
        if (player === null) unresolved.set(ref.id, { ...ref, occurrences: 1 });
        else resolved.set(ref.id, player.id);
      }
      const distinct = resolved.size + unresolved.size;
      return { resolved, unresolved: [...unresolved.values()], resolutionRate: distinct === 0 ? null : resolved.size / distinct };
    },
  };
}

/** The `nfl_players` insert shape. One place the column names are spelled, so a rename fails here. */
export interface NflPlayerRow {
  readonly id: string;
  readonly pfrId: string | null;
  readonly espnId: string | null;
  readonly name: string;
  readonly position: string;
  readonly latestTeam: string | null;
  readonly rookieSeason: number | null;
  readonly lastSeason: number | null;
}

export function nflPlayerRows(universe: readonly NflPlayer[]): readonly NflPlayerRow[] {
  return universe.map((player) => ({ ...player }));
}
