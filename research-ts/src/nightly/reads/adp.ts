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
 *  no capture yet comes back empty with a null instant, which the ADP gate names. */
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
    captures.push({ format: capture.format, source: capture.source, capturedAt, adpByPlayerId: new Map(rows.map((row) => [row.playerId, row.adp] as const)) });
  }
  return captures;
}
