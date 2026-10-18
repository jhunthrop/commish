import { and, eq, max } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { adpSnapshots, playerCrosswalk } from "@research-ts/db/schema";
import { ADP_SNAPSHOT_CAPTURES } from "@research-ts/projections/market/adp-snapshot";
import type { BoardFormat } from "@research-ts/projections/preseason/board-formats";

/** One format's newest ADP capture, in product player ids. */
export interface AdpCapture {
  readonly format: BoardFormat;
  readonly source: string;
  readonly capturedAt: Date | null;
  /** Product player id to ADP, for every captured player the crosswalk resolves. */
  readonly adpByPlayerId: ReadonlyMap<string, number>;
}

async function newestCapture(db: Db, source: string, snapshotFormat: string): Promise<Date | null> {
  const [row] = await db
    .select({ capturedAt: max(adpSnapshots.capturedAt) })
    .from(adpSnapshots)
    .where(and(eq(adpSnapshots.source, source), eq(adpSnapshots.format, snapshotFormat)));
  return row?.capturedAt ?? null;
}

/** The newest capture of every format the ADP snapshot job records (`adp_snapshots`). A format with
 *  no capture yet comes back empty with a null instant, which the ADP gate (`gates.ts`, `adp_missing`) fails the run on. */
export async function readLatestAdp(db: Db): Promise<readonly AdpCapture[]> {
  const captures: AdpCapture[] = [];
  for (const capture of ADP_SNAPSHOT_CAPTURES) {
    const capturedAt = await newestCapture(db, capture.source, capture.snapshotFormat);
    if (capturedAt === null) {
      captures.push({ format: capture.format, source: capture.source, capturedAt: null, adpByPlayerId: new Map() });
      continue;
    }
    const rows = await db
      .select({ playerId: playerCrosswalk.playerId, adp: adpSnapshots.adp })
      .from(adpSnapshots)
      .innerJoin(playerCrosswalk, eq(playerCrosswalk.nflPlayerId, adpSnapshots.playerId))
      .where(and(eq(adpSnapshots.source, capture.source), eq(adpSnapshots.format, capture.snapshotFormat), eq(adpSnapshots.capturedAt, capturedAt)));
    captures.push({ format: capture.format, source: capture.source, capturedAt, adpByPlayerId: placeCapture(rows) });
  }
  return captures;
}

/** A capture by player id. When two rows reach one player the lower ADP wins, whatever order the rows
 *  arrive in: the one rule the api's room read (`min(adp)`, api/internal/boards/market.go) and the Python
 *  nightly (`place_capture`, research/nightly/reads/adp.py) share, so the three readers agree. */
export function placeCapture(rows: readonly { playerId: string; adp: number }[]): ReadonlyMap<string, number> {
  const placed = new Map<string, number>();
  for (const row of rows) {
    const held = placed.get(row.playerId);
    if (held === undefined || row.adp < held) placed.set(row.playerId, row.adp);
  }
  return placed;
}
