import { and, eq } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { leagues, lineupSlots, matchups, players, rosterSlots, statWeeks, teams } from "@/db/schema";
import type { Position } from "@/domain/player";
import { BENCH_SLOT, type RosterSlot, type RosterSlotConfig } from "@/domain/roster";
import { defaultLineup, deriveBenchSlots, isLineupLocked, startersOf } from "@/league";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { attachAuditEvent, notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import { toRosterSlots } from "./lineups";
import { enforcementAppliesTo } from "./enforcement";

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

interface AutoSetDeps {
  readonly audit: AuditLogger;
  readonly notify: typeof notifyAffectedMember;
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
 *   2. `lineup_slots` INSERT  — implicit `FOR KEY SHARE` on `teams`, and through `teams` nothing
 *      further; `lineup_slots` has no other parent.
 *   3. the notice inserts  — implicit `FOR KEY SHARE` on `users` and `leagues`.
 *   4. `audit.recordAll`  — the anchor, ALWAYS last, taken ONCE for every team this league
 *      notified this run (one event per team, since `SYSTEM_ACTION_VISIBILITY.lineup_auto_set` is
 *      `"subject_only"` and each event needs its own `subjectUserId`).
 *   5. `attachAuditEvent`  — the one statement permitted after the anchor.
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
 */
export async function autoSetLineupInTx(tx: DbTx, leagueId: string, weekNumber: number, occurredAt: string, deps: AutoSetDeps): Promise<number> {
  const [week] = await tx.select({ status: statWeeks.status }).from(statWeeks).where(eq(statWeeks.week, weekNumber)).for("share");
  if (week === undefined || !isLineupLocked(week.status)) return 0;

  // `leagues.id` is what `matchups.leagueId` (the source of every `leagueId` this function is
  // called with) is a NOT NULL foreign key to, so this row always exists.
  const [league] = await tx.select({ rosterSlots: leagues.rosterSlots, name: leagues.name }).from(leagues).where(eq(leagues.id, leagueId));
  if (league === undefined) return 0;

  const playerRows = await tx.select({ id: players.id, name: players.name, position: players.position }).from(players);
  const playerPositions = Object.fromEntries(playerRows.map((row) => [row.id, row.position]));
  const playerNames = Object.fromEntries(playerRows.map((row) => [row.id, row.name]));

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

  return planned.length;
}

/** Every league fielding this week, from `matchups` — the same "matchups is the source of truth
 *  for which leagues are in season" `correction.ts`'s own `leaguesInWeek` uses, sorted for a
 *  deterministic per-league transaction order. */
async function leaguesInWeek(db: Db, weekNumber: number): Promise<readonly string[]> {
  const rows = await db.selectDistinct({ leagueId: matchups.leagueId }).from(matchups).where(eq(matchups.weekNumber, weekNumber));
  return rows.map((row) => row.leagueId).sort();
}

export interface AutoSetInput {
  readonly weekNumber: number;
  readonly occurredAt: string;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
  /** Defaults to the real `notifyAffectedMember`. Injectable so a test can force its failure. */
  readonly notify?: typeof notifyAffectedMember;
}

/**
 * The missed-deadline lineup, applied to every public matchmade league at the moment a week
 * locks. ONE TRANSACTION PER LEAGUE, and the reason is Plan A's ruling 3 read literally: a
 * transaction appends to at most one chain, and this runs across every affected league at once.
 * `correctSettledWeek` reached the identical shape for the identical reason and this follows it
 * rather than inventing a second answer — including its failure semantics, where a partial run
 * names the leagues it could not finish by id and reason and is safe to re-run because the
 * per-team guard is the state the first run left.
 *
 * A PRIVATE league, or a public one with segregation switched off at deploy, is never touched:
 * `enforcementAppliesTo` (`@/league-service/enforcement`) is the SAME predicate the join and
 * creation gates use, so "is the platform this league's commissioner" is one answer everywhere in
 * this plan rather than a promise repeated per writer.
 */
export async function autoSetLineupsForWeek(db: Db, input: AutoSetInput): Promise<AutoSetOutcome> {
  const audit = input.audit ?? getAuditLogger();
  const notify = input.notify ?? notifyAffectedMember;
  const deps: AutoSetDeps = { audit, notify };

  const leagueIds = await leaguesInWeek(db, input.weekNumber);
  let teamsSet = 0;
  const leaguesFailed: FailedLeagueAutoSet[] = [];

  for (const leagueId of leagueIds) {
    const [row] = await db.select({ isPublicMatchmade: leagues.isPublicMatchmade }).from(leagues).where(eq(leagues.id, leagueId));
    if (row === undefined || !enforcementAppliesTo(row)) continue;

    try {
      teamsSet += await db.transaction((tx) => autoSetLineupInTx(tx, leagueId, input.weekNumber, input.occurredAt, deps));
    } catch (error: unknown) {
      leaguesFailed.push({ leagueId, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { week: input.weekNumber, teamsSet, leaguesFailed };
}
