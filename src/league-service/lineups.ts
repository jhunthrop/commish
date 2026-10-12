import { and, eq } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@research/db/client";
import { players, statWeeks } from "@research/db/schema";
import { leagues, lineupSlots, matchups, rosterSlots, teams } from "@/db/schema";
import { validateLineup } from "@research/domain/roster-eligibility";
import { BENCH_SLOT } from "@research/domain/roster";
import type { RosterSlot, RosterSlotConfig, RosterSlotType } from "@research/domain/roster";
import type { Clock } from "@research/domain/timing";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { benchOf, defaultLineup, deriveBenchSlots, isLineupLocked, startersOf, type WeekStatus } from "@/league";
import { excludedSetFor } from "@research/db/upsert";
import { startedTeamsForWeek } from "@research/reference/nfl-schedule";
import { injuryDesignations } from "@research/reference/injuries";
import { injuredReserve } from "@/db/schema";
import type { LineupBody, LineupSlotView } from "@/league-room/contract";
import type { ScoreCache } from "@/stats-pipeline/score-cache";

/** No Redis connection needed: every existing caller of `setLineup` keeps working untouched. */
const NOOP_SCORE_CACHE: Pick<ScoreCache, "invalidate"> = {
  invalidate: async () => {},
};

const systemClock: Clock = { now: () => new Date().toISOString() };

/**
 * Awaits the eviction and swallows its failure, with a log — the middle ground between `void`
 * (the response can outrun the DEL, so an immediate re-read hits a stale entry) and a bare
 * `await` (a caller that injects something less forgiving than `ScoreCache` could fail a write
 * that already committed). A missed eviction is one stale read bounded by the key's TTL; it is
 * never worth a 500, and it is never worth being silent about either.
 */
async function invalidateQuietly(cache: Pick<ScoreCache, "invalidate">, leagueId: string, weekNumber: number): Promise<void> {
  try {
    await cache.invalidate(leagueId, weekNumber);
  } catch (error: unknown) {
    console.error("[league-service] score cache invalidation failed", { leagueId, weekNumber }, error);
  }
}

export interface GetLineupInput {
  readonly teamId: string;
  readonly weekNumber: number;
  readonly slotConfig: readonly RosterSlotConfig[];
}

export interface StoredSlotRow {
  readonly slot: string;
  readonly slotIndex: number;
  readonly playerId: string | null;
}

/**
 * `slot` is a plain text column in both `lineup_slots` and `roster_slots`; the league's config is
 * what gives it meaning. Exported so `autoSetLineupInTx` (`@/league-service/auto-lineup`, Task 4)
 * reads its own `lineup_slots`/`roster_slots` rows through the identical mapping this module
 * already uses, rather than a second copy of the same three-field cast.
 */
export function toRosterSlots(rows: readonly StoredSlotRow[]): readonly RosterSlot[] {
  return rows.map((row) => ({ slot: row.slot as RosterSlotType, slotIndex: row.slotIndex, playerId: row.playerId }));
}

/**
 * The lineup this team fields in this week. Saved rows win; where there are none, the team's
 * drafted roster IS the lineup (`defaultLineup`), so a manager who never opens the editor
 * still fields a legal team rather than forfeiting the week to an empty form.
 *
 * Either way the rows go through `defaultLineup`, so the result always has exactly one entry
 * per configured slot — a saved lineup written against an older roster shape can't hand the
 * caller a slot the league no longer has.
 *
 * Takes a `ReadonlyDb` because it only selects, and because the advisor's read-only guarantee
 * is only as strong as its transitive dependencies: this is the one function outside
 * `src/ai-advisor/**` that `assembleAdvisorContext` calls with its connection.
 */
export async function getLineup(db: ReadonlyDb, { teamId, weekNumber, slotConfig }: GetLineupInput): Promise<readonly RosterSlot[]> {
  const saved = await db
    .select()
    .from(lineupSlots)
    .where(and(eq(lineupSlots.teamId, teamId), eq(lineupSlots.weekNumber, weekNumber)));
  if (saved.length > 0) return defaultLineup(slotConfig, toRosterSlots(saved));

  const roster = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, teamId));
  return defaultLineup(slotConfig, toRosterSlots(roster));
}

export interface LineupSlotInput {
  readonly slot: RosterSlotType;
  readonly slotIndex: number;
  readonly playerId: string | null;
}

export interface SetLineupInput {
  readonly leagueId: string;
  readonly teamId: string;
  readonly weekNumber: number;
  readonly slots: readonly LineupSlotInput[];
  /** Whose save this is, for the `lineup_change` audit event. The route reads this from the session, never from the body. */
  readonly userId: string;
}

export type SetLineupResult =
  | { readonly ok: true; readonly lineup: LineupBody }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * The week's live status, read from `stat_weeks` (`src/db/schema.ts`) — global to the NFL
 * calendar, never scoped by league. A week the ingestion worker has never reached has no row
 * there at all, which is not the same as a week in progress: it is a week whose games have not
 * even been listed, so it reads as `"scheduled"` — open, exactly like a week that is on the
 * calendar but has not kicked off. Locking on absence would freeze every league's lineups the
 * first time the worker was down.
 */
export async function weekStatusFor(db: Db, weekNumber: number): Promise<WeekStatus> {
  const [row] = await db.select({ status: statWeeks.status }).from(statWeeks).where(eq(statWeeks.week, weekNumber));
  return row?.status ?? "scheduled";
}

/**
 * A week is locked once it has started, not once it has been scored — see `isLineupLocked`
 * (`@/league/week-status.ts`) for the rationale. Phase 1's "both scores exist" rule was correct
 * only when a score appeared solely because a commissioner pressed a button; live scoring makes
 * that a hole, since a manager could watch a player leave the field and swap him out before the
 * week is ever scored.
 */
export async function isWeekLocked(db: Db, weekNumber: number): Promise<boolean> {
  return isLineupLocked(await weekStatusFor(db, weekNumber));
}

/**
 * Saves one team's lineup for one week.
 *
 * Legality comes from `validateLineup` (`src/domain/roster-eligibility.ts`) — reused, never
 * restated — applied to the STARTING slots only, since it treats an empty slot as invalid and
 * a bench spot is legitimately empty. Its `reason` is returned verbatim: it is already plain
 * language, and paraphrasing it here would be a second copy of the rule.
 *
 * The two checks around it are about this TEAM rather than about slot legality, so they are
 * the boundary's own: every named player must actually be on the roster, and no player may
 * occupy two spots.
 *
 * The lock is checked TWICE: once up front, so an obviously-locked week costs one query and a
 * clear refusal, and again inside the write transaction, with `SELECT … FOR SHARE` on the week's
 * `stat_weeks` row. The up-front check alone is a read-validate-write hole: four more round trips
 * (roster, players, validation) run between it and the upsert, and the ingestion worker flips the
 * week to `in_progress` inside `persistTick`'s own transaction with no coordination — so a lineup
 * submitted in that window used to be accepted after kickoff. `FOR SHARE` blocks against
 * `persistTick`'s upsert of that row, which is the same read-validate-write hole Plan A closed
 * for drafts with `SELECT … FOR UPDATE` on the draft row.
 *
 * `cache` is injected with a no-op default so every existing caller keeps working without a
 * Redis connection. When a real cache is supplied, its cached score for this league/week is
 * invalidated AFTER the write below completes — not inside it. The failure mode of a
 * slightly-late eviction is one stale read; the failure mode of an early one (evicting before
 * the write is durable) is a cache that says a lineup changed when the write that would have
 * changed it never actually landed.
 *
 * `deps.audit` records `lineup_change` on the league's own chain, INSIDE the write transaction
 * and after the in-transaction lock re-check — never before it, and never outside it. An event
 * written before that re-check would record a lineup change that the lock then refused; one
 * written outside the transaction could commit for a write that then rolled back. Both default
 * to the process-wide collaborators (`getAuditLogger()`, a real clock) the same way every other
 * writer here defaults its own.
 */
export async function setLineup(
  db: Db,
  input: SetLineupInput,
  cache: Pick<ScoreCache, "invalidate"> = NOOP_SCORE_CACHE,
  deps: { readonly audit?: AuditLogger; readonly clock?: Clock } = {},
): Promise<SetLineupResult> {
  const audit = deps.audit ?? getAuditLogger();
  const clock = deps.clock ?? systemClock;
  const [league] = await db.select({ rosterSlots: leagues.rosterSlots }).from(leagues).where(eq(leagues.id, input.leagueId));
  if (league === undefined) return { ok: false, status: 404, reason: "That league does not exist." };

  // `docs/decisions/audit-and-integrity.md`'s residual, closed: this used to trust `input.teamId`
  // and `input.leagueId` to agree without ever checking, safe only because the route derives both
  // from the session actor rather than from the request body. `autoSetLineupInTx`
  // (`@/league-service/auto-lineup`, Task 4) derives its own `teamId` from the league it is
  // iterating and cannot be wrong the way a caller-supplied pair can, so this is the assertion the
  // residual asked the next team-scoped writer to add rather than copy the omission.
  const [team] = await db.select({ leagueId: teams.leagueId }).from(teams).where(eq(teams.id, input.teamId));
  if (team === undefined || team.leagueId !== input.leagueId) {
    return { ok: false, status: 404, reason: "That team is not part of this league." };
  }

  const week = await db
    .select({ weekNumber: matchups.weekNumber })
    .from(matchups)
    .where(and(eq(matchups.leagueId, input.leagueId), eq(matchups.weekNumber, input.weekNumber)));
  if (week.length === 0) return { ok: false, status: 404, reason: "That week is not part of this league's season." };
  // PER-GAME LOCKS (roadmap item 2, 2026-08-30): a FINAL week refuses whole, exactly as
  // before. An IN-PROGRESS week no longer refuses here — the per-slot diff guard below decides,
  // player by player, because ESPN's model (and every arriving manager's expectation) is that a
  // player locks at HIS kickoff, not the week's first.
  const weekStatus = await weekStatusFor(db, input.weekNumber);
  if (weekStatus === "final") {
    return { ok: false, status: 409, reason: `Week ${input.weekNumber} has ended, so its lineup cannot change.` };
  }

  const roster = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, input.teamId));
  const owned = new Set(roster.map((row) => row.playerId).filter((id): id is string => id !== null));
  const named = input.slots.map((slot) => slot.playerId).filter((id): id is string => id !== null);
  if (named.some((id) => !owned.has(id))) return { ok: false, status: 422, reason: "One of those players is not on your team." };
  if (new Set(named).size !== named.length) return { ok: false, status: 422, reason: "You can only start a player in one spot." };

  // The BENCH is derived, never trusted from the client: it is exactly "everyone on this
  // roster who isn't starting". That is what lets the editor send only its starting slots and
  // do no lineup arithmetic of its own — which matters, because `src/league-room/**` may not
  // value-import `@/league` at all.
  const starterSlots = input.slots.filter((slot) => slot.slot !== BENCH_SLOT);
  const startingIds = new Set(starterSlots.map((slot) => slot.playerId).filter((id): id is string => id !== null));
  const benchSlots = deriveBenchSlots(owned, startingIds, league.rosterSlots);

  const lineup = defaultLineup(league.rosterSlots, [...starterSlots, ...benchSlots]);
  const playerRows = await db.select({ id: players.id, position: players.position, name: players.name, nflTeam: players.nflTeam }).from(players);
  const playerPositions = Object.fromEntries(playerRows.map((row) => [row.id, row.position]));
  const starterConfig = league.rosterSlots.filter((config) => config.slot !== BENCH_SLOT);

  const validation = validateLineup({ slotConfig: starterConfig, roster: startersOf(lineup), playerPositions });
  if (!validation.valid) return { ok: false, status: 422, reason: validation.reason };

  // THE PER-SLOT DIFF GUARD. Only for a week already in progress, and only over slots that
  // CHANGED: both ends of every change must be unlocked. The outgoing man's game started →
  // he is locked into the slot he occupies; the incoming man's game started → he cannot enter
  // after the fact (the classic post-kickoff exploit both rules exist to stop). Byes never
  // lock: a player with no fixture has no kickoff. The kickoff-clock half of
  // `startedTeamsForWeek` does not race the worker, which is what lets the in-transaction
  // re-check below stay a FINAL-only check.
  if (weekStatus === "in_progress") {
    const previous = await getLineup(db, { teamId: input.teamId, weekNumber: input.weekNumber, slotConfig: league.rosterSlots });
    const started = await startedTeamsForWeek(db, input.weekNumber, new Date(clock.now()));
    const playerById = new Map(playerRows.map((row) => [row.id, row]));
    const isLockedPlayer = (id: string | null): boolean => {
      if (id === null) return false;
      const player = playerById.get(id);
      return player !== undefined && started.has(player.nflTeam);
    };
    const nextBySlot = new Map(startersOf(lineup).map((slot) => [`${slot.slot}:${slot.slotIndex}`, slot.playerId]));
    for (const slot of startersOf(previous)) {
      const nextId = nextBySlot.get(`${slot.slot}:${slot.slotIndex}`) ?? null;
      if (nextId === slot.playerId) continue;
      if (isLockedPlayer(slot.playerId)) {
        return { ok: false, status: 409, reason: `${playerById.get(slot.playerId!)?.name ?? "That player"}'s game has started, so he is locked in your lineup until the week ends.` };
      }
      if (isLockedPlayer(nextId)) {
        return { ok: false, status: 409, reason: `${playerById.get(nextId!)?.name ?? "That player"}'s game has already started, so he cannot come off your bench this week.` };
      }
    }
  }

  const locked = await db.transaction(async (tx) => {
    // The re-check, holding a share lock on the week's row for the rest of this transaction so
    // `persistTick`'s upsert of it cannot commit underneath the write below. An absent row is a
    // week the worker has never reached, which reads as open — exactly as `weekStatusFor` treats
    // it — and is the one case no lock can cover, since there is no row yet to lock.
    const [week] = await tx.select({ status: statWeeks.status }).from(statWeeks).where(eq(statWeeks.week, input.weekNumber)).for("share");
    // FINAL-only since the per-game widening: the scheduled->in_progress flip no longer forbids
    // the write (the diff guard above already ruled on every changed slot by kickoff clock).
    if ((week?.status ?? "scheduled") === "final") return true;

    await tx
      .insert(lineupSlots)
      .values(lineup.map((slot) => ({ teamId: input.teamId, weekNumber: input.weekNumber, slot: slot.slot, slotIndex: slot.slotIndex, playerId: slot.playerId })))
      .onConflictDoUpdate({
        target: [lineupSlots.teamId, lineupSlots.weekNumber, lineupSlots.slot, lineupSlots.slotIndex],
        set: excludedSetFor(lineupSlots, ["teamId", "weekNumber", "slot", "slotIndex"]),
      });
    await audit.record(tx, {
      eventType: "lineup_change",
      actorId: input.userId,
      actorType: "user",
      leagueId: input.leagueId,
      payload: {
        teamId: input.teamId,
        weekNumber: input.weekNumber,
        // The starters as they were saved, ids only. Names are resolved when the feed is read,
        // from the tables that own them — see ruling 16.
        starters: startersOf(lineup).map((slot) => ({ slot: slot.slot, slotIndex: slot.slotIndex, playerId: slot.playerId })),
      },
      occurredAt: clock.now(),
    });
    return false;
  });
  if (locked !== false) {
    return locked === true
      ? { ok: false, status: 409, reason: `Week ${input.weekNumber} has ended, so its lineup cannot change.` }
      : locked;
  }

  // After the write commits, never inside it — see the doc comment above. Awaited and caught
  // rather than fire-and-forget: the cache degrades open on its own, so awaiting cannot fail this
  // response, but a `void` would let the response reach the browser before the DEL reached Redis
  // and an immediate re-read could hit the entry this write just made stale.
  await invalidateQuietly(cache, input.leagueId, input.weekNumber);

  const view = await lineupView(db, { leagueId: input.leagueId, teamId: input.teamId, weekNumber: input.weekNumber });
  // `view` cannot be null here: the league row was read at the top of this function.
  return { ok: true, lineup: view! };
}

/** The lineup as a page renders it: starters, bench, names, positions, and the lock. */
export async function lineupView(
  db: Db,
  input: { readonly leagueId: string; readonly teamId: string; readonly weekNumber: number },
): Promise<LineupBody | null> {
  const [league] = await db.select({ rosterSlots: leagues.rosterSlots }).from(leagues).where(eq(leagues.id, input.leagueId));
  if (league === undefined) return null;

  const lineup = await getLineup(db, { teamId: input.teamId, weekNumber: input.weekNumber, slotConfig: league.rosterSlots });
  const playerRows = await db.select().from(players);
  const playerById = new Map(playerRows.map((row) => [row.id, row]));
  const designations = await injuryDesignations(db);
  const toView = (slot: RosterSlot): LineupSlotView => {
    const player = slot.playerId === null ? undefined : playerById.get(slot.playerId);
    return {
      slot: slot.slot,
      slotIndex: slot.slotIndex,
      playerId: slot.playerId,
      playerName: player?.name ?? null,
      position: player?.position ?? null,
      injuryDesignation: slot.playerId === null ? null : (designations.get(slot.playerId) ?? null),
      // Gameday law 3: the club code and the headshot a lineup editor draws a player WITH. Free —
      // `playerById` above already holds the whole row. `adp` rides along because `Player`
      // (`@research/domain/player`) requires it, and a surface handing this slot to `PlayerFace` needs a
      // whole `Player`.
      nflTeam: player?.nflTeam ?? null,
      headshotUrl: player?.headshotUrl ?? null,
      adp: player?.adp ?? null,
    };
  };

  const status = await weekStatusFor(db, input.weekNumber);
  // Per-game locks (roadmap item 2): `locked` means the week has ENDED; mid-week the editor
  // stays open and each started player's id rides in `lockedPlayerIds`.
  const lockedPlayerIds: string[] = [];
  if (status === "in_progress") {
    const started = await startedTeamsForWeek(db, input.weekNumber, new Date());
    for (const slot of [...startersOf(lineup), ...benchOf(lineup)]) {
      if (slot.playerId === null) continue;
      const team = playerById.get(slot.playerId)?.nflTeam ?? "";
      if (started.has(team)) lockedPlayerIds.push(slot.playerId);
    }
  }
  // The IR section (roadmap item 3): owned-but-parked, rendered by the editor's own section.
  const irRows = await db.select({ playerId: injuredReserve.playerId }).from(injuredReserve).where(eq(injuredReserve.teamId, input.teamId));
  const injuredReserveViews = irRows.map((row, index) => toView({ slot: BENCH_SLOT, slotIndex: index, playerId: row.playerId }));

  return {
    weekNumber: input.weekNumber,
    locked: status === "final",
    lockedPlayerIds,
    starters: startersOf(lineup).map(toView),
    bench: benchOf(lineup).map(toView),
    injuredReserve: injuredReserveViews,
  };
}
