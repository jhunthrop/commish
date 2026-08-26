import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { MOCK_CONFIG } from "@/mock-draft/config";

/** The outermost edge is the only place a wall clock is allowed — see every other service
 *  module's identical constant (`./lobby`, `@/league-service/wire`, ...). */
const systemClock: Clock = { now: () => new Date().toISOString() };

/**
 * R3 (the lobby design review's carry) — the practice lobby's OWN wire, held to the public
 * wire's exact honesty contract (`listWireItems`, `@/league-service/wire`; "The wire's honesty
 * contract", `docs/design-system.md`) but built from a domain with NO audit trail whatsoever:
 * ruling 2's carve-out means a mock lifecycle writer appends nothing to `audit_events`, ever, so
 * `seatClaimsQuery`'s own shape has nothing here to read from.
 *
 * **A third item, `seat_taken` (a claim on an open lobby room, seats still open), was in this
 * task's original vocabulary and is deliberately NOT built.** `teams` carries no claim timestamp
 * for a mock OR a real seat (no `created_at` column anywhere on that table), team ids are plain
 * `crypto.randomUUID()` with no embedded time, and there is no audit row to fall back on the way
 * the front door's own `seat_claimed` item does — the ONE `mock_rooms.starts_at` write a claim
 * ever makes fires only on the FILLING claim (the room's last human seat, `claimMockSeatInTx`,
 * `./claim`), which is exactly the moment `seatsOpen` reaches zero — the opposite of the "seats
 * still open" case this item needs. Real-or-nothing forbids inventing a timestamp this domain
 * does not have; the honest call is two items, not three.
 *
 * The two items that ARE built read cheaply off tables the retention sweep already keeps small
 * (`MOCK_CONFIG.retention`): `mocks_running` is a bare count, and `mock_filled` rides
 * `drafts_status_idx` (`(status, kickoff_at)`, `@/db/schema`) — the SAME composite index
 * `draftsNext48hQuery` (`@/league-service/proof`) already proves serves a `status` +
 * `kickoff_at` range, measured here over a dedicated mock corpus in `src/db/index-plans.test.ts`
 * rather than assumed.
 */
export type MockWireItem =
  | {
      readonly kind: "mock_filled";
      readonly teamCount: number;
      /** How long before the page's own `now` this room went `in_progress` — a coarse proxy off
       *  `kickoff_at` (this module's own docblock explains why that column is the honest stand-
       *  in), rendered only through the `formatCoarseDuration` family, never as an instant. */
      readonly agoMs: number;
    }
  | {
      readonly kind: "mocks_running";
      /** `in_progress` mock drafts right now — the wire's one genuinely LIVE fact. */
      readonly count: number;
    };

/**
 * `mock_filled`'s own read: mock leagues (`leagues.is_mock`) whose draft went `in_progress`
 * inside `MOCK_CONFIG.wire.filledWindowMs`, newest first. `ORDER BY kickoff_at DESC` rides
 * `drafts_status_idx` backward — the same composite index `draftsNext48hQuery`'s own ascending
 * range already seeks, in the opposite direction, so no new index earns its keep here.
 *
 * Exported as a builder, not just run inline, so `src/db/index-plans.test.ts` can `EXPLAIN`
 * exactly what production runs — the same reason `listOpenMockRoomsQuery` (`./lobby`) is.
 */
export function recentlyFilledMocksQuery(db: Db, now: Date) {
  const windowStart = new Date(now.getTime() - MOCK_CONFIG.wire.filledWindowMs);
  return db
    .select({ teamCount: leagues.teamCount, kickoffAt: drafts.kickoffAt })
    .from(drafts)
    .innerJoin(
      leagues,
      and(eq(leagues.id, drafts.leagueId), eq(leagues.isMock, true)),
    )
    .where(
      and(
        eq(drafts.status, "in_progress"),
        gte(drafts.kickoffAt, windowStart),
        lte(drafts.kickoffAt, now),
      ),
    )
    .orderBy(desc(drafts.kickoffAt))
    .limit(MOCK_CONFIG.wire.maxItems);
}

/**
 * `mocks_running`'s own read: how many mock drafts are `in_progress` right now, platform-wide —
 * a bare count off the leading column of the identical `drafts_status_idx`, no time window at
 * all (there is nothing to be coarse about in a count).
 */
export function runningMocksCountQuery(db: Db) {
  return db
    .select({ count: sql<number>`count(*)::int` })
    .from(drafts)
    .innerJoin(
      leagues,
      and(eq(leagues.id, drafts.leagueId), eq(leagues.isMock, true)),
    )
    .where(eq(drafts.status, "in_progress"));
}

/**
 * THE PRACTICE WIRE'S ONE READ (R3). Read-only, request-time truth: both reads run once against
 * the SAME clock instant, through one `Promise.all` — the identical shape `listWireItems`
 * (`@/league-service/wire`) already keeps for its own multi-source batch. Returns `[]` when the
 * lobby is genuinely quiet, never a fabricated item — `MockWire` (`@/league-room/components/
 * mock-wire`) renders nothing at all below one real item, never a placeholder ("no mock data on
 * a real surface", the identical rule the real wire's own docblock states).
 *
 * `mocks_running` leads the list — it carries no age at all, so it is the wire's one always-
 * current fact, live by construction — and `mock_filled` items follow, newest first, the two
 * kinds capped together at `MOCK_CONFIG.wire.maxItems`.
 */
export async function listMockWireItems(
  db: Db,
  clock: Clock = systemClock,
): Promise<readonly MockWireItem[]> {
  const now = new Date(clock.now());
  const [filledRows, [runningRow]] = await Promise.all([
    recentlyFilledMocksQuery(db, now),
    runningMocksCountQuery(db),
  ]);

  const filled: readonly MockWireItem[] = filledRows.map((row) => ({
    kind: "mock_filled",
    teamCount: row.teamCount,
    agoMs: now.getTime() - row.kickoffAt.getTime(),
  }));
  const runningCount = runningRow?.count ?? 0;
  const running: readonly MockWireItem[] =
    runningCount > 0 ? [{ kind: "mocks_running", count: runningCount }] : [];

  return [...running, ...filled].slice(0, MOCK_CONFIG.wire.maxItems);
}
