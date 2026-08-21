import { and, eq } from "drizzle-orm";
import type { Db, DbTx, ReadonlyDb } from "@/db/client";
import { leagues, matchups, statWeeks, teams } from "@/db/schema";
import type { StatLine } from "@/domain/player";
import type { Clock } from "@/domain/timing";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { attachAuditEvent, notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import type { StatWeekCorrectionOutcome } from "@/integrity/notices";
import type { SystemActionCode } from "@/integrity/system-actions";
import type { StatsProvider } from "@/stats/provider";
import type { ReservationDenial, RequestBudget } from "./budget";
import { checkFinalizeGuards, finalizeWeekInTx } from "./finalize";
import { getIngestionBudget, getStatsProvider } from "./index";
import { persistTick } from "./persist";

const systemClock: Clock = { now: () => new Date().toISOString() };

/** The one action code this module ever writes. `SYSTEM_ACTION_SUMMARY_ALLOWED` says `true` for
 *  it — checked at compile time by the assignment, not merely asserted in a test. */
const ACTION: SystemActionCode = "stat_week_corrected";

export interface CorrectSettledWeekInput {
  /** Operator-chosen, no hard limit (founder decision #11) — never derived from
   *  `correctionCandidate`'s three-day window, which this path exists to go around. */
  readonly week: number;
  /** The operator's own `users.id`, mirroring `grantAdmin`'s `grantedBy` — recorded as the
   *  `system_action` event's `actorId` so the correction is accountable to a real person, even
   *  though the copy every member reads speaks in the platform's own voice ("we"), never theirs. */
  readonly by: string;
  readonly clock?: Clock;
  /** Defaults to the process-wide provider (`getStatsProvider()`), the same one the worker uses. */
  readonly provider?: StatsProvider;
  /** Defaults to the process-wide ledger (`getIngestionBudget()`) — the SAME monthly key the
   *  worker debits. This is a third spender against one ceiling, not a second ledger. */
  readonly budget?: RequestBudget;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
  /** Defaults to the real `notifyAffectedMember`. Injectable so a test can force its failure. */
  readonly notify?: typeof notifyAffectedMember;
}

/** One league this run tried to correct, and how it went. Never thrown — a per-league failure is
 *  reported here, alongside every league that committed, rather than losing the rest of the run. */
export interface FailedLeagueCorrection {
  readonly leagueId: string;
  readonly reason: string;
}

export type CorrectionResult =
  | {
      readonly ok: true;
      readonly week: number;
      /** `false` when the provider's numbers matched exactly what Postgres already held —
       *  `persistTick`'s own arbiter, never a diff this module computes itself. */
      readonly changed: boolean;
      /** How many leagues actually committed a re-settlement (founder decision #11: EVERY league
       *  fielding the week is attempted, not only leagues with a team that moved) — zero when
       *  `changed` is `false`, and can be fewer than "every league fielding this week" when a
       *  league turns out undrafted (skipped, not a failure) or its own transaction fails (see
       *  `leaguesFailed`). */
      readonly leaguesResettled: number;
      /** Of the leagues that committed, how many actually had at least one team's result move —
       *  the only ones that got a `system_action` and any notices. Can be smaller than
       *  `leaguesResettled`: a league that re-settles to byte-identical numbers is still
       *  re-settled, but records nothing, because a row claiming it changed something would be a
       *  lie. See `correctLeagueInTx`. */
      readonly leaguesChanged: number;
      /** Every league whose OWN transaction threw and rolled back, by id and reason — never
       *  silently dropped. A league failing here does not stop the rest of the week's leagues
       *  from being attempted; each league's correction is independent. */
      readonly leaguesFailed: readonly FailedLeagueCorrection[];
    }
  | { readonly ok: false; readonly reason: string };

/** Mirrors `worker.ts`'s own `DENIAL_REASONS`, in this module's own words: an operator correction
 *  reserving nothing has WRITTEN nothing, which is the property this copy states plainly. */
const CORRECTION_DENIAL_REASONS: Readonly<Record<ReservationDenial, string>> = {
  "budget-exhausted": "This month's upstream request budget is spent, so nothing has been read or written.",
  "ledger-unavailable": "The request ledger is unreachable, so nothing has been read or written. Try again once Redis is back.",
};

type MatchupResult = "win" | "loss" | "tie";

/** A team's result from its own score and its opponent's. Exported and directly unit-tested —
 *  see `correction.test.ts` — rather than only exercised through a full settlement fixture. */
export function matchupResultFor(mine: number, theirs: number): MatchupResult {
  if (mine > theirs) return "win";
  if (mine < theirs) return "loss";
  return "tie";
}

/**
 * The three fixed clauses `stat_week_corrected`'s `outcome` field may say, resolved from a team's
 * before/after result. Only a transition INTO a clean win or a clean loss ever says one of the
 * other two clauses; every other transition — including a rare one THROUGH a tie (a downgrade
 * from a win, or an upgrade from a loss; two float scores matching exactly is unusual) — falls
 * back to "stays the same", the one clause that is never actively wrong about a result that did
 * not become a definite win or a definite loss.
 */
export function correctionOutcome(before: MatchupResult, after: MatchupResult): StatWeekCorrectionOutcome {
  if (after === "win" && before !== "win") return "that turns your matchup into a win";
  if (after === "loss" && before !== "loss") return "that turns your matchup into a loss";
  return "your matchup result stays the same";
}

/** Every league fielding this week, from `matchups` — the same "matchups is the source of truth
 *  for which leagues are in season" the worker's own `leaguesInWeek` uses, sorted for a
 *  deterministic per-league transaction order. */
async function leaguesInWeek(db: Db, week: number): Promise<readonly string[]> {
  const rows = await db.selectDistinct({ leagueId: matchups.leagueId }).from(matchups).where(eq(matchups.weekNumber, week));
  return rows.map((row) => row.leagueId).sort();
}

interface TeamState {
  readonly points: number;
  readonly result: MatchupResult;
}

/** One league/week's matchup rows, reduced to a per-team points-and-result map. `null` scores
 *  (a matchup this settled week somehow never scored) are skipped rather than guessed at. */
async function teamStatesFor(db: ReadonlyDb, leagueId: string, week: number): Promise<ReadonlyMap<string, TeamState>> {
  const rows = await db
    .select({ homeTeamId: matchups.homeTeamId, awayTeamId: matchups.awayTeamId, homeScore: matchups.homeScore, awayScore: matchups.awayScore })
    .from(matchups)
    .where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, week)));

  const states = new Map<string, TeamState>();
  for (const row of rows) {
    if (row.homeScore === null || row.awayScore === null) continue;
    states.set(row.homeTeamId, { points: row.homeScore, result: matchupResultFor(row.homeScore, row.awayScore) });
    states.set(row.awayTeamId, { points: row.awayScore, result: matchupResultFor(row.awayScore, row.homeScore) });
  }
  return states;
}

const LEAGUE_WIDE_SUMMARY = (week: number): string =>
  `We corrected week ${week} scores after our stats provider revised its numbers. Standings now match the update.`;

/**
 * One league, one transaction, one league chain (Plan A ruling 3): capture each team's stored
 * result, `finalizeWeekInTx`, compare, write the notices for the managers who moved, then the
 * anchor, then `attachAuditEvent` — the exact write ordering `removeReviewInTx` and
 * `removeChatMessageInTx` already use (notice(s) before the anchor, whose FK-taking inserts must
 * land before the lock the anchor append takes, and the anchor always last).
 *
 * `finalizeWeekInTx` always runs, unconditionally — founder decision #11's "always re-settling" is
 * a claim about the WRITE. The `system_action` anchor and every notice are conditional on this
 * league's OWN before/after diff finding at least one team whose points actually moved (fix round
 * 1, HIGH — this used to fire for every resettled league regardless): a league that recomputes to
 * byte-identical numbers has still been re-settled, honestly, but a `system_action` row for it
 * would say an operator acted on this league when nothing about it changed, which is exactly the
 * false record this phase exists to prevent — the same reasoning `correctSettledWeek`'s own
 * `changed: false` early return already applies at the whole-week level, applied here per league.
 *
 * ASSUMES `checkFinalizeGuards` has already passed for `(leagueId, week)` — the caller's job, done
 * BEFORE this function's transaction opens (see `finalize.ts`'s own docblock on why the guards
 * stay outside every transaction that reaches this write). Any error thrown here — `notify`,
 * `audit.record`, or the write itself — propagates to the caller with the whole transaction rolled
 * back; `attemptLeague` below is what turns that into a reported failure instead of an unhandled
 * rejection.
 *
 * Returns whether this league's diff found real movement — the caller's `changed` accounting.
 */
async function correctLeagueInTx(
  tx: DbTx,
  leagueId: string,
  week: number,
  by: string,
  clock: Clock,
  audit: AuditLogger,
  notify: typeof notifyAffectedMember,
): Promise<boolean> {
  const before = await teamStatesFor(tx, leagueId, week);
  await finalizeWeekInTx(tx, leagueId, week);
  const after = await teamStatesFor(tx, leagueId, week);

  const moved: { readonly teamId: string; readonly before: TeamState; readonly after: TeamState }[] = [];
  for (const [teamId, afterState] of after) {
    const beforeState = before.get(teamId);
    // `undefined` when this league's week was never previously scored (a matchup row can predate
    // its own first settlement) — nothing to compare against, so nothing to report as "moved".
    if (beforeState === undefined || beforeState.points === afterState.points) continue;
    moved.push({ teamId, before: beforeState, after: afterState });
  }

  if (moved.length === 0) return false;

  // `leagues.id` is what `matchups.leagueId` (the source of `leagueId`, via `leaguesInWeek`) is
  // a NOT NULL foreign key to, so this row always exists.
  const [league] = await tx.select({ name: leagues.name }).from(leagues).where(eq(leagues.id, leagueId));
  const leagueName = league!.name;

  const notices: MemberNotice[] = [];
  for (const { teamId, before: beforeState, after: afterState } of moved) {
    // `teams.id` is what `matchups.homeTeamId`/`awayTeamId` are a NOT NULL foreign key to, and
    // `teamId` came from exactly those columns — so this row always exists.
    const [team] = await tx.select({ userId: teams.userId }).from(teams).where(eq(teams.id, teamId));
    notices.push(
      await notify(tx, {
        leagueId,
        userId: team!.userId,
        noticeType: "stat_week_corrected",
        context: { leagueName, week, points: afterState.points, outcome: correctionOutcome(beforeState.result, afterState.result) },
        occurredAt: clock.now(),
        auditEventId: null,
      }),
    );
  }

  const event = await audit.record(tx, {
    eventType: "system_action",
    actorId: by,
    actorType: "user",
    leagueId,
    payload: { action: ACTION, week, summary: LEAGUE_WIDE_SUMMARY(week) },
    occurredAt: clock.now(),
  });
  for (const notice of notices) await attachAuditEvent(tx, notice, event.eventId);

  return true;
}

/** One league's whole attempt: skipped (a guard refused it — not a failure, the worker's own
 *  `finalizeDrafted` skips the same way), failed (its transaction threw and rolled back), or
 *  committed (with or without anything actually moving). */
interface LeagueAttempt {
  readonly leagueId: string;
  readonly resettled: boolean;
  readonly changed: boolean;
  readonly failure: string | null;
}

/**
 * `checkFinalizeGuards`, OUTSIDE any transaction (fix round 1, F5 — see `finalize.ts`'s own
 * docblock), then `correctLeagueInTx` inside this league's OWN transaction, wrapped in a
 * try/catch (fix round 1, HIGH/MEDIUM — F2): a thrown error from `notify`, `audit.record` or the
 * write itself used to propagate out of the per-league loop as an unhandled rejection, losing
 * every OTHER league's result along with it. Caught here instead, so one league's failure is
 * reported by name and reason while the rest of the week's leagues are still attempted — each
 * league's correction is independent, and attempting every one is more operator-friendly than
 * stopping at the first failure.
 */
async function attemptLeague(
  db: Db,
  leagueId: string,
  week: number,
  by: string,
  clock: Clock,
  audit: AuditLogger,
  notify: typeof notifyAffectedMember,
): Promise<LeagueAttempt> {
  const guardFailure = await checkFinalizeGuards(db, leagueId, week);
  if (guardFailure !== null) return { leagueId, resettled: false, changed: false, failure: null };

  try {
    const changed = await db.transaction((tx) => correctLeagueInTx(tx, leagueId, week, by, clock, audit, notify));
    return { leagueId, resettled: true, changed, failure: null };
  } catch (error: unknown) {
    return { leagueId, resettled: false, changed: false, failure: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The operator path Phase 2 Plan B's `docs/decisions/live-scoring-pipeline.md` §10 named as its
 * own residual: a revision to a settled week that has fallen out of the worker's three-day
 * correction sweep, or to any week but the most recent settled one. `correctionCandidate` never
 * runs here — this goes around it on purpose, per founder decision #11 (operator-chosen week, no
 * hard limit, always re-settling, always notifying every affected manager).
 *
 * RESERVES IN TWO PHASES, exactly as the worker does: one reservation for the schedule call this
 * function is about to make, then — once the schedule is in hand and the box scores worth
 * fetching are known — one reservation for exactly those. `RequestBudget` has no release path, so
 * reserving a worst case up front would spend real ceiling on requests this call might never make.
 * A denial at either phase fails CLOSED: nothing has been read from the provider and nothing has
 * been written to Postgres.
 *
 * `persistTick` is the arbiter of "did anything actually change" — this function fetches every
 * non-scheduled game's box score unconditionally (a correction's whole point is to re-read what
 * is already stored) and hands the result straight to `persistTick`, which advances
 * `stat_weeks.version` only when Postgres itself reports a real change
 * (`changedRowWhere`/`onConflictDoUpdate`, see `persist.ts`'s own docblock). No Redis snapshot
 * diff runs here the way the worker's `diffStatLines` does — that machinery exists to make a
 * TICK cheap against a snapshot that might be stale; this is a one-shot operator call, and
 * Postgres's own conflict resolution is a stronger arbiter than a possibly-evicted digest.
 *
 * A correction that changed nothing is not an operator action: it re-settles no league, notifies
 * no manager and writes no `system_action` — a row claiming otherwise would be exactly the false
 * record this phase exists to prevent.
 */
export async function correctSettledWeek(db: Db, input: CorrectSettledWeekInput): Promise<CorrectionResult> {
  const clock = input.clock ?? systemClock;
  const provider = input.provider ?? getStatsProvider();
  const budget = input.budget ?? getIngestionBudget();
  const audit = input.audit ?? getAuditLogger();
  const notify = input.notify ?? notifyAffectedMember;

  const [weekRow] = await db.select({ status: statWeeks.status }).from(statWeeks).where(eq(statWeeks.week, input.week));
  if (weekRow === undefined || weekRow.status !== "final") {
    return { ok: false, reason: `Week ${input.week} has not settled yet. The ingestion worker still owns it.` };
  }

  // PHASE ONE: the schedule call this correction is about to make.
  const scheduleReservation = await budget.reserve(1);
  if (!scheduleReservation.granted) return { ok: false, reason: CORRECTION_DENIAL_REASONS[scheduleReservation.denial] };

  const games = await provider.listGames(input.week);
  // A correction re-reads every game that has actually been played — never `final-only`'s
  // fetch-once rule, and never gated on a `finalGame` marker: re-reading is the entire point.
  const toFetch = games.filter((game) => game.status !== "scheduled");

  // PHASE TWO: exactly the box scores this call decided to fetch, now that it knows.
  const boxScoreReservation = toFetch.length === 0 ? ({ granted: true } as const) : await budget.reserve(toFetch.length);
  if (!boxScoreReservation.granted) return { ok: false, reason: CORRECTION_DENIAL_REASONS[boxScoreReservation.denial] };

  const fetchedLines: StatLine[] = [];
  for (const game of toFetch) fetchedLines.push(...(await provider.getGameStatLines(game)));

  const persisted = await persistTick(db, {
    week: input.week,
    changed: fetchedLines,
    status: "final",
    games: { total: games.length, final: games.filter((game) => game.status === "final").length },
    now: clock.now(),
  });

  if (persisted.changedCount === 0) {
    return { ok: true, week: input.week, changed: false, leaguesResettled: 0, leaguesChanged: 0, leaguesFailed: [] };
  }

  const leagueIds = await leaguesInWeek(db, input.week);
  const attempts: LeagueAttempt[] = [];
  for (const leagueId of leagueIds) {
    attempts.push(await attemptLeague(db, leagueId, input.week, input.by, clock, audit, notify));
  }

  const leaguesFailed: FailedLeagueCorrection[] = [];
  for (const attempt of attempts) {
    if (attempt.failure !== null) leaguesFailed.push({ leagueId: attempt.leagueId, reason: attempt.failure });
  }

  return {
    ok: true,
    week: input.week,
    changed: true,
    leaguesResettled: attempts.filter((attempt) => attempt.resettled).length,
    leaguesChanged: attempts.filter((attempt) => attempt.changed).length,
    leaguesFailed,
  };
}
