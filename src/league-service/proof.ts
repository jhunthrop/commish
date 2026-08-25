import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { LEAGUE_CONFIG } from "@/league/config";
import { ENFORCED_LEAGUE_SQL } from "@/league-service/enforcement";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { ProofStats } from "@/matchmaking/contract";
import { reviewAggregate } from "@/review-service/reviews";

/** The outermost edge is the only place a wall clock is allowed — see every other service
 *  module's identical constant (`browse.ts`, `creation.ts`, `read.ts`, ...). */
const systemClock: Clock = { now: () => new Date().toISOString() };

const MS_PER_HOUR = 60 * 60 * 1000;
/** The window `draftsNext48hQuery` counts inside — named once so the query and this module's
 *  own docblock can never state two different numbers of hours. */
const NEXT_48H_MS = 48 * MS_PER_HOUR;

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
 * aggregate broken out BY league (`draftsNext48hQuery`'s own reasoning) would.
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
 * "Drafts in the next 48 hours" (Phase 3.6, Task 4) — counted over `'scheduled'` drafts whose
 * `kickoff_at` falls in `[now, now + 48h]`, joined on `ENFORCED_LEAGUE_SQL`
 * (`@/league-service/enforcement`) so a private league's calendar is never disclosed in
 * aggregate, the identical join `dueDraftsQuery` (`@/draft-service/auto-start`) already applies
 * to the same table for the same reason.
 *
 * `now` is a parameter, never read from inside this function — the caller's `Clock`
 * (`proofStats` below) is the one and only source of "now" for this query.
 */
export function draftsNext48hQuery(db: Db, now: Date) {
  const in48h = new Date(now.getTime() + NEXT_48H_MS);
  return db
    .select({ count: sql<number>`count(*)::int` })
    .from(drafts)
    .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
    .where(and(eq(drafts.status, "scheduled"), gte(drafts.kickoffAt, now), lte(drafts.kickoffAt, in48h), ENFORCED_LEAGUE_SQL));
}

/**
 * "Next draft" (Phase 3.7, Task 7 — the phase's one sanctioned `proof.ts` addition):
 * `min(kickoff_at)` over `'scheduled'` drafts joined on `ENFORCED_LEAGUE_SQL`
 * (`@/league-service/enforcement`) — read-only, and the SAME privacy join `draftsNext48hQuery`
 * above applies for the same reason: a private league's calendar is never disclosed in
 * aggregate, and a MIN is an aggregate that would otherwise leak one private instant exactly.
 *
 * Bounded to `[now, now + MATCHMAKING_CONFIG.proof.nextDraftWithinMs]` in SQL, mirroring
 * `draftsNext48hQuery`'s own window idiom: outside the window the scoreboard chip is omitted by
 * construction (see the config field's docblock — real or absent, never dressed up), so there is
 * no post-hoc filter for a caller to forget.
 */
export function nextDraftAtQuery(db: Db, now: Date) {
  const horizon = new Date(now.getTime() + MATCHMAKING_CONFIG.proof.nextDraftWithinMs);
  return db
    .select({ min: sql<Date | string | null>`min(${drafts.kickoffAt})` })
    .from(drafts)
    .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
    .where(and(eq(drafts.status, "scheduled"), gte(drafts.kickoffAt, now), lte(drafts.kickoffAt, horizon), ENFORCED_LEAGUE_SQL));
}

/** `min()` comes back from the driver as a `Date` (pg parses the timestamp OID itself, drizzle
 *  never sees a raw `sql` fragment's type) — normalized to the ISO string the contract states,
 *  defensively accepting a string in case a driver upgrade changes the parse. */
function toIsoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  return new Date(value).toISOString();
}

/**
 * The front door's proof strip (Phase 3.6, Task 4), real only. Three independent reads —
 * `leaguesFilledQuery`, `draftsNext48hQuery` and `reviewAggregate` (`@/review-service/reviews`)
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
 */
export async function proofStats(db: Db, deps: ProofStatsDeps = {}): Promise<ProofStats> {
  const clock = deps.clock ?? systemClock;
  const now = new Date(clock.now());
  const floors = MATCHMAKING_CONFIG.proof.floors;

  const [[filledRow], [next48hRow], [nextDraftRow], aggregate] = await Promise.all([
    leaguesFilledQuery(db),
    draftsNext48hQuery(db, now),
    nextDraftAtQuery(db, now),
    reviewAggregate(db),
  ]);

  const leaguesFilledCount = filledRow?.count ?? 0;
  const draftsNext48hCount = next48hRow?.count ?? 0;

  const leaguesFilled = leaguesFilledCount >= floors.leaguesFilled ? leaguesFilledCount : null;
  const draftsNext48h = draftsNext48hCount >= floors.draftsNext48h ? draftsNext48hCount : null;
  const rating = aggregate.count >= floors.reviewCount ? { average: Math.round(aggregate.average * 10) / 10, count: aggregate.count } : null;
  const nextDraftAt = toIsoOrNull(nextDraftRow?.min ?? null);

  // `any` stays blind to `nextDraftAt` on purpose — the chip rides a strip the three floored
  // stats earned, it never carries the strip itself (`ProofStats.nextDraftAt`'s own docblock).
  return { leaguesFilled, draftsNext48h, rating, nextDraftAt, any: leaguesFilled !== null || draftsNext48h !== null || rating !== null };
}
