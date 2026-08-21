import { and, asc, eq } from "drizzle-orm";
import type { Db, DbTx, ReadonlyDb } from "@/db/client";
import { drafts, leagues, matchups, players, playerStatLines, scoringSettings } from "@/db/schema";
import type { Position, StatLine } from "@/domain/player";
import type { RosterSlotConfig } from "@/domain/roster";
import { PPR_SCORING } from "@/domain/scoring";
import { startersOf } from "@/league";
import { getLineup } from "@/league-service/lineups";
import { scoreLineup, type ScoringRules } from "@/scoring";
import type { ScoreCache } from "./score-cache";

/** No Redis connection needed: every existing caller of `finalizeWeek` keeps working untouched. */
const NOOP_SCORE_CACHE: Pick<ScoreCache, "invalidate"> = {
  invalidate: async () => {},
};

export type FinalizeResult =
  | { readonly ok: true; readonly weekNumber: number; readonly matchupsScored: number }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * `scoreTeamsForWeek` is always called (below, and here) with `teamIds` built from the exact
 * same matchup rows this reads back for, so every team it's asked about is guaranteed a score —
 * a missing entry would mean the two have silently drifted apart, which is a bug worth failing
 * loudly on rather than one a `?? 0` fallback would quietly turn into a wrong score written to
 * the season record.
 */
export function requireScore(scores: ReadonlyMap<string, number>, teamId: string): number {
  const score = scores.get(teamId);
  if (score === undefined) {
    throw new Error(`finalizeWeek: no computed score for team "${teamId}" — scoreTeamsForWeek and the matchup rows have drifted apart.`);
  }
  return score;
}

/** One team's week: the starters it fielded and what they were worth. */
async function scoreTeam(
  db: ReadonlyDb,
  teamId: string,
  weekNumber: number,
  slotConfig: readonly RosterSlotConfig[],
  positionById: ReadonlyMap<string, Position>,
  statLines: ReadonlyMap<string, StatLine>,
  rules: ScoringRules,
): Promise<number> {
  const lineup = await getLineup(db, { teamId, weekNumber, slotConfig });
  const starters = startersOf(lineup).flatMap((entry) => {
    if (entry.playerId === null) return [];
    const position = positionById.get(entry.playerId);
    return position === undefined ? [] : [{ playerId: entry.playerId, position }];
  });
  return scoreLineup({ starters, statLinesByPlayerId: statLines, settings: rules }).total;
}

/**
 * Every team named's current total for one league's week, from stored lineups and stored stat
 * lines. Shared by `finalizeWeek` (which writes the result to `matchups`) and the ingestion
 * worker (which only reads it, to publish a live `score.update` for a week still in progress) —
 * one scoring path so a mid-week live number and the eventual settled number are never computed
 * two different ways.
 */
export async function scoreTeamsForWeek(
  db: ReadonlyDb,
  leagueId: string,
  weekNumber: number,
  teamIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  const [league] = await db.select({ rosterSlots: leagues.rosterSlots }).from(leagues).where(eq(leagues.id, leagueId));
  if (league === undefined) return new Map();

  // The league's OWN rules, never a preset guessed from its name. The fallback covers a league
  // seeded without a settings row at all; `createLeague` always writes one.
  const [settings] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, leagueId));
  const rules: ScoringRules = settings ?? PPR_SCORING;

  const roster = await db.select({ id: players.id, position: players.position }).from(players);
  const positionById = new Map(roster.map((row) => [row.id, row.position]));
  const lines = await db.select().from(playerStatLines).where(eq(playerStatLines.week, weekNumber));
  const statLines = new Map(lines.map((line) => [line.playerId, line]));

  const scores = new Map<string, number>();
  for (const teamId of teamIds) {
    scores.set(teamId, await scoreTeam(db, teamId, weekNumber, league.rosterSlots, positionById, statLines, rules));
  }
  return scores;
}

/**
 * The SETTLEMENT write: stamps a week's matchups with the totals that will stand.
 *
 * This is the rollup half of the balance-as-rollup convention. `player_stat_lines` and
 * `lineup_slots` are the append-only source and stay authoritative; `matchups.home_score` is the
 * derived total, written once the week's games are over so standings, clinch math and the season
 * record read one number instead of recomputing a season of lineups on every page.
 *
 * Called ONLY by the ingestion worker, when a week transitions to final. The commissioner's
 * manual score button and its route were deleted in Plan B Task 8: with a live feed, scoring is
 * not a thing a person triggers, and leaving a manual override in place would let a commissioner
 * stamp a week the games had not finished.
 *
 * Re-running is safe and produces identical numbers, which is the whole reason re-ingestion
 * cannot double-count: every number here is recomputed from absolute stored values and
 * overwrites. Nothing accumulates — and re-running is not hypothetical: the worker's correction
 * sweep calls this again for a settled week inside its correction window, which is how a post-
 * final stat revision reaches `matchups` and the standings.
 *
 * THE SCORES ARE COMPUTED INSIDE THE TRANSACTION THAT WRITES THEM. `scoreTeamsForWeek` is four
 * queries plus one per team, and under read-committed each of them sees whatever was committed
 * when it ran: a `persistTick` landing in the middle used to mean a week settled from a snapshot
 * older than the data at write time. Reading the matchups, the lineups and the stat lines inside
 * the same transaction as the update makes the settled number a function of one consistent view.
 *
 * The matchup rows are read with an explicit `ORDER BY` and updated in that order. Postgres heap
 * order is not stable — the first UPDATE rewrites tuples and moves them — so two concurrent
 * copies of this function reading without an ORDER BY could take row locks on `matchups` in
 * opposite orders and deadlock (`40P01`). One agreed order makes that unrepresentable.
 *
 * `cache` is injected with a no-op default. When a real cache is supplied, this league/week's
 * cached live scores are dropped AFTER the settlement commits: they were computed from a week in
 * progress, and the numbers that stand now live in `matchups`.
 *
 * TWO DOORS, the same shape `joinLeagueInTx`/`joinLeague` (`@/league-service/join.ts`) and Task 4's
 * `removeReviewInTx`/`removeReview` (`@/review-service/reviews.ts`) already use: `finalizeWeekInTx`
 * below is the write itself, taking the caller's OWN `tx`, and this function is the one-door
 * wrapper that runs the guards, opens a fresh transaction and invalidates the cache once it
 * commits. The seam exists for `correctSettledWeek` (`./correction`): a correction's audit event
 * and its notices have to commit with the same re-settlement or not at all — Plan A's
 * write-ordering rule (ruling 3) is not negotiable, and a nested `db.transaction` is a savepoint
 * with different failure semantics, not the same transaction.
 *
 * THE GUARDS STAY OUTSIDE THE TRANSACTION, in `checkFinalizeGuards` below, run by BOTH doors
 * before either opens its own lock-taking work — the original property this function has always
 * had (see that function's own docblock for why), preserved rather than pulled inside the seam:
 * `correctSettledWeek` calls it itself, per league, before opening that league's own transaction,
 * exactly mirroring this wrapper's own order. `src/stats-pipeline` is gated at 100%, so both doors
 * are covered by construction: this wrapper's own tests exercise every guard and the write on
 * every path already, and `correction.test.ts` exercises the write again through its own caller.
 */
export async function finalizeWeek(
  db: Db,
  leagueId: string,
  weekNumber: number,
  cache: Pick<ScoreCache, "invalidate"> = NOOP_SCORE_CACHE,
): Promise<FinalizeResult> {
  const guardFailure = await checkFinalizeGuards(db, leagueId, weekNumber);
  if (guardFailure !== null) return guardFailure;

  const write = await db.transaction((tx) => finalizeWeekInTx(tx, leagueId, weekNumber));
  await cache.invalidate(leagueId, weekNumber);
  return { ok: true, weekNumber: write.weekNumber, matchupsScored: write.matchupsScored };
}

/** A guard's own refusal, or `null` once every check has passed. */
export type FinalizeGuardFailure = Extract<FinalizeResult, { readonly ok: false }>;

/**
 * The existence-and-eligibility checks a week's settlement — by the worker's own transition, OR
 * by an operator's later correction of an already-settled week — must pass before EITHER caller
 * takes a single lock. Read with plain `SELECT`s against a `ReadonlyDb`, never inside a
 * transaction: keeping these reads outside is what keeps a settlement attempt a leaf in the
 * codebase's lock order rather than a transaction that opens by touching `leagues`, `matchups` and
 * `drafts` before it ever reaches the row it actually needs to write. `finalizeWeek` calls this
 * once, itself, before opening its transaction; `correctSettledWeek` calls it once per league,
 * itself, before opening THAT league's transaction — the same order, twice.
 */
export async function checkFinalizeGuards(db: ReadonlyDb, leagueId: string, weekNumber: number): Promise<FinalizeGuardFailure | null> {
  const [league] = await db.select({ id: leagues.id }).from(leagues).where(eq(leagues.id, leagueId));
  if (league === undefined) return { ok: false, status: 404, reason: "That league doesn't exist." };

  // Guard order is "does this thing exist" before "is it allowed", so a week the league does not
  // have answers 404 whatever the state of its draft.
  const [exists] = await db
    .select({ weekNumber: matchups.weekNumber })
    .from(matchups)
    .where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, weekNumber)))
    .limit(1);
  if (exists === undefined) return { ok: false, status: 404, reason: "That week isn't part of this league's season." };

  // A league that has not drafted has no rosters, so every team would score zero and the
  // standings would show a season of phantom losses. An undrafted league is not behind on
  // scoring, it has not started.
  const [draft] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.leagueId, leagueId));
  if (draft?.status !== "complete") return { ok: false, status: 409, reason: "That league hasn't finished its draft yet." };

  return null;
}

export interface FinalizeWrite {
  readonly weekNumber: number;
  readonly matchupsScored: number;
}

/**
 * The write itself, inside the caller's OWN transaction, ASSUMING `checkFinalizeGuards` has
 * already passed for this exact `(leagueId, weekNumber)` — neither door calls this without having
 * called that first. Every write that used to live inside `finalizeWeek`'s `db.transaction`
 * callback lives here unchanged; nothing about the scoring or the write ordering is different for
 * either caller.
 */
export async function finalizeWeekInTx(tx: DbTx, leagueId: string, weekNumber: number): Promise<FinalizeWrite> {
  const week = await tx
    .select()
    .from(matchups)
    .where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, weekNumber)))
    .orderBy(asc(matchups.homeTeamId));

  const teamIds = [...new Set(week.flatMap((row) => [row.homeTeamId, row.awayTeamId]))];
  const scores = await scoreTeamsForWeek(tx, leagueId, weekNumber, teamIds);

  for (const row of week) {
    await tx
      .update(matchups)
      .set({ homeScore: requireScore(scores, row.homeTeamId), awayScore: requireScore(scores, row.awayTeamId) })
      .where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, weekNumber), eq(matchups.homeTeamId, row.homeTeamId)));
  }

  return { weekNumber, matchupsScored: week.length };
}
