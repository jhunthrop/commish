import { and, asc, eq, exists, isNull, notExists, sql } from "drizzle-orm";
import type { Db, DbTx } from "@research-ts/db/client";
import { players, statWeeks } from "@research-ts/db/schema";
import { leagues, lineupSlots, matchups, rosterSlots, teams } from "@/db/schema";
import type { Position } from "@research-ts/domain/player";
import { BENCH_SLOT, type RosterSlot, type RosterSlotConfig } from "@research-ts/domain/roster";
import { defaultLineup, deriveBenchSlots, isLineupLocked, startersOf } from "@/league";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { attachAuditEvent, deliverNotice, notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import type { ScoreCache } from "@/stats-pipeline/score-cache";
import { toRosterSlots } from "./lineups";
import { AUTO_SET_CONFIG } from "./config";
import { ENFORCED_LEAGUE_SQL, enforcementIsSwitchedOn } from "./enforcement";

/**
 * The missed-deadline lineup strategy, as a runtime array with the union derived from it — the
 * same `AUDIT_EVENT_TYPES`/`SYSTEM_ACTION_CODES` shape, and for the identical reason: an
 * exhaustive switch over the derived union is a compile error the day a second arm is declared
 * without an implementation.
 *
 * ONLY `repeat_previous_week` IS DECLARED. The spec names a second strategy,
 * `best_legal_lineup` — better lineup, worse consent, and the platform playing somebody's team
 * rather than repeating their own last choice. Declaring it here with no implementation behind it
 * would be the enum-value-with-no-implementation founder decision #5 already refused once for
 * `ACCOUNT_RESTRICTED` (ruling 17). The founder's veto costs one arm in one exhaustive switch, not
 * a second strategy nobody can select.
 */
export const MISSED_DEADLINE_LINEUP_STRATEGIES = ["repeat_previous_week"] as const;
export type MissedDeadlineLineupStrategy = (typeof MISSED_DEADLINE_LINEUP_STRATEGIES)[number];

/** Founder decision #9's default, and the only value this plan ships. Predictable and sometimes
 *  obviously wrong beats better-and-uninvited: the platform is acting without the manager's
 *  consent, and the notice says exactly which week it copied so the choice is auditable. */
export const MISSED_DEADLINE_LINEUP_STRATEGY: MissedDeadlineLineupStrategy = "repeat_previous_week";

export interface PlannedAutoLineupInput {
  readonly strategy: MissedDeadlineLineupStrategy;
  readonly slotConfig: readonly RosterSlotConfig[];
  /** This team's CURRENT roster (`roster_slots`, already read through `toRosterSlots`) — the same
   *  shape `getLineup`'s own no-saved-rows fallback reads. */
  readonly roster: readonly RosterSlot[];
  /** Last week's SAVED lineup (`lineup_slots`, starters and bench both), or `null` when this team
   *  never saved one — the same "no rows" case `getLineup` already falls back from. `null` is
   *  reserved for a league's very first week: every later week has SOMETHING saved for its own
   *  week minus one, because an auto-set materializes a row exactly like a manual save does. */
  readonly previousLineup: readonly RosterSlot[] | null;
  readonly playerPositions: Readonly<Record<string, string>>;
}

/**
 * Repeats last week's STARTERS, dropping anyone no longer on the roster and refilling an emptied
 * slot from whoever else this team owns — the bench included, since a bench player is exactly
 * who a manager would have promoted by hand. `deriveBenchSlots` (`@/league`) then recomputes the
 * bench for the new week the same way `setLineup` always has: everyone who isn't starting,
 * never a copy of last week's own bench assignment. That is the "no second slot policy" this
 * module and `setLineup` both hold to — one bench derivation, reused, not two that could drift.
 */
function repeatPreviousWeekLineup(input: PlannedAutoLineupInput): readonly RosterSlot[] {
  const ownedIds = new Set(input.roster.map((slot) => slot.playerId).filter((id): id is string => id !== null));
  if (input.previousLineup === null) return defaultLineup(input.slotConfig, input.roster);

  const previousStarters = startersOf(input.previousLineup);
  // Keep every still-owned starter in their old slot; empty out anyone who left the roster.
  const kept = previousStarters.map((slot) => (slot.playerId !== null && ownedIds.has(slot.playerId) ? slot : { ...slot, playerId: null }));
  const placedIds = new Set(kept.map((slot) => slot.playerId).filter((id): id is string => id !== null));
  // Everyone else this team owns — including last week's own bench — is available to fill a gap.
  const pool = [...ownedIds].filter((id) => !placedIds.has(id)).sort();

  const starterConfig = input.slotConfig.filter((config) => config.slot !== BENCH_SLOT);
  const filled = kept.map((slot) => {
    if (slot.playerId !== null) return slot;
    const config = starterConfig.find((c) => c.slot === slot.slot);
    if (config === undefined) return slot;
    const index = pool.findIndex((id) => config.eligiblePositions.includes(input.playerPositions[id] as Position));
    if (index === -1) return slot;
    const [playerId] = pool.splice(index, 1);
    return { ...slot, playerId };
  });

  const startingIds = new Set(filled.map((slot) => slot.playerId).filter((id): id is string => id !== null));
  const benchSlots = deriveBenchSlots(ownedIds, startingIds, input.slotConfig);
  return defaultLineup(input.slotConfig, [...filled, ...benchSlots]);
}

/**
 * Pure: last week's saved slots plus this week's roster, in, a legal lineup out. No clock, no
 * database — exhaustive over `MissedDeadlineLineupStrategy`, so adding `best_legal_lineup` later
 * is a compile error everywhere it is unhandled rather than a silent default.
 */
export function plannedAutoLineup(input: PlannedAutoLineupInput): readonly RosterSlot[] {
  const strategy: MissedDeadlineLineupStrategy = input.strategy;
  switch (strategy) {
    case "repeat_previous_week":
      return repeatPreviousWeekLineup(input);
  }
}

/** English, singular or joined naturally ("A", "A and B", "A, B, and C") — the same formatter
 *  `activity-view.ts`'s `TRADE_ASSET_LIST_FORMAT` uses, applied here to a notice clause. */
const DROPPED_PLAYER_LIST_FORMAT = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/**
 * The `changedPlayers` clause `NoticeContexts.lineup_auto_set` (`@/integrity/notices`) carries —
 * a rendered clause from a FIXED set (nothing changed; one player named; several named), never
 * free text, so the notice's own copy sweep covers every sentence it can produce rather than one
 * sample of it (the discipline `correctionOutcome` established in Plan B). Named players are the
 * ones DROPPED from last week's starters, not the bench players who replaced them: the fact worth
 * reporting is what changed about the PLAN the manager last chose, not the mechanics of the fill.
 */
export function changedPlayersClauseFor(droppedPlayerNames: readonly string[]): string {
  if (droppedPlayerNames.length === 0) return "";
  if (droppedPlayerNames.length === 1) {
    return ` ${droppedPlayerNames[0]} is no longer on your roster, so we filled that spot from your bench.`;
  }
  return ` ${DROPPED_PLAYER_LIST_FORMAT.format(droppedPlayerNames)} are no longer on your roster, so we filled those spots from your bench.`;
}

const LINEUP_AUTO_SET_SUMMARY = (week: number): string => `We set your week ${week} lineup for you.`;

export interface FailedLeagueAutoSet {
  readonly leagueId: string;
  readonly reason: string;
}

export interface AutoSetOutcome {
  readonly week: number;
  /** How many teams actually had a lineup materialized this run — zero for a re-run over a week
   *  every team already has a saved row for (the idempotency guard). */
  readonly teamsSet: number;
  /** Every league whose OWN transaction threw and rolled back, by id and reason — never silently
   *  dropped, the same shape `correctSettledWeek`'s `leaguesFailed` uses. */
  readonly leaguesFailed: readonly FailedLeagueAutoSet[];
}

/** No Redis round trip needed: a caller with no cache to fill keeps working untouched — the same
 *  idiom `setLineup`'s and `acceptTrade`'s own `NOOP_SCORE_CACHE` use. */
const NOOP_SCORE_CACHE: Pick<ScoreCache, "invalidate"> = { invalidate: async () => {} };

/**
 * Awaits the eviction and swallows its failure, with a log — the identical discipline
 * `invalidateScoreCacheQuietly` (`@/league-service/trades`) and `invalidateQuietly`
 * (`@/league-service/lineups`) both keep for their own cache. A missed eviction is one stale read
 * bounded by the key's TTL; it is never worth failing a sweep that already committed real writes.
 */
async function invalidateScoreCacheQuietly(cache: Pick<ScoreCache, "invalidate">, leagueId: string, weekNumber: number): Promise<void> {
  try {
    await cache.invalidate(leagueId, weekNumber);
  } catch (error: unknown) {
    console.error("[league-service] score cache invalidation failed", { leagueId, weekNumber }, error);
  }
}

/**
 * The delivery twin of `invalidateScoreCacheQuietly`, above. `deliverNotice`'s own real publisher
 * never throws by contract (`createPublisher`'s "a Redis failure here returns null and never
 * throws"), but `deliver` is an injected dependency here exactly like `cache` is — a test can
 * supply one that does, and this run's `leaguesFailed` must never say a league failed when its
 * writes already committed and only the best-effort push after commit did not.
 */
async function deliverNoticeQuietly(deliver: typeof deliverNotice, notice: MemberNotice): Promise<void> {
  try {
    await deliver(notice);
  } catch (error: unknown) {
    console.error("[league-service] auto-set notice delivery failed", { noticeId: notice.id, userId: notice.userId }, error);
  }
}

/**
 * Every player's position and name, read ONCE PER RUN (final review F8).
 *
 * `players` is the one table this module reads with no `WHERE` at all, because a carried-forward
 * lineup can name any player in the pool. That read used to happen INSIDE each league's own
 * transaction, so a run over L leagues paid L full table scans held inside L open transactions,
 * for a table whose contents do not change between two leagues examined one second apart. Hoisted
 * to the driver, it is one read per run, taken before the first transaction opens.
 *
 * SAFE TO READ OUTSIDE THE TRANSACTION, and not by luck: `players` is a reference table, not a
 * league's own state. Nothing this transaction writes touches it, no lock this module takes
 * protects it, and a player row appearing or changing mid-run cannot invalidate a plan built from
 * a snapshot moments earlier — the same reasoning `scoringWeightsByLeagueId` (`./browse`) uses for
 * its own out-of-transaction reference read. The facts that DO need transactional consistency (a
 * team's roster, its saved rows, the week's own status) are all still read inside.
 */
export interface PlayerIndex {
  readonly positions: Readonly<Record<string, string>>;
  readonly names: Readonly<Record<string, string>>;
}

/** The one `players` read this module performs — see `PlayerIndex`'s own docblock. */
export async function readPlayerIndex(db: Db): Promise<PlayerIndex> {
  const rows = await db.select({ id: players.id, name: players.name, position: players.position }).from(players);
  return {
    positions: Object.fromEntries(rows.map((row) => [row.id, row.position])),
    names: Object.fromEntries(rows.map((row) => [row.id, row.name])),
  };
}

interface AutoSetDeps {
  readonly audit: AuditLogger;
  readonly notify: typeof notifyAffectedMember;
  /** Read once per run by `autoSetLineupsForWeek`, never per league — `PlayerIndex`'s docblock. */
  readonly players: PlayerIndex;
}

/** One league's own attempt, returned to the caller so delivery and eviction — both best-effort,
 *  both outside the transaction — run only after this league's own commit actually lands. */
interface LeagueAutoSetResult {
  readonly teamsSet: number;
  readonly notices: readonly MemberNotice[];
}

/**
 * One league's whole attempt, inside its OWN transaction (Plan A ruling 3: a transaction appends
 * to at most one chain).
 *
 * LOCK ORDER, and the FK acquisitions enumerated (Plan C's H2 lesson):
 *   1. `stat_weeks[week] FOR SHARE`  — FIRST, matching `setLineup` and `acceptTrade`, so all
 *      THREE roster-adjacent writers take the same lock in the same position. Here it is doing
 *      the opposite job it does there: this writer REQUIRES the week to be LOCKED and holds the
 *      share so `persistTick` cannot advance it out from under the write — a week still
 *      `scheduled` (a race with the trigger, or a direct call in a test) means nothing to do.
 *   2. `matchups[league, week] FOR UPDATE`, ordered by `home_team_id`  — the SETTLEMENT lock
 *      (final review F11), see the paragraph below. Ordered exactly the way `finalizeWeekInTx`
 *      (`@/stats-pipeline/finalize`) orders its own row locks over the same rows, so the two can
 *      queue but never deadlock. BEFORE `leagues` and before the notices, which is also the
 *      order finalize takes them in (`matchups` first, `leagues` last through
 *      `stampSeasonCompleteInTx`) — one agreed order across both writers.
 *   3. `lineup_slots` INSERT  — implicit `FOR KEY SHARE` on `teams`, and through `teams` nothing
 *      further; `lineup_slots` has no other parent.
 *   4. the notice inserts  — implicit `FOR KEY SHARE` on `users` and `leagues`.
 *   5. `audit.recordAll`  — the anchor, ALWAYS last, taken ONCE for every team this league
 *      notified this run (one event per team, since `SYSTEM_ACTION_VISIBILITY.lineup_auto_set` is
 *      `"subject_only"` and each event needs its own `subjectUserId`).
 *   6. `attachAuditEvent`  — the one statement permitted after the anchor.
 *
 * THE SETTLEMENT LOCK, AND THE RACE IT CLOSES (final review F11). Within one leased worker the
 * ordering is already correct and sequential: `tickWeek` awaits this before `finalizeDrafted`. The
 * exposure is elsewhere, because the Redis lease is best-effort by explicit design
 * (`worker.ts` — an unreachable Redis runs the tick UNLEASED), so two instances can put
 * `finalizeWeekInTx` for week W beside this function for week W. They used to share NO lock:
 * this writes `lineup_slots` and finalize reads it through `getLineup` with a plain unlocked
 * `SELECT`, and the `stat_weeks FOR SHARE` above is aimed at `persistTick`, which finalize never
 * touches. Under read-committed, finalize could score a team from the roster-derived default
 * while this function's carried-forward lineup committed moments later — the stored lineup then
 * disagreeing with the score it supposedly produced.
 *
 * The lock is taken on `matchups` rather than on `lineup_slots`, and that is the point: `matchups`
 * is the row finalize actually WRITES, so a `FOR UPDATE` here genuinely serializes against it,
 * whereas a share lock on `lineup_slots` would be a lock finalize does not take and therefore
 * cannot queue behind. It is the same predicate `settleMissedWeeks` already reads a week's
 * settlement state by.
 *
 * It is also the SETTLED-WEEK GUARD this function never had. `isLineupLocked` answers `true` for
 * `"final"`, so nothing above stopped an auto-set materializing a lineup for a week whose scores
 * already stand — which the correction sweep would then re-score from. A week with any scored
 * matchup is left entirely alone. That guard is only safe BECAUSE the trigger is level-derived
 * (F2): a league that failed at the lock heals on the next tick, thirty minutes later and days
 * before the week settles, so refusing a settled week refuses work that has already had every
 * chance to happen rather than abandoning it.
 * Then commit, then `deliverNotice` for every recipient and the score-cache eviction for this
 * league's own week — both best-effort and both OUTSIDE the transaction, called by
 * `autoSetLineupsForWeek` once THIS league's own transaction has actually landed. The same
 * failure asymmetry `setLineup` and `acceptTrade` accept for their own cache and delivery: a
 * slightly-late push or eviction costs one stale read or one missed realtime nudge, never worth
 * reporting this league as failed when its writes already committed.
 *
 * A team already holding a saved row for this week is left ENTIRELY alone — never read past the
 * existence check, never planned, never written. That is both the "leave a manager who set their
 * own lineup alone" rule and the idempotency guard a re-run relies on: the second run finds every
 * team it touched last time already has a row and does nothing to any of them.
 *
 * A team whose PREVIOUS week has no saved lineup at all (a league's very first week) still gets
 * its row materialized — `plannedAutoLineup` falls back to exactly what `getLineup` would have
 * derived — but gets no notice and no `system_action`: nothing was carried forward to report, the
 * same "a materialization and not a decision" property Plan C's trade lineup freeze has.
 *
 * THE EXISTENCE CHECK CANNOT AND DOES NOT DISTINGUISH A ROW'S ORIGIN. `lineup_slots` carries no
 * source column, so a row `materializeLockedLineupsInTx` (`@/league-service/trade-transfer`)
 * froze for a locked week a trade just touched reads identically to one a manager saved by hand —
 * both leave a team ENTIRELY alone here, on purpose: `materializeLockedLineupsInTx`'s own
 * docblock already treats any existing row as untouchable regardless of how it got there ("a real
 * save is already immune — never re-derived"), and this function holds every team to the
 * identical rule rather than inventing a second, narrower one just for auto-set.
 */
export async function autoSetLineupInTx(
  tx: DbTx,
  leagueId: string,
  weekNumber: number,
  occurredAt: string,
  deps: AutoSetDeps,
): Promise<LeagueAutoSetResult> {
  const [week] = await tx.select({ status: statWeeks.status }).from(statWeeks).where(eq(statWeeks.week, weekNumber)).for("share");
  if (week === undefined || !isLineupLocked(week.status)) return { teamsSet: 0, notices: [] };

  // Step 1b: the settlement lock and the settled-week guard, in one statement — see the
  // paragraph in this function's own docblock. `ORDER BY home_team_id` is `finalizeWeekInTx`'s
  // own order over the same rows.
  const fixtures = await tx
    .select({ homeScore: matchups.homeScore })
    .from(matchups)
    .where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, weekNumber)))
    .orderBy(asc(matchups.homeTeamId))
    .for("update");
  if (fixtures.some((row) => row.homeScore !== null)) return { teamsSet: 0, notices: [] };

  // `leagues.id` is what `matchups.leagueId` (the source of every `leagueId` this function is
  // called with) is a NOT NULL foreign key to, so this row always exists.
  const [league] = await tx.select({ rosterSlots: leagues.rosterSlots, name: leagues.name }).from(leagues).where(eq(leagues.id, leagueId));
  if (league === undefined) return { teamsSet: 0, notices: [] };

  const { positions: playerPositions, names: playerNames } = deps.players;

  const teamRows = await tx.select({ id: teams.id, userId: teams.userId }).from(teams).where(eq(teams.leagueId, leagueId)).orderBy(teams.id);

  interface Planned {
    readonly teamId: string;
    readonly userId: string;
    readonly lineup: readonly RosterSlot[];
    readonly previousLineup: readonly RosterSlot[] | null;
  }
  const planned: Planned[] = [];

  for (const team of teamRows) {
    const saved = await tx.select().from(lineupSlots).where(and(eq(lineupSlots.teamId, team.id), eq(lineupSlots.weekNumber, weekNumber)));
    if (saved.length > 0) continue; // already set — leave this manager entirely alone.

    const rosterRows = await tx.select().from(rosterSlots).where(eq(rosterSlots.teamId, team.id));
    const roster = toRosterSlots(rosterRows);

    const previousRows = await tx.select().from(lineupSlots).where(and(eq(lineupSlots.teamId, team.id), eq(lineupSlots.weekNumber, weekNumber - 1)));
    const previousLineup = previousRows.length > 0 ? toRosterSlots(previousRows) : null;

    const lineup = plannedAutoLineup({
      strategy: MISSED_DEADLINE_LINEUP_STRATEGY,
      slotConfig: league.rosterSlots,
      roster,
      previousLineup,
      playerPositions,
    });
    planned.push({ teamId: team.id, userId: team.userId, lineup, previousLineup });
  }

  // Step 2: every planned lineup's rows, before any notice and before the anchor.
  for (const item of planned) {
    await tx.insert(lineupSlots).values(
      item.lineup.map((slot) => ({ teamId: item.teamId, weekNumber, slot: slot.slot, slotIndex: slot.slotIndex, playerId: slot.playerId })),
    );
  }

  // Step 3: notices — only for a team whose lineup really was CARRIED FORWARD from a real
  // previous choice, never for the no-previous-week materialization (nothing to report there).
  const notified: { readonly teamId: string; readonly userId: string; readonly notice: MemberNotice }[] = [];
  for (const item of planned) {
    if (item.previousLineup === null) continue;
    const previousStarterIds = new Set(startersOf(item.previousLineup).map((slot) => slot.playerId).filter((id): id is string => id !== null));
    const finalStarterIds = new Set(startersOf(item.lineup).map((slot) => slot.playerId).filter((id): id is string => id !== null));
    const droppedNames = [...previousStarterIds]
      .filter((id) => !finalStarterIds.has(id))
      .map((id) => playerNames[id] ?? "A player who is no longer listed")
      .sort();

    const notice = await deps.notify(tx, {
      leagueId,
      userId: item.userId,
      noticeType: "lineup_auto_set",
      context: { leagueName: league.name, week: weekNumber, carriedFrom: weekNumber - 1, changedPlayers: changedPlayersClauseFor(droppedNames) },
      occurredAt,
      auditEventId: null,
    });
    notified.push({ teamId: item.teamId, userId: item.userId, notice });
  }

  // Step 4: the anchor, ALWAYS LAST — one batch, one event per notified team, each carrying that
  // team's own manager as `subjectUserId` (SYSTEM_ACTION_VISIBILITY.lineup_auto_set is
  // "subject_only": the event is meaningless without a subject to scope it to).
  if (notified.length > 0) {
    const events = await deps.audit.recordAll(
      tx,
      notified.map(({ userId }) => ({
        eventType: "system_action" as const,
        actorId: null,
        actorType: "system" as const,
        leagueId,
        payload: { action: "lineup_auto_set", subjectUserId: userId, week: weekNumber, summary: LINEUP_AUTO_SET_SUMMARY(weekNumber) },
        occurredAt,
      })),
    );
    // Step 5: the one statement permitted after the anchor.
    for (let index = 0; index < notified.length; index += 1) {
      await attachAuditEvent(tx, notified[index]!.notice, events[index]!.eventId);
    }
  }

  return { teamsSet: planned.length, notices: notified.map(({ notice }) => notice) };
}

/**
 * THE LEVEL PREDICATE (final review F2): every public matchmade league fielding this week that
 * STILL has at least one team with no `lineup_slots` row for it.
 *
 * Not "every league fielding this week" — that read was EDGE-shaped, and it was only ever correct
 * because the trigger above it fired exactly once. The candidate set is now derived from the state
 * the auto-set exists to reach, so a league whose transaction rolled back is simply still in the
 * set on the next tick and a league that succeeded is not. No retry counter, no failed-league
 * table, no bookkeeping of any kind: self-healing falls out of asking the question the right way
 * round. The identical shape both trade sweeps use — a candidate query that names the work still
 * outstanding, run again, bounded.
 *
 * THE PER-LEAGUE AXIS IS IN THE SQL, not a per-row re-read after the scan. F8: the old shape paid
 * for the whole scan and then discarded private leagues one at a time, while `dueDraftsQuery`
 * (`@/draft-service/auto-start`) — the sibling automation — filters `is_public_matchmade` in the
 * query. The deploy half of `enforcementAppliesTo` is checked by the caller BEFORE this runs, for
 * the same reason `autoStartDueDrafts` checks it first: enforcement being off means the scan does
 * not happen, not that every row it found gets refused.
 *
 * Bounded at `AUTO_SET_CONFIG.maxLeaguesPerRun` and ordered by league id, the same determinism the
 * expiry and due-kickoff scans keep. Exported as the query BUILDER (not yet awaited), the shape
 * `browseQuery`/`dueDraftsQuery`/`pendingFlagQuery` already use — the one seam an `EXPLAIN`
 * assertion can wrap without duplicating the query's shape (`src/db/index-plans.test.ts`).
 */
export function leaguesNeedingAutoSetQuery(db: Db, weekNumber: number) {
  return db
    .selectDistinct({ leagueId: matchups.leagueId })
    .from(matchups)
    .innerJoin(leagues, eq(leagues.id, matchups.leagueId))
    .where(
      and(
        eq(matchups.weekNumber, weekNumber),
        // UNSETTLED fixtures only (final review F11). `autoSetLineupInTx` refuses a week whose
        // scores already stand, and a candidate query that kept offering settled leagues would
        // open a transaction per league per tick forever to be refused inside it — the level
        // trigger makes a stale predicate expensive rather than merely untidy. It also matches
        // `matchups_unsettled_idx`'s own partial predicate (`@research-ts/db/schema`), which is the index
        // built for exactly this question.
        isNull(matchups.homeScore),
        ENFORCED_LEAGUE_SQL,
        exists(
          db
            .select({ one: sql`1` })
            .from(teams)
            .where(
              and(
                eq(teams.leagueId, matchups.leagueId),
                notExists(
                  db
                    .select({ one: sql`1` })
                    .from(lineupSlots)
                    .where(and(eq(lineupSlots.teamId, teams.id), eq(lineupSlots.weekNumber, weekNumber))),
                ),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(matchups.leagueId))
    .limit(AUTO_SET_CONFIG.maxLeaguesPerRun);
}

async function leaguesNeedingAutoSet(db: Db, weekNumber: number): Promise<readonly string[]> {
  const rows = await leaguesNeedingAutoSetQuery(db, weekNumber);
  return rows.map((row) => row.leagueId);
}

export interface AutoSetInput {
  readonly weekNumber: number;
  readonly occurredAt: string;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
  /** Defaults to the real `notifyAffectedMember`. Injectable so a test can force its failure. */
  readonly notify?: typeof notifyAffectedMember;
  /** Defaults to the real `deliverNotice` (`@/integrity-service/notify`), called once per
   *  auto-set manager AFTER their own league's transaction commits. Injectable so a test can
   *  spy on it or force its failure without a live Redis connection. */
  readonly deliver?: typeof deliverNotice;
  /** Defaults to a no-op — injectable so a test never needs a live Redis connection, the same
   *  `setLineup`/`acceptTrade` idiom. The worker trigger supplies the real `getScoreCache()`
   *  (`@/league-service/score-cache-instance`). */
  readonly cache?: Pick<ScoreCache, "invalidate">;
}

/**
 * The missed-deadline lineup, applied to every public matchmade league that is missing one for a
 * LOCKED week. ONE TRANSACTION PER LEAGUE, and the reason is Plan A's ruling 3 read literally: a
 * transaction appends to at most one chain, and this runs across every affected league at once.
 * `correctSettledWeek` reached the identical shape for the identical reason and this follows it
 * rather than inventing a second answer — including its failure semantics, where a partial run
 * names the leagues it could not finish by id and reason.
 *
 * SAFE AND USEFUL TO RE-RUN, WHICH IS THE POINT (final review F2). The candidate query is LEVEL-
 * derived (`leaguesNeedingAutoSetQuery`, above): it names the leagues whose work is still
 * outstanding, so re-running is how a rolled-back league heals rather than merely a thing that
 * does no harm. The worker calls this on every tick a week is locked, not on the one tick it
 * locked — before F2 the trigger was edge-shaped and a league that failed its transaction got no
 * lineup, no notice, no audit row and no second attempt, permanently and invisibly.
 *
 * `leaguesFailed` IS THE CALLER'S TO CONSUME, and `AutoSetOutcome`'s own contract says so. The
 * failures below do not throw, so a caller that ignores the return value is a caller that has
 * silently dropped them — `src/stats-pipeline/worker.ts`'s trigger reports a non-empty
 * `leaguesFailed` through `reportIfDue`, the same operator surface every other tick failure uses,
 * and `scripts/correct-stat-week.ts` does the identical thing with `correctSettledWeek`'s.
 *
 * A PRIVATE league, or a public one with segregation switched off at deploy, is never touched:
 * `enforcementAppliesTo` (`@/league-service/enforcement`) is the SAME predicate the join and
 * creation gates use, so "is the platform this league's commissioner" is one answer everywhere in
 * this plan rather than a promise repeated per writer. The deploy half is asked FIRST, before any
 * query runs at all, and the per-league half is a predicate inside the candidate query — the
 * split `autoStartDueDrafts` (`@/draft-service/auto-start`) already uses.
 */
export async function autoSetLineupsForWeek(db: Db, input: AutoSetInput): Promise<AutoSetOutcome> {
  const audit = input.audit ?? getAuditLogger();
  const notify = input.notify ?? notifyAffectedMember;
  const deliver = input.deliver ?? deliverNotice;
  const cache = input.cache ?? NOOP_SCORE_CACHE;

  if (!enforcementIsSwitchedOn()) return { week: input.weekNumber, teamsSet: 0, leaguesFailed: [] };

  const leagueIds = await leaguesNeedingAutoSet(db, input.weekNumber);
  // Nothing to do: skip the reference read entirely rather than scanning `players` for a run that
  // will open no transaction at all — which is the common case once every league is set.
  if (leagueIds.length === 0) return { week: input.weekNumber, teamsSet: 0, leaguesFailed: [] };

  // ONE read per run, before the first transaction opens (final review F8).
  const deps: AutoSetDeps = { audit, notify, players: await readPlayerIndex(db) };
  let teamsSet = 0;
  const leaguesFailed: FailedLeagueAutoSet[] = [];

  for (const leagueId of leagueIds) {
    let result: LeagueAutoSetResult;
    try {
      result = await db.transaction((tx) => autoSetLineupInTx(tx, leagueId, input.weekNumber, input.occurredAt, deps));
    } catch (error: unknown) {
      leaguesFailed.push({ leagueId, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }

    teamsSet += result.teamsSet;
    // Best-effort, outside the transaction, ONLY once this league's own commit actually landed —
    // NEVER inside the `try` above: a failed push or eviction must not report a league whose
    // writes already committed as a failed league.
    if (result.teamsSet > 0) {
      for (const notice of result.notices) await deliverNoticeQuietly(deliver, notice);
      await invalidateScoreCacheQuietly(cache, leagueId, input.weekNumber);
    }
  }

  return { week: input.weekNumber, teamsSet, leaguesFailed };
}
