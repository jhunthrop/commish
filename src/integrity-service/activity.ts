import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditEvents, players, teams, users } from "@/db/schema";
import type { AuditEvent, JsonObject } from "@/domain/audit";
import { activityRowFor, type ActivityNames, type ActivityRow } from "@/integrity/activity-view";
import { INTEGRITY_CONFIG } from "@/integrity/config";

export interface ActivityPage {
  readonly rows: readonly ActivityRow[];
  /** Pass back as `before` to read the next (older) page. `null` once this page reached the
   *  start of the chain — there is nothing older to ask for. */
  readonly nextBefore: number | null;
}

export interface ListLeagueActivityInput {
  readonly leagueId: string;
  readonly viewerUserId: string;
  /** A `sequence` from a previous page's `nextBefore`. Omit for the newest page. */
  readonly before?: number;
}

/** A stored row, as `activityRowFor` wants it: `occurredAt` back in its ISO spelling. The same
 *  shape `verify.ts`'s own `toEvent` produces, kept local rather than shared — one three-field
 *  spread is not worth a cross-module dependency for. */
function toEvent(row: typeof auditEvents.$inferSelect): AuditEvent {
  return { ...row, occurredAt: row.occurredAt.toISOString() };
}

function payloadString(payload: JsonObject, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

const FALLBACK_MEMBER = "A former member";
const FALLBACK_PLAYER = "A player who is no longer listed";
const FALLBACK_TEAM = "A team that's no longer in the league";

interface NameRow {
  readonly id: string;
  readonly name: string;
}

/**
 * Turns the three batched lookups' results into the `ActivityNames` a page's rows render
 * through. Exported and pure — decoupled from the query above — so the null-actor branch of
 * `member` (the shape a future system-attributed renderer, e.g. a `system_action` template that
 * names who it acted on, would call it with) is directly testable without first routing a real
 * event through `listLeagueActivity`; today's renderers never pass `member` a null id, but the
 * `ActivityNames` interface's own signature commits to handling one.
 */
export function buildActivityNames(memberRows: readonly NameRow[], playerRows: readonly NameRow[], teamRows: readonly NameRow[]): ActivityNames {
  const memberNameById = new Map(memberRows.map((row) => [row.id, row.name]));
  const playerNameById = new Map(playerRows.map((row) => [row.id, row.name]));
  const teamNameById = new Map(teamRows.map((row) => [row.id, row.name]));
  return {
    member: (userId) => (userId === null ? FALLBACK_MEMBER : (memberNameById.get(userId) ?? FALLBACK_MEMBER)),
    player: (playerId) => playerNameById.get(playerId) ?? FALLBACK_PLAYER,
    team: (teamId) => teamNameById.get(teamId) ?? FALLBACK_TEAM,
  };
}

/** The distinct, non-null values of one string payload field across a page of events — the input
 *  every batched name lookup below needs, and nothing more (never a per-row query). */
function distinctPayloadValues(events: readonly AuditEvent[], key: string): readonly string[] {
  return [...new Set(events.map((event) => payloadString(event.payload, key)).filter((value): value is string => value !== undefined))];
}

/** The distinct, non-null values of one string-ARRAY payload field across a page of events —
 *  `trade_accepted`/`roster_move`'s own `proposerAssetIds`/`counterpartyAssetIds`, the one shape
 *  `distinctPayloadValues` (a single string field) cannot read. */
function distinctPayloadArrayValues(events: readonly AuditEvent[], key: string): readonly string[] {
  const values = events.flatMap((event) => {
    const value = event.payload[key];
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  });
  return [...new Set(values)];
}

/**
 * The read side of the member-visible activity feed: one league's chain, newest first, run
 * through `activityRowFor` (`@/integrity/activity-view`) so a hidden type or a denied
 * `actor_only` row never reaches the page at all — never fetched-then-filtered-in-the-browser.
 *
 * Exactly FOUR queries, however many rows the page holds or however many of them turn out to be
 * visible: one for the page of events itself (served by `audit_events_scope_sequence_idx`, the
 * same index the chain verifier walks by), and three batched name lookups — the distinct actors,
 * the distinct players and the distinct teams named in THIS page's payloads — rather than one
 * lookup per row, which is the N+1 this shape exists to avoid. A page where every row happens to
 * be hidden or `actor_only`-denied still costs the same four queries: the visibility filter runs
 * AFTER the fetch, because deciding what to fetch would mean re-deriving `ACTIVITY_VISIBILITY`'s
 * own logic in the query layer, a second copy of the rule this module exists to keep singular.
 *
 * Paging is by the RAW page of events, not by how many of them turned out visible: `nextBefore` is
 * the smallest `sequence` this page actually read, so the next call resumes the chain walk exactly
 * where this one left off rather than skipping or re-reading whatever this page hid.
 */
export async function listLeagueActivity(db: Db, { leagueId, viewerUserId, before }: ListLeagueActivityInput): Promise<ActivityPage> {
  const pageSize = INTEGRITY_CONFIG.activity.pageSize;
  const rows = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.chainScope, leagueId), before === undefined ? undefined : lt(auditEvents.sequence, before)))
    .orderBy(desc(auditEvents.sequence))
    .limit(pageSize);

  const events = rows.map(toEvent);

  const actorIds = [...new Set(events.map((event) => event.actorId).filter((id): id is string => id !== null))];
  // `trade_accepted` (`renderTradeAccepted`) and `roster_move`'s own trade reason
  // (`renderRosterMove`) name their teams/players under `proposerTeamId`/`counterpartyTeamId`
  // and `proposerAssetIds`/`counterpartyAssetIds` — never the bare `teamId`/`playerId` every
  // OTHER renderer uses (`draft_pick`, `lineup_change`, …). Gathered here too, batched exactly
  // like the other two, so a real trade in a real feed reads real names rather than falling back
  // to "a team that's no longer in the league" for a team that plainly still is.
  const playerIds = [...new Set([...distinctPayloadValues(events, "playerId"), ...distinctPayloadArrayValues(events, "proposerAssetIds"), ...distinctPayloadArrayValues(events, "counterpartyAssetIds")])];
  const teamIds = [...new Set([...distinctPayloadValues(events, "teamId"), ...distinctPayloadValues(events, "proposerTeamId"), ...distinctPayloadValues(events, "counterpartyTeamId")])];

  const [memberRows, playerRows, teamRows] = await Promise.all([
    actorIds.length === 0 ? [] : db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, actorIds)),
    playerIds.length === 0 ? [] : db.select({ id: players.id, name: players.name }).from(players).where(inArray(players.id, playerIds)),
    teamIds.length === 0 ? [] : db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds)),
  ]);

  const names = buildActivityNames(memberRows, playerRows, teamRows);

  const visibleRows: ActivityRow[] = [];
  for (const activityEvent of events) {
    const row = activityRowFor(activityEvent, { userId: viewerUserId }, names);
    if (row !== null) visibleRows.push(row);
  }

  const nextBefore = events.length === pageSize ? events[events.length - 1]!.sequence : null;
  return { rows: visibleRows, nextBefore };
}
