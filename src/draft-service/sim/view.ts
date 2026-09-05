/** The wire shape both sim read routes (`/api/draft/sim`, `/api/draft/sim/[simRunId]`) return —
 *  one place, so the two routes can never quietly diverge on what a "sim run" looks like over
 *  the wire. */
import type { Db } from "@/db/client";
import { playerDirectoryFor, type PlayerDirectory } from "./present";
import type { SimRunRow } from "./store";

export interface SimRunView {
  readonly id: string;
  readonly leagueId: string | null;
  readonly config: SimRunRow["config"];
  readonly status: SimRunRow["status"];
  readonly requestedAt: string;
  readonly finishedAt: string | null;
  readonly summary: SimRunRow["summary"];
  readonly error: string | null;
  /** Every player id the summary references, resolved to a name/team — the client never
   *  resolves an id itself. Empty until `summary` exists. */
  readonly players: PlayerDirectory;
}

export async function toSimRunView(db: Db, row: SimRunRow): Promise<SimRunView> {
  const players = await playerDirectoryFor(db, row.summary);
  return {
    id: row.id,
    leagueId: row.leagueId,
    config: row.config,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    summary: row.summary,
    error: row.error,
    players,
  };
}
