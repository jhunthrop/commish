import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditEvents, players, teams, users } from "@/db/schema";
import type { AuditEvent, JsonObject } from "@/domain/audit";
import { activityKindFor, activityRowFor, type ActivityKind, type ActivityNames, type ActivityRow } from "@/integrity/activity-view";
import { INTEGRITY_CONFIG } from "@/integrity/config";

/** The person who did it, as the stream draws them (Sideline P1: a face and a name first). */
export interface ActivityActor {
  readonly userId: string;
  readonly name: string;
  /** The stored avatar ref, as `Avatar` takes it. */
  readonly avatar: string | null;
}

/**
 * One visible row of the league's history, plus what the stream needs to draw it as a person
 * doing a thing: the kind of event and the actor's identity. `actor` is `null` for a platform
 * action and for a member whose row no longer resolves (the headline already says "A former
 * member"), never a placeholder face.
 */
export interface ActivityFeedRow extends ActivityRow {
  readonly kind: ActivityKind;
  readonly actor: ActivityActor | null;
}

export interface ActivityPage {
  readonly rows: readonly ActivityFeedRow[];
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

/** A stored row, as `activityRowFor` wants it: `occurredAt` back in its ISO spelling. */
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

interface MemberRow extends NameRow {
  readonly avatar: string | null;
}

/**
 * Turns the three batched lookups' results into the `ActivityNames` a page's rows render
 * through. Exported and pure so the null-actor branch of `member` is directly testable.
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

/** The person behind an event, or `null` when the platform acted or the person is gone. */
export function actorFor(event: Pick<AuditEvent, "actorId" | "actorType">, members: ReadonlyMap<string, MemberRow>): ActivityActor | null {
  if (event.actorType !== "user" || event.actorId === null) return null;
  const member = members.get(event.actorId);
  return member === undefined ? null : { userId: member.id, name: member.name, avatar: member.avatar };
}

/** The distinct, non-null values of one string payload field across a page of events. */
function distinctPayloadValues(events: readonly AuditEvent[], key: string): readonly string[] {
  return [...new Set(events.map((event) => payloadString(event.payload, key)).filter((value): value is string => value !== undefined))];
}

/** The distinct values of one string-ARRAY payload field across a page of events. */
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
 * `actor_only` row never reaches the page at all, never fetched-then-filtered-in-the-browser.
 *
 * Exactly FOUR queries, however many rows the page holds or however many of them turn out to be
 * visible: one for the page of events itself (served by `audit_events_scope_sequence_idx`, the
 * same index the chain verifier walks by), and three batched name lookups, the distinct actors
 * (name and face), the distinct players and the distinct teams named in THIS page's payloads,
 * rather than one lookup per row, which is the N+1 this shape exists to avoid. A page where every
 * row happens to be hidden or `actor_only`-denied still costs the same four queries: the
 * visibility filter runs AFTER the fetch, because deciding what to fetch would mean re-deriving
 * `ACTIVITY_VISIBILITY`'s own logic in the query layer, a second copy of the rule that module
 * exists to keep singular.
 *
 * Paging is by the RAW page of events, not by how many of them turned out visible: `nextBefore`
 * is the smallest `sequence` this page actually read, so the next call resumes the chain walk
 * exactly where this one left off rather than skipping or re-reading whatever this page hid.
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
  // `trade_accepted` and `roster_move`'s trade reason name their teams/players under
  // `proposerTeamId`/`counterpartyTeamId` and `proposerAssetIds`/`counterpartyAssetIds`, never
  // the bare `teamId`/`playerId` every other renderer uses. Gathered here too, batched alike.
  const playerIds = [...new Set([...distinctPayloadValues(events, "playerId"), ...distinctPayloadArrayValues(events, "proposerAssetIds"), ...distinctPayloadArrayValues(events, "counterpartyAssetIds")])];
  const teamIds = [...new Set([...distinctPayloadValues(events, "teamId"), ...distinctPayloadValues(events, "proposerTeamId"), ...distinctPayloadValues(events, "counterpartyTeamId")])];

  const [memberRows, playerRows, teamRows] = await Promise.all([
    actorIds.length === 0 ? [] : db.select({ id: users.id, name: users.displayName, avatar: users.avatarUrl }).from(users).where(inArray(users.id, actorIds)),
    playerIds.length === 0 ? [] : db.select({ id: players.id, name: players.name }).from(players).where(inArray(players.id, playerIds)),
    teamIds.length === 0 ? [] : db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds)),
  ]);

  const names = buildActivityNames(memberRows, playerRows, teamRows);
  const members = new Map(memberRows.map((row) => [row.id, row]));

  const visibleRows: ActivityFeedRow[] = [];
  for (const activityEvent of events) {
    const row = activityRowFor(activityEvent, { userId: viewerUserId }, names);
    if (row !== null) visibleRows.push({ ...row, kind: activityKindFor(activityEvent), actor: actorFor(activityEvent, members) });
  }

  const nextBefore = events.length === pageSize ? events[events.length - 1]!.sequence : null;
  return { rows: visibleRows, nextBefore };
}
