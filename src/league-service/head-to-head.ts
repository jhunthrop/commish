import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@research/db/client";
import { matchups } from "@/db/schema";
import { headToHeadKey, LEAGUE_CONFIG, type HeadToHeadRecord } from "@/league";
import type { HeadToHeadCache } from "./head-to-head-cache";

/** The season every settled game in this product belongs to — see `HeadToHeadRecord.seasons`. */
function currentSeason(): number {
  return new Date(LEAGUE_CONFIG.season.startedAt).getUTCFullYear();
}

interface Tally {
  wins: number;
  losses: number;
  ties: number;
}

function tallyFor(records: Map<string, Tally>, key: string): Tally {
  const held = records.get(key);
  if (held !== undefined) return held;
  const fresh: Tally = { wins: 0, losses: 0, ties: 0 };
  records.set(key, fresh);
  return fresh;
}

/**
 * EVERY PAIR'S HISTORY IN THIS LEAGUE, IN ONE QUERY (P6: "the history between the two of you is
 * one tap away and stated in plain numbers"). Read whole rather than per-pair: a league's settled
 * matchups are bounded by its schedule (a dozen teams over a season is under a hundred rows), and
 * one read that every member of the room can share is strictly cheaper than one read per viewer
 * per card — which is also what makes a single per-league cache entry correct.
 *
 * SETTLED MEANS BOTH SCORES ARE WRITTEN. `finalizeWeekInTx` writes the pair together in one
 * transaction, so a row with one score is a row mid-write or mid-correction, and counting it
 * would invent a result. A pair with no settled game gets NO ENTRY here, never a `0 and 0`:
 * absence renders as absence (P11), and a zero record would render as data.
 */
export async function headToHeadRecords(db: Db, leagueId: string): Promise<ReadonlyMap<string, HeadToHeadRecord>> {
  const rows = await db
    .select({
      homeTeamId: matchups.homeTeamId,
      awayTeamId: matchups.awayTeamId,
      homeScore: matchups.homeScore,
      awayScore: matchups.awayScore,
    })
    .from(matchups)
    .where(and(eq(matchups.leagueId, leagueId), isNotNull(matchups.homeScore), isNotNull(matchups.awayScore)));

  const tallies = new Map<string, Tally>();
  for (const row of rows) {
    // Both scores are non-null by the predicate above; the casts are the query's own guarantee.
    const homeScore = row.homeScore as number;
    const awayScore = row.awayScore as number;
    const home = tallyFor(tallies, headToHeadKey(row.homeTeamId, row.awayTeamId));
    const away = tallyFor(tallies, headToHeadKey(row.awayTeamId, row.homeTeamId));
    if (homeScore > awayScore) {
      home.wins += 1;
      away.losses += 1;
    } else if (awayScore > homeScore) {
      away.wins += 1;
      home.losses += 1;
    } else {
      home.ties += 1;
      away.ties += 1;
    }
  }

  const seasons = [currentSeason()];
  const records = new Map<string, HeadToHeadRecord>();
  for (const [key, tally] of tallies) records.set(key, { ...tally, seasons });
  return records;
}

/**
 * ONE TEAM'S OWN PAIRINGS, keyed by the OPPONENT's team id.
 *
 * The whole-league map is keyed by a composite `team|opponent` string, which is right for a cache
 * entry the room shares and wrong for the wire: room code may not value-import a pure `@/league`
 * module (the client boundary, `docs/league.md`), so a card holding composite keys would have to
 * spell the separator itself — the same key written in two places, which is how two places stop
 * agreeing. Narrowed HERE instead, server-side, so the card does `get(theirTeamId)` and nothing
 * about the key shape ever crosses the boundary. A commissioner with no team of their own gets an
 * empty map, which the card renders as no line at all.
 */
export function recordsForTeam(
  records: ReadonlyMap<string, HeadToHeadRecord>,
  teamId: string | null,
): ReadonlyMap<string, HeadToHeadRecord> {
  const mine = new Map<string, HeadToHeadRecord>();
  if (teamId === null) return mine;
  const prefix = headToHeadKey(teamId, "");
  for (const [key, record] of records) {
    if (!key.startsWith(prefix)) continue;
    mine.set(key.slice(prefix.length), record);
  }
  return mine;
}

/**
 * The read the room actually makes: the cached answer for this league and week, computed and
 * stored on a miss. Per league AND week because settlement is what changes the answer and
 * settlement names a week — see `LEAGUE_CONFIG.headToHead`'s own docblock for why the week is in
 * the key rather than a version in the value.
 *
 * The cache is a parameter with a do-nothing default rather than a module import, so the room
 * page wires the process-wide instance and a test wires nothing at all and still exercises the
 * real query.
 */
export async function cachedHeadToHeadRecords(
  db: Db,
  leagueId: string,
  week: number,
  cache: Pick<HeadToHeadCache, "read" | "write"> = PASSTHROUGH_CACHE,
): Promise<ReadonlyMap<string, HeadToHeadRecord>> {
  const held = await cache.read(leagueId, week);
  if (held !== null) return held;
  const records = await headToHeadRecords(db, leagueId);
  await cache.write(leagueId, week, records);
  return records;
}

/** Always a miss, never a write: what "no cache is wired" means, spelled rather than branched. */
const PASSTHROUGH_CACHE: Pick<HeadToHeadCache, "read" | "write"> = {
  read: async () => null,
  write: async () => {},
};
