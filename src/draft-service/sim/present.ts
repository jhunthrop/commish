/**
 * NAMES FOR THE SUMMARY'S PLAYER IDS — the sim itself never resolves a name (it works purely in
 * `players.id` space, the same identity `simulateDrafts`' evidence pool already carries), so the
 * two read routes (`/api/draft/sim`, `/api/draft/sim/[simRunId]`) attach a small id → identity
 * directory alongside the raw summary rather than the summary re-shaping itself around display
 * concerns. One real DB read, never a fabricated name for an id the roster somehow lost.
 */
import { inArray } from "drizzle-orm";
import type { Db } from "@research/db/client";
import { players } from "@research/db/schema";
import type { StoredSimSummary } from "./types";

export interface PlayerIdentity {
  readonly name: string;
  readonly team: string;
}

export type PlayerDirectory = Readonly<Record<string, PlayerIdentity>>;

function idsFrom(summary: StoredSimSummary): readonly string[] {
  const flat = "bySlot" in summary ? summary.bySlot : [summary];
  const ids = new Set<string>();
  for (const one of flat) {
    for (const row of one.availability) {
      if (row.expectedBestAvailable !== null) ids.add(row.expectedBestAvailable.playerId);
      for (const fallback of row.fallbacks) ids.add(fallback.playerId);
    }
    for (const row of one.exposure) ids.add(row.playerId);
  }
  return [...ids];
}

export async function playerDirectoryFor(db: Db, summary: StoredSimSummary | null): Promise<PlayerDirectory> {
  if (summary === null) return {};
  const ids = idsFrom(summary);
  if (ids.length === 0) return {};
  const rows = await db.select({ id: players.id, name: players.name, team: players.nflTeam }).from(players).where(inArray(players.id, ids));
  return Object.fromEntries(rows.map((row) => [row.id, { name: row.name, team: row.team }]));
}
