import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, teams } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { LEAGUE_CONFIG } from "@/league/config";
import { ENFORCED_LEAGUE_SQL } from "@/league-service/enforcement";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { ProofStats } from "@/matchmaking/contract";
import { reviewAggregate } from "@/review-service/reviews";

/** A draft that actually ran — never `'scheduled'`, which is a room still waiting on a seat. */
const DRAFTED_STATUSES = ["in_progress", "complete"] as const;

export interface ProofStatsDeps {
  /** Defaults to the real wall clock. Every test in `proof.test.ts` injects one, per this
   *  module's own "never `Date.now()` outside the edge" rule. */
  readonly clock?: Clock;
}

/**
 * "Leagues filled this season" (Phase 3.6, Task 4) — a claim about rooms that got to draft, not
 * about rows. A league sitting at capacity with a `'scheduled'` draft has not yet done the thing
 * being counted, and counting it would inflate the number by exactly the leagues most likely to
 * still fall over before kickoff. `drafts_league_id_idx`'s own uniqueness (`@/db/schema`) is what
 * makes `count(*)` over this join exactly "leagues", never a fan-out — one draft per league,
 * always.
 *
 * "This season" reads `LEAGUE_CONFIG.season.startedAt` (`@/league/config`) — a fixed boundary,
 * read once here, never re-derived from `now()` or from a league's own age. A proof stat that
 * quietly counted forever would grow into a number that says nothing about now.
 *
 * Deliberately NOT joined on `ENFORCED_LEAGUE_SQL`: this is a total count across every league,
 * public or private, and a bare total discloses nothing about any one private league the way an
 * aggregate broken out BY league (`fillingRoomsQuery`'s own reasoning, below) would.
 *
 * `NOT is_mock` (Phase 4.5, Task 2): the ONE aggregate `ENFORCED_LEAGUE_SQL` does not already
 * keep a mock out of. Every other query in this module (and `wire.ts`'s three) is scoped to
 * `is_public_matchmade = true`, which a mock never is by construction — this is the deliberately
 * unscoped exception, and the only one this whole feature needs to touch: a drafted mock counts
 * as a league that "got to draft" by every predicate this query already applies, and would
 * inflate a number the front door and the wire both read from this exact query (`wire.ts`'s own
 * `seasonCount`) if it were not excluded here.
 *
 * Exported as a builder, not just run inline, mirroring `browseQuery` (`@/league-service/browse`)
 * — `src/db/index-plans.test.ts` EXPLAINs this exact statement rather than a hand copy.
 */
export function leaguesFilledQuery(db: Db) {
  return db
    .select({ count: sql<number>`count(*)::int` })
    .from(leagues)
    .innerJoin(drafts, eq(drafts.leagueId, leagues.id))
    .where(
      and(
        inArray(drafts.status, DRAFTED_STATUSES),
        gte(leagues.createdAt, new Date(LEAGUE_CONFIG.season.startedAt)),
        eq(leagues.isMock, false),
      ),
    );
}

/**
 * THE ONE CANDIDATE SET both R1 "filling" proof reads share (storefront review R1) — public,
 * still-joinable leagues (`ENFORCED_LEAGUE_SQL`, `@/league-service/enforcement`) that at least
 * one team has already joined and that are not yet full. `teams` is INNER joined, not left —
 * that alone is what keeps a genuinely empty room out of the `GROUP BY` entirely, so no `HAVING
 * count(...) > 0` is needed to say "at least one seat taken". `status = 'scheduled'` reads "still
 * joinable" regardless of `start_trigger`: a `when_full` room's placeholder kickoff never enters
 * either query below, because neither reads `kickoff_at` at all — this is the fill-based
 * replacement for the scheduled-kickoff facts a `when_full` shelf no longer produces
 * (`docs/decisions/formats-and-lobby.md`, "The whole shelf is sit-and-go").
 *
 * ONE predicate, TWO readers (`roomsFillingQuery` counts the rows, `tightestRoomQuery` reads the
 * smallest `remainingSeats`) — the identical "two readers, one rule" discipline
 * `houseKickoffStillAhead` (`@/league-service/house-factory`) already holds itself to, so the
 * front door's live count and its tightest-room chip can never disagree about which rooms are
 * "filling".
 */
function fillingRoomsQuery(db: Db) {
  return db
    .select({
      leagueId: leagues.id,
      remainingSeats: sql<number>`(${leagues.teamCount} - count(${teams.id}))::int`.as("remaining_seats"),
    })
    .from(leagues)
    .innerJoin(drafts, eq(drafts.leagueId, leagues.id))
    .innerJoin(teams, eq(teams.leagueId, leagues.id))
    .where(and(eq(drafts.status, "scheduled"), ENFORCED_LEAGUE_SQL))
    .groupBy(leagues.id, drafts.id)
    .having(sql`count(${teams.id}) < ${leagues.teamCount}`);
}

/**
 * "Rooms filling now" (storefront review R1) — repoints "drafts in the next 48 hours", a fact no
 * `when_full` house rung produces any more, onto a fact this world actually has: how many public
 * rooms have somebody already sitting in them. `count(*)` over `fillingRoomsQuery`'s own
 * one-row-per-league result, so the plan rides the SAME `leagues_public_browse_idx` /
 * `drafts_status_idx` seek `draftsNext48hQuery` used to (`src/db/index-plans.test.ts`), with one
 * additional join (`teams_league_id_idx`) for the seat count neither predecessor query needed.
 *
 * No time window, unlike the query it replaces: "somebody is sitting in this room right now"
 * does not go stale the way a future kickoff instant would — the 60-second proof cache
 * (`MATCHMAKING_CONFIG.proof.cacheTtlSeconds`) is what keeps this number fresh, the same as every
 * other proof stat.
 */
export function roomsFillingQuery(db: Db) {
  const filling = fillingRoomsQuery(db).as("filling_rooms");
  return db.select({ count: sql<number>`count(*)::int` }).from(filling);
}

/**
 * "The tightest room" (storefront review R1) — repoints "the earliest scheduled kickoff" (a fact
 * a `when_full` shelf has none of) onto "how few seats are left in the room closest to full", over
 * the SAME `fillingRoomsQuery` candidate set `roomsFillingQuery` counts. A filling room is this
 * world's version of "next draft": the fewer seats it has left, the sooner it fires
 * (`fireWhenFullInTx`). `null` when nothing is filling — real or absent, never dressed up.
 */
export function tightestRoomQuery(db: Db) {
  const filling = fillingRoomsQuery(db).as("filling_rooms");
  return db.select({ min: sql<number | null>`min(${filling.remainingSeats})` }).from(filling);
}

/**
 * The front door's proof strip (Phase 3.6, Task 4), real only. Three independent reads —
 * `leaguesFilledQuery`, `roomsFillingQuery` and `reviewAggregate` (`@/review-service/reviews`)
 * — run concurrently through `Promise.all` on the same pooled `db`, the identical idiom
 * `listLeagueActivity` (`@/integrity-service/activity.ts`) already uses for its own three batched
 * reads: independent statements against a connection pool, not three round trips serialized for
 * no reason.
 *
 * FOUNDER RULING, made mechanism: no fabricated number, no placeholder, no rounded-up
 * substitute. Each stat is compared against its own floor
 * (`MATCHMAKING_CONFIG.proof.floors`) and replaced with `null` — never a hidden zero, never a
 * dressed-up small number — the instant it has not earned belief yet. `any` is `false` exactly
 * when every field is `null`, which is what lets a caller hide the whole strip with one read
 * rather than re-deriving "is there anything to show" from the three fields itself.
 *
 * The rating average is rounded to one decimal place HERE, in this display-facing function, not
 * in `reviewAggregate` — that function hands back the raw average as a fact; rounding for
 * display is this module's call to make, the same separation `summarizeRow`
 * (`@/league-service/browse.ts`) draws between a row's raw fields and its derived, rendered ones.
 *
 * `deps.clock` is UNREAD here (storefront review R1: neither "filling" query takes a time window
 * any more, and neither ever did for `leaguesFilledQuery`/`reviewAggregate`) — `ProofStatsDeps`
 * keeps the field anyway rather than breaking every existing caller's `{ clock }` shape over a
 * plumbing change, and `proof.test.ts`'s own `deps` fixture is untouched by it.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for API compatibility, see this function's own docblock
export async function proofStats(db: Db, _deps: ProofStatsDeps = {}): Promise<ProofStats> {
  const floors = MATCHMAKING_CONFIG.proof.floors;

  const [[filledRow], [fillingRow], [tightestRow], aggregate] = await Promise.all([
    leaguesFilledQuery(db),
    roomsFillingQuery(db),
    tightestRoomQuery(db),
    reviewAggregate(db),
  ]);

  const leaguesFilledCount = filledRow?.count ?? 0;
  const roomsFillingCount = fillingRow?.count ?? 0;

  const leaguesFilled = leaguesFilledCount >= floors.leaguesFilled ? leaguesFilledCount : null;
  const roomsFillingNow = roomsFillingCount >= floors.roomsFillingNow ? roomsFillingCount : null;
  const rating = aggregate.count >= floors.reviewCount ? { average: Math.round(aggregate.average * 10) / 10, count: aggregate.count } : null;
  const tightestRoomSeatsRemaining = tightestRow?.min ?? null;

  // `any` stays blind to `tightestRoomSeatsRemaining` on purpose — the chip rides a strip the
  // other stats earned, it never carries the strip itself (`ProofStats` own docblock).
  return {
    leaguesFilled,
    roomsFillingNow,
    rating,
    tightestRoomSeatsRemaining,
    any: leaguesFilled !== null || roomsFillingNow !== null || rating !== null,
  };
}
