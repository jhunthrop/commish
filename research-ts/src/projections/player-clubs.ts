// THE PLAYER'S CLUB, FROM THE DAILY LIST (Lane 122): the reference the Python writer
// (`research/pipeline/tank01/player_clubs.py`) is compared against in the `tank01-capture-harvest`
// parity case. The oracle never wrote a club after its seed (`seedPlayers`), so this is a mirror
// written for the comparison, not a port: the same rule in the oracle's own terms.
//
// THE RULE. Every player the newest stored player list (`tank01_player_list`) carries on one of the 32
// clubs gets that club on his existing `players` row. A player it carries as a free agent has no club:
// his row's club becomes NULL (Lane 123, B101; the list's `team` for him is his last club). Nothing is
// inserted or retired. A player the list does not carry keeps his row and his club, and so does a player
// whose code is not one of the 32. A cleared club counts as a change, under the same ceiling.
//
// The oracle's `players.nfl_team` is NOT NULL, as the research column was before revision 0018; the
// parity case drops that on its scratch database before it seeds (`research/parity/ts/cases.ts`), so the
// write is plain SQL rather than drizzle's typed update.
//
// THE CEILING. A read that would change more than `MAX_CLUB_CHANGES_PER_PASS` clubs writes none: a
// provider glitch, not a trade deadline (the most in any week from 2016 to 2025 was 15).
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { captureSnapshots, players } from "@research-ts/db/schema";
import { NFL_TEAM_ABBREVIATIONS } from "./capture-feeds";

export const MAX_CLUB_CHANGES_PER_PASS = 60;
const PLAYER_LIST_SOURCE = "tank01_player_list";
const CLUBS: ReadonlySet<string> = new Set(NFL_TEAM_ABBREVIATIONS);

/** A club, or null for a free agent: no club. */
export type Club = string | null;

export interface ClubChange {
  readonly playerId: string;
  readonly before: Club;
  readonly after: Club;
}

export interface ClubRefresh {
  readonly changes: readonly ClubChange[];
  readonly applied: boolean;
}

/** Each listed player's club by provider id, null for a free agent (whatever his `team` says); a player on
 * a code not among the 32 is left out. */
export function listedClubs(payload: unknown): ReadonlyMap<string, Club> {
  const out = new Map<string, Club>();
  if (!Array.isArray(payload)) return out;
  for (const raw of payload) {
    const record: Record<string, unknown> = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const { playerID: playerId, team: club } = record;
    if (typeof playerId !== "string" || playerId.trim() === "") continue;
    if (String(record.isFreeAgent ?? "").trim().toLowerCase() === "true") {
      out.set(playerId.trim(), null);
    } else if (typeof club === "string" && CLUBS.has(club)) {
      out.set(playerId.trim(), club);
    }
  }
  return out;
}

/** The stored players whose club the list names otherwise, in id order. */
export function clubChanges(stored: readonly { readonly id: string; readonly team: Club }[], listed: ReadonlyMap<string, Club>): readonly ClubChange[] {
  return stored
    .flatMap((row) => {
      if (!listed.has(row.id)) return [];
      const after = listed.get(row.id) ?? null;
      return after === row.team ? [] : [{ playerId: row.id, before: row.team, after }];
    })
    .sort((a, b) => (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0));
}

/** The newest stored list's clubs onto the stored players, none written past the ceiling. */
export async function refreshClubsFromLatestList(db: Db): Promise<ClubRefresh> {
  const [latest] = await db
    .select({ payload: captureSnapshots.payload })
    .from(captureSnapshots)
    .where(eq(captureSnapshots.source, PLAYER_LIST_SOURCE))
    .orderBy(desc(captureSnapshots.capturedAt), desc(captureSnapshots.id))
    .limit(1);
  if (latest === undefined) return { changes: [], applied: true };
  const listed = listedClubs(latest.payload);
  if (listed.size === 0) return { changes: [], applied: true };
  const stored = await db.select({ id: players.id, team: players.nflTeam }).from(players).where(inArray(players.id, [...listed.keys()]));
  const changes = clubChanges(stored, listed);
  if (changes.length > MAX_CLUB_CHANGES_PER_PASS) return { changes, applied: false };
  for (const change of changes) {
    await db.execute(sql`update ${players} set ${sql.identifier(players.nflTeam.name)} = ${change.after} where ${players.id} = ${change.playerId}`);
  }
  return { changes, applied: true };
}
