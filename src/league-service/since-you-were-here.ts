import { asc, getTableColumns, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditEvents } from "@/db/schema";
import type { AuditEvent } from "@/domain/audit";
import { activityKindFor, activityRowFor, type ActivityKind } from "@/integrity/activity-view";
import { actorFor, resolveActivityNames, type ActivityActor } from "@/integrity-service/activity";
import type { SinceYouWereHere } from "@/league-room/contract";

/**
 * How deep into each league's chain one read looks for something this manager may see. A league
 * can carry a run of rows that render nothing for a given reader (another manager's lineup
 * change, a proposal, a rejection, every one of them denied by `ACTIVITY_VISIBILITY` before it is
 * ever rendered), so taking literally the newest row per league would report "nothing happened"
 * in a room that has been busy all week. Eight is the depth at which a room whose entire recent
 * history is invisible to this reader is genuinely a room with nothing to tell them, and it keeps
 * the one statement's result set bounded at eight rows per league however long the chain is.
 */
const LOOKBACK_ROWS = 8;

/** A lineup change is `actor_only`, so this reader's OWN lineup changes do render — and they are
 *  exactly the thing this line must not say ("since you were here" is what someone else did, not
 *  a receipt for what you did). Trade negotiation needs no rule here: `trade_proposed` and
 *  `trade_rejected` are `hidden` for everyone, which is the visibility rule this read keeps
 *  rather than re-decides. */
const NOT_NEWS: ReadonlySet<ActivityKind> = new Set<ActivityKind>(["lineup"]);

export interface LatestActivityInput {
  readonly leagueIds: readonly string[];
  readonly viewerUserId: string;
}

/** A windowed row, as `activityRowFor` wants it: the window's own `depth` column dropped and
 *  `occurredAt` back in its ISO spelling. */
function toEvent({ depth: _depth, ...row }: typeof auditEvents.$inferSelect & { readonly depth: number }): AuditEvent {
  return { ...row, occurredAt: row.occurredAt.toISOString() };
}

function toLine(headline: string, detail: string | null, occurredAt: string, kind: ActivityKind, actor: ActivityActor | null): SinceYouWereHere {
  return { headline, detail, occurredAt, kind, actor };
}

/**
 * THE LATEST THING THIS MANAGER MAY SEE, IN EVERY LEAGUE AT ONCE (P12: what brings a manager back
 * is what changed). `listLeagueActivity` (`@/integrity-service/activity`) answers this for one
 * league and pages; a page about ten leagues cannot call it ten times, so this walks every
 * league's chain in ONE statement: a `row_number() over (partition by chain_scope order by
 * sequence desc)` window, cut at `LOOKBACK_ROWS`, over exactly the league ids the caller is
 * already a member of.
 *
 * VISIBILITY IS NOT RE-DECIDED HERE. Every candidate row goes through the same `activityRowFor`
 * the league's own stream uses, so a hidden type or an `actor_only` row this reader did not cause
 * never renders, and a payload the renderers do not recognize renders nothing — the deny-by-
 * default this product holds every audit payload to, reused rather than re-implemented against a
 * second, narrower rule that could drift. The one thing this read adds is `NOT_NEWS`: this
 * reader's own lineup change is visible to them and is still not news to them.
 *
 * ABSENT MEANS ABSENT. A league with nothing visible in its last `LOOKBACK_ROWS` rows is simply
 * missing from the map, and the card draws no line at all rather than a placeholder that looks
 * like data.
 *
 * Costs the one window statement plus `resolveActivityNames`' three batched `IN` lookups, however
 * many leagues are asked about — the same four-query shape `listLeagueActivity` already commits
 * to for one.
 */
export async function latestActivityByLeague(db: Db, { leagueIds, viewerUserId }: LatestActivityInput): Promise<ReadonlyMap<string, SinceYouWereHere>> {
  if (leagueIds.length === 0) return new Map();

  const ranked = db
    .select({
      ...getTableColumns(auditEvents),
      depth: sql<number>`row_number() over (partition by ${auditEvents.chainScope} order by ${auditEvents.sequence} desc)`.as("depth"),
    })
    .from(auditEvents)
    .where(inArray(auditEvents.chainScope, leagueIds))
    .as("ranked");

  const windowed = await db.select().from(ranked).where(lte(ranked.depth, LOOKBACK_ROWS)).orderBy(asc(ranked.chainScope), asc(ranked.depth));

  const events = windowed.map((entry) => toEvent(entry));
  const { names, members } = await resolveActivityNames(db, events);

  const latest = new Map<string, SinceYouWereHere>();
  for (const entry of windowed) {
    // Ordered by depth ascending within each partition, so the first row that renders for a
    // league is that league's newest visible one and every later row is older by construction.
    if (latest.has(entry.chainScope)) continue;
    const event = toEvent(entry);
    const kind = activityKindFor(event);
    if (NOT_NEWS.has(kind)) continue;
    const rendered = activityRowFor(event, { userId: viewerUserId }, names);
    if (rendered === null) continue;
    latest.set(entry.chainScope, toLine(rendered.headline, rendered.detail, rendered.occurredAt, kind, actorFor(event, members)));
  }
  return latest;
}
