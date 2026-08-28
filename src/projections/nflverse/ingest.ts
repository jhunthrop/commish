import type { Db } from "@/db/client";
import { recordObservations } from "../store";
import { recordNflPlayers } from "../universe";
import type { NflverseClient } from "./client";
import { NFLVERSE_CONFIG } from "./config";
import { mapParticipation, participationObservations, weekAsOfFromSnapCounts } from "./map";
import { buildPlayerUniverse, mapNflPlayers, nflPlayerRows, type PlayerUniverse } from "./players";
import { mapStatLines, statLineObservations } from "./stat-lines";

/**
 * ONE SEASON, FROM RELEASE TO STORE — the sequence every script that touches nflverse runs.
 *
 * It exists because two scripts need it (the backfill and the report) and a second copy of an
 * ingestion is a second place for the `as_of` derivation to drift. The stamp is the whole point of
 * the store; two implementations of it, differing by a few hours, would make a backtest replayed by
 * one script disagree with the same backtest replayed by the other and nobody would know which was
 * honest.
 *
 * The universe is fetched ONCE and passed in, not fetched per season: it is a single seven-megabyte
 * release covering every year, and re-parsing it per season would be six downloads to answer the
 * same question.
 */

/** Everything one season's ingestion reports about itself, which the operator is expected to read. */
export interface SeasonIngestReport {
  readonly season: number;
  readonly participationRows: number;
  readonly statLines: number;
  /** How many observations were ACTUALLY new — a re-run of a landed ingestion reports 0. */
  readonly observationsWritten: number;
  /** Distinct skill-position people placed in the universe, over those the files listed. */
  readonly participationResolution: number | null;
  readonly statLineResolution: number | null;
  /** Everyone the universe could not place, named and counted. Never silently dropped. */
  readonly unresolved: readonly { readonly id: string; readonly name: string; readonly occurrences: number }[];
  /**
   * When each week's numbers became knowable, from that week's LAST game. Returned rather than
   * recomputed by the caller, because a replay's as-of moments must be derived from exactly the
   * same rows the ingestion was: two derivations of one stamp is how a leak gets in.
   */
  readonly weekAsOf: ReadonlyMap<number, Date>;
}

/** Fetches and stores the historical player universe. Run once, before any season. */
export async function ingestPlayerUniverse(db: Db, client: NflverseClient): Promise<PlayerUniverse> {
  const rows = await client.getCsv(NFLVERSE_CONFIG.releases.players, NFLVERSE_CONFIG.files.players);
  const universe = mapNflPlayers(rows);
  await recordNflPlayers(db, nflPlayerRows(universe));
  return buildPlayerUniverse(universe);
}

export async function ingestSeason(
  db: Db,
  client: NflverseClient,
  universe: PlayerUniverse,
  season: number,
): Promise<SeasonIngestReport> {
  const snapCounts = await client.getCsv(NFLVERSE_CONFIG.releases.snapCounts, `snap_counts_${season}.csv`);
  const playerWeek = await client.getCsv(NFLVERSE_CONFIG.releases.playerWeek, `stats_player_week_${season}.csv`);
  const weekAsOf = weekAsOfFromSnapCounts(snapCounts, NFLVERSE_CONFIG.publicationLagHours);

  const participation = mapParticipation({ snapCounts, playerWeek, universe });
  const statLines = mapStatLines({ playerWeek, weekAsOf, universe });

  const observationsWritten =
    (await recordObservations(db, participationObservations(participation.participation))) +
    (await recordObservations(db, statLineObservations(statLines.statLines)));

  const unresolved = new Map<string, { id: string; name: string; occurrences: number }>();
  for (const row of [...participation.unresolved, ...statLines.unresolved]) {
    const already = unresolved.get(row.id);
    unresolved.set(
      row.id,
      already === undefined ? { id: row.id, name: row.name, occurrences: row.occurrences } : { ...already, occurrences: already.occurrences + row.occurrences },
    );
  }

  return {
    season,
    participationRows: participation.participation.length,
    statLines: statLines.statLines.length,
    observationsWritten,
    participationResolution: participation.resolutionRate,
    statLineResolution: statLines.resolutionRate,
    unresolved: [...unresolved.values()],
    weekAsOf,
  };
}
