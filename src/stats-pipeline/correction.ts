import { and, eq } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@/db/client";
import { leagues, matchups, statWeeks, teams } from "@/db/schema";
import type { StatLine } from "@/domain/player";
import type { Clock } from "@/domain/timing";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { attachAuditEvent, notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import type { StatWeekCorrectionOutcome } from "@/integrity/notices";
import type { SystemActionCode } from "@/integrity/system-actions";
import type { StatsProvider } from "@/stats/provider";
import type { ReservationDenial, RequestBudget } from "./budget";
import { finalizeWeekInTx } from "./finalize";
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

export type CorrectionResult =
  | {
      readonly ok: true;
      readonly week: number;
      /** `false` when the provider's numbers matched exactly what Postgres already held —
       *  `persistTick`'s own arbiter, never a diff this module computes itself. */
      readonly changed: boolean;
      /** How many leagues were actually re-settled. Zero when `changed` is `false`, and can be
       *  fewer than "every league fielding this week" when one of them turns out undrafted. */
      readonly leaguesResettled: number;
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
 * Writes the league-wide `system_action` unconditionally once `finalizeWeekInTx` actually settles
 * the league (founder decision #11: "always re-settling") — even for a league none of whose teams
 * moved, because its standings were still recomputed from the corrected numbers and a member
 * reading the activity feed is owed that fact. Writes NOTHING for a league `finalizeWeekInTx`
 * itself refuses (a league whose draft somehow is not complete, or that vanished) — the same
 * "skip, don't fail the tick" discipline the worker's own `finalizeDrafted` uses for exactly this
 * guard, so one odd league in the week never stops the rest of it from being corrected.
 *
 * Returns whether this league was actually resettled, for the caller's `leaguesResettled` count.
 */
async function correctLeague(
  db: Db,
  leagueId: string,
  week: number,
  by: string,
  clock: Clock,
  audit: AuditLogger,
  notify: typeof notifyAffectedMember,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const before = await teamStatesFor(tx, leagueId, week);
    const result = await finalizeWeekInTx(tx, leagueId, week);
    if (!result.ok) return false;
    const after = await teamStatesFor(tx, leagueId, week);

    // `leagues.id` is what `matchups.leagueId` (the source of `leagueId`, via `leaguesInWeek`) is
    // a NOT NULL foreign key to, so this row always exists.
    const [league] = await tx.select({ name: leagues.name }).from(leagues).where(eq(leagues.id, leagueId));
    const leagueName = league!.name;

    const notices: MemberNotice[] = [];
    for (const [teamId, afterState] of after) {
      const beforeState = before.get(teamId);
      // `undefined` when this league's week was never previously scored (a matchup row can
      // predate its own first settlement) — nothing to compare against, so nothing to report.
      if (beforeState === undefined || beforeState.points === afterState.points) continue;

      // `teams.id` is what `matchups.homeTeamId`/`awayTeamId` are a NOT NULL foreign key to, and
      // `teamId` came from exactly those columns above — so this row always exists.
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
  });
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
    return { ok: true, week: input.week, changed: false, leaguesResettled: 0 };
  }

  const leagueIds = await leaguesInWeek(db, input.week);
  let leaguesResettled = 0;
  for (const leagueId of leagueIds) {
    if (await correctLeague(db, leagueId, input.week, input.by, clock, audit, notify)) leaguesResettled += 1;
  }

  return { ok: true, week: input.week, changed: true, leaguesResettled };
}
