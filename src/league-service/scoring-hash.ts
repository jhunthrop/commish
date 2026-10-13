// THE LEAGUE'S OWN SCORING HASH (peek document design §3.2, 2026-09-07) — `leagues.scoring_hash`
// is a cache of `scoring_settings`, and this module is the only place that fills it. The digest
// itself is `scoringHashOf` (`@research-ts/scoring`), one function shared by the document writer, the peek's
// reader and this write path, so a document can never be served to a league it was not scored for.
import { eq, inArray } from "drizzle-orm";
import type { Db, DbTx } from "@research-ts/db/client";
import { leagues, scoringSettings } from "@/db/schema";
import { PPR_SCORING } from "@research-ts/domain/scoring";
import { type ScoringRules } from "@research-ts/scoring";
import { scoringHashOf } from "@research-ts/scoring/hash";

/** One league's rules as stored, or the same `PPR_SCORING` fallback `playerSeason` has always used
 *  for a league whose settings row was never written. */
export function rulesOf(stored: ScoringRules | undefined): ScoringRules {
  return stored ?? PPR_SCORING;
}

/**
 * Writes one league's hash from the rules it is being given, and says whether the stored value
 * actually moved. `db` may be a transaction, so a caller writing the settings row and the hash
 * together commits them together: a league whose weights and whose hash could disagree, even
 * briefly, is a league that could be served another rule set's documents.
 */
export async function writeLeagueScoringHash(db: Db | DbTx, leagueId: string, rules: ScoringRules): Promise<{ readonly hash: string; readonly previous: string | null }> {
  const hash = scoringHashOf(rules);
  const [before] = await db.select({ hash: leagues.scoringHash }).from(leagues).where(eq(leagues.id, leagueId));
  const previous = before?.hash ?? null;
  if (previous !== hash) await db.update(leagues).set({ scoringHash: hash }).where(eq(leagues.id, leagueId));
  return { hash, previous };
}

/**
 * THE SELF-HEALING PASS: recomputes every league's hash from its own settings row and writes only
 * the ones that disagree, returning how many moved.
 *
 * WHY THE BACKFILL IS HERE AND NOT IN THE MIGRATION'S SQL. The digest is a sha256 over a canonical
 * JSON of `real` weights, and reproducing JavaScript's own formatting of a float4 inside Postgres is
 * the kind of agreement that holds until the day it quietly does not, at which point every league
 * would join to documents built under a hash nothing else computes. Computing it in the one language
 * that already owns `scoringHashOf` removes the second implementation entirely.
 *
 * It runs from the peek-document rebuild job's first step, so a deploy heals itself on the first
 * event rather than waiting for an operator, and it is idempotent by construction: a second run over
 * unchanged settings writes nothing and returns zero.
 */
export async function backfillLeagueScoringHashes(db: Db): Promise<number> {
  const rows = await db
    .select({ id: leagues.id, stored: leagues.scoringHash, settings: scoringSettings })
    .from(leagues)
    .leftJoin(scoringSettings, eq(scoringSettings.leagueId, leagues.id));
  const wanted = rows.map((row) => ({ id: row.id, stored: row.stored, hash: scoringHashOf(rulesOf(row.settings ?? undefined)) }));

  let moved = 0;
  for (const [hash, ids] of groupByHash(wanted)) {
    await db.update(leagues).set({ scoringHash: hash }).where(inArray(leagues.id, ids));
    moved += ids.length;
  }
  return moved;
}

/** The leagues whose stored hash disagrees with the one their settings imply, grouped so the write
 *  is one statement per distinct hash rather than one per league. */
function groupByHash(rows: readonly { readonly id: string; readonly stored: string | null; readonly hash: string }[]): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    if (row.stored === row.hash) continue;
    const ids = grouped.get(row.hash);
    if (ids === undefined) grouped.set(row.hash, [row.id]);
    else ids.push(row.id);
  }
  return grouped;
}

/** Every scoring hash a league is currently using — the "every hash" of the design's event table
 *  (§3.4). One read, and a league whose hash has never been computed is honestly absent from it
 *  rather than counted under someone else's rules. */
export async function scoringHashesInUse(db: Db | DbTx): Promise<readonly string[]> {
  const rows = await db.selectDistinct({ hash: leagues.scoringHash }).from(leagues);
  return rows.flatMap((row) => (row.hash === null ? [] : [row.hash]));
}
