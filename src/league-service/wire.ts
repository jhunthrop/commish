import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditEvents, drafts, leagues, teams } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { ENFORCED_LEAGUE_SQL } from "@/league-service/enforcement";
import { leaguesFilledQuery } from "@/league-service/proof";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { WireItem } from "@/matchmaking/contract";

/** The outermost edge is the only place a wall clock is allowed — see every other service
 *  module's identical constant (`browse.ts`, `proof.ts`, `creation.ts`, ...). */
const systemClock: Clock = { now: () => new Date().toISOString() };

/**
 * A release rides `member_joined` with `payload.outcome: "seat_released"` (the audit compromise,
 * `releaseSeat`, `@/league-service/release`) — the wire must never read one as a claim, so the
 * predicate is written once here and shared by the claim read and the fill-recency join below.
 * `IS DISTINCT FROM` rather than `<>`: a real claim's payload has no `outcome` key at all, and a
 * plain inequality against SQL NULL would silently drop every genuine claim.
 */
const NOT_A_SEAT_RELEASE = sql`${auditEvents.payload}->>'outcome' is distinct from 'seat_released'`;

/**
 * `seat_claimed` (Phase 3.7, Task 8): the most recent seats claimed in PUBLIC leagues inside
 * `MATCHMAKING_CONFIG.wire.windowMs` — real `member_joined` audit rows, joined to `leagues` on
 * `ENFORCED_LEAGUE_SQL` (`@/league-service/enforcement`) so a private league's membership
 * activity is never disclosed, the identical privacy join `roomsFillingQuery`
 * (`@/league-service/proof`) already applies for the identical reason.
 *
 * The `teams` aggregate rides the same statement so each claim carries the league's open-seat
 * count at read time — the fact the component's live tint keys on. `audit_events.event_id` is
 * the table's primary key and `leagues.id` is its table's, so every ungrouped column is
 * functionally dependent on the `GROUP BY` — the same proof `browseQuery`'s own grouping
 * comments walk through.
 *
 * `actor_id` is deliberately never selected (S9): an anonymous surface has no business learning
 * who claimed the seat, so the projection cannot leak what it never reads.
 */
export function seatClaimsQuery(db: Db, now: Date) {
  const windowStart = new Date(now.getTime() - MATCHMAKING_CONFIG.wire.windowMs);
  return db
    .select({
      leagueName: leagues.name,
      occurredAt: auditEvents.occurredAt,
      teamCount: leagues.teamCount,
      filledTeams: sql<number>`count(${teams.id})::int`,
    })
    .from(auditEvents)
    .innerJoin(leagues, eq(leagues.id, auditEvents.leagueId))
    .leftJoin(teams, eq(teams.leagueId, leagues.id))
    .where(
      and(
        eq(auditEvents.eventType, "member_joined"),
        NOT_A_SEAT_RELEASE,
        gte(auditEvents.occurredAt, windowStart),
        lte(auditEvents.occurredAt, now),
        ENFORCED_LEAGUE_SQL,
      ),
    )
    .groupBy(auditEvents.eventId, leagues.id)
    .orderBy(desc(auditEvents.occurredAt))
    .limit(MATCHMAKING_CONFIG.wire.maxItems);
}

/**
 * `league_filled`: PUBLIC leagues at capacity whose draft is still ahead of or on the board
 * (`'scheduled'` reads "drafting soon", `'in_progress'` reads "drafting now" — a `'complete'`
 * draft is last week's news, not a ticker item), ordered by fill recency.
 *
 * "Fill recency" is the league's newest genuine `member_joined` moment — the last seat that
 * landed — read off the same audit rows `seatClaimsQuery` reads, `LEFT JOIN`ed so a full league
 * whose joins predate the audit chain (never true in production) still appears, last.
 * `count(distinct ${teams.id})`, not `count(*)`: the audit join fans each seat row out across
 * the league's events, and the DISTINCT is what keeps the capacity comparison exact anyway.
 */
export function filledLeaguesQuery(db: Db) {
  return db
    .select({
      leagueName: leagues.name,
      draftStatus: drafts.status,
    })
    .from(leagues)
    .innerJoin(drafts, eq(drafts.leagueId, leagues.id))
    .leftJoin(teams, eq(teams.leagueId, leagues.id))
    .leftJoin(auditEvents, and(eq(auditEvents.leagueId, leagues.id), eq(auditEvents.eventType, "member_joined"), NOT_A_SEAT_RELEASE))
    .where(and(ENFORCED_LEAGUE_SQL, inArray(drafts.status, ["scheduled", "in_progress"])))
    .groupBy(leagues.id, drafts.id)
    .having(sql`count(distinct ${teams.id}) = ${leagues.teamCount}`)
    .orderBy(sql`max(${auditEvents.occurredAt}) desc nulls last`, asc(leagues.createdAt))
    .limit(MATCHMAKING_CONFIG.wire.maxItems);
}

/**
 * Round-robin across the four kinds rather than concatenation, so the capped ticker reads as
 * varied activity the way the approved mock's does — a burst of twelve claims never crowds the
 * one season-count item off the wire. Deterministic: source order within a kind is each query's
 * own `ORDER BY`, and the rotation order is fixed by the caller's list order.
 */
function interleave(lists: readonly (readonly WireItem[])[], cap: number): readonly WireItem[] {
  const merged: WireItem[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let rank = 0; rank < longest && merged.length < cap; rank += 1) {
    for (const list of lists) {
      const item = list[rank];
      if (item !== undefined && merged.length < cap) merged.push(item);
    }
  }
  return merged;
}

/**
 * THE WIRE'S ONE READ (Phase 3.7, Task 8 — the phase's sanctioned `league-service` addition
 * beside `proof.ts`'s next-draft query and `summarizeRow`'s `draftAtIso` projection). Read-only:
 * no transaction, no lock, no write, ever.
 *
 * REQUEST-TIME TRUTH WITH COARSE TIMESTAMPS. Both consuming pages (`/`, `/browse` signed out)
 * are `force-dynamic`, so this runs once per render against the page's ONE clock instant; the
 * scrolling is CSS (`animate-wire`), never a socket — there is no anonymous SSE fan-out for
 * signed-out visitors (deferral D4), and the wire does not pretend otherwise, the same honesty
 * `seatCountsAsOfSentence` (`@/league-room/components/public-league-list`) already words for the
 * shelf's seat counts.
 *
 * THREE independent reads through ONE `Promise.all` on the same pooled `db` — the identical
 * idiom `proofStats` (`./proof`) uses for its own batched reads. The third IS `proofStats`'s
 * own `leaguesFilledQuery`, imported rather than respelled, gated by the same
 * `MATCHMAKING_CONFIG.proof.floors.leaguesFilled` floor — the wire and the scoreboard can never
 * state two different season counts because they run one query against one floor.
 *
 * Storefront review R1: `draftsTonightQuery`/`draft_tonight` is RETIRED, down from four reads to
 * three — every `HOUSE_CATALOG` rung is `when_full` now, so a sit-and-go room has no chosen
 * kickoff for this read to find, and resurrecting a fourth read against a fact the shelf no
 * longer produces would starve on the exact schedule the review found. `seatClaimed` (already
 * tinted live the instant a claim leaves a room urgently short of seats) and `leagueFilled`
 * already tell this world's own "filling" story honestly — see `WireItem`'s own docblock.
 *
 * Returns `[]` rather than padding when the product is quiet — no fabricated item, no
 * placeholder, ever ("no mock data on a real surface"); `Wire` renders nothing at all below
 * `UI_CONFIG.wire.minItems`. Every sentence the component builds from these items is actor-free
 * (S9) — see `WireItem`'s own docblock.
 */
export async function listWireItems(db: Db, clock: Clock = systemClock): Promise<readonly WireItem[]> {
  const now = new Date(clock.now());

  const [claimRows, filledRows, [seasonRow]] = await Promise.all([
    seatClaimsQuery(db, now),
    filledLeaguesQuery(db),
    leaguesFilledQuery(db),
  ]);

  const seatClaimed: readonly WireItem[] = claimRows.map((row) => ({
    kind: "seat_claimed",
    leagueName: row.leagueName,
    agoMs: now.getTime() - row.occurredAt.getTime(),
    seatsOpen: row.teamCount - row.filledTeams,
  }));
  const leagueFilled: readonly WireItem[] = filledRows.map((row) => ({
    kind: "league_filled",
    leagueName: row.leagueName,
    // The WHERE already restricts to the two wire-worthy statuses; this narrows the row type
    // to the contract's union without a cast.
    draftStatus: row.draftStatus === "in_progress" ? "in_progress" : "scheduled",
  }));
  const seasonCountValue = seasonRow?.count ?? 0;
  const seasonCount: readonly WireItem[] =
    seasonCountValue >= MATCHMAKING_CONFIG.proof.floors.leaguesFilled ? [{ kind: "season_count", count: seasonCountValue }] : [];

  return interleave([seatClaimed, leagueFilled, seasonCount], MATCHMAKING_CONFIG.wire.maxItems);
}
