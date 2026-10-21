// THE PLAYER'S CLUB, FROM THE DAILY LIST (Lane 122): the reference the Python writer
// (`research/pipeline/tank01/player_clubs.py`) is compared against in the `tank01-capture-harvest`
// parity case. The oracle never wrote a club after its seed (`seedPlayers`), so this is a mirror
// written for the comparison, not a port: the same rule in the oracle's own terms.
//
// THE RULE. Every player the newest stored player list (`tank01_player_list`) carries on one of the 32
// clubs gets that club on his existing `players` row. Nothing is inserted or retired. A player the list
// does not carry keeps his row and his club, and so does a free agent (the list's `team` for him is his
// last club) and a player whose code is not one of the 32.
//
// THE CEILING. A read that would change more than `MAX_CLUB_CHANGES_PER_PASS` clubs writes none: a
// provider glitch, not a trade deadline (the most in any week from 2016 to 2025 was 15).
import { desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { captureSnapshots, players } from "@research-ts/db/schema";
import { NFL_TEAM_ABBREVIATIONS } from "./capture-feeds";

export const MAX_CLUB_CHANGES_PER_PASS = 60;
const PLAYER_LIST_SOURCE = "tank01_player_list";
const CLUBS: ReadonlySet<string> = new Set(NFL_TEAM_ABBREVIATIONS);

export interface ClubChange {
  readonly playerId: string;
  readonly before: string;
  readonly after: string;
}

export interface ClubRefresh {
  readonly changes: readonly ClubChange[];
  readonly applied: boolean;
}

/** Each player's club on the list, by provider id: a free agent, or a code not among the 32, is left out. */
export function listedClubs(payload: unknown): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(payload)) return out;
  for (const raw of payload) {
    const record: Record<string, unknown> = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const { playerID: playerId, team: club } = record;
    const freeAgent = String(record.isFreeAgent ?? "").trim().toLowerCase() === "true";
    if (typeof playerId === "string" && playerId.trim() !== "" && typeof club === "string" && CLUBS.has(club) && !freeAgent) {
      out.set(playerId.trim(), club);
    }
  }
  return out;
}

/** The stored players whose club the list names otherwise, in id order. */
export function clubChanges(stored: readonly { readonly id: string; readonly team: string }[], listed: ReadonlyMap<string, string>): readonly ClubChange[] {
  return stored
    .flatMap((row) => {
      const after = listed.get(row.id);
      return after === undefined || after === row.team ? [] : [{ playerId: row.id, before: row.team, after }];
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
    await db.update(players).set({ nflTeam: change.after }).where(eq(players.id, change.playerId));
  }
  return { changes, applied: true };
}
