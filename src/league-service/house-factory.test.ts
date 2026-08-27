import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { auditEvents, drafts, leagues, players, scoringSettings, teams, users } from "@/db/schema";
import type { Db } from "@/db/client";
import { autoStartDueDrafts } from "@/draft-service/auto-start";
import { DRAFT_SERVICE_CONFIG } from "@/draft-service/config";
import { createDraftStore } from "@/draft-service/store";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { HOUSE_CATALOG, type HouseRungName } from "@/matchmaking/house-catalog";
import {
  ensureHouseCatalog,
  openHouseLeaguesQuery,
  spawnHouseLeagueInTx,
  HOUSE_RECONCILER_ACTOR,
  type HouseFactoryDeps,
} from "./house-factory";
import { joinPublicLeague } from "./join";
import { rollDueDrafts } from "./roll";

const db = createTestDb();
const dbOne = createTestDb();
const dbTwo = createTestDb();
const NOW = "2026-08-23T00:00:00.000Z";
const clock = { now: () => NOW };
let nextId = 0;
const newId = () => `draft_${++nextId}`;

function deps(overrides: Partial<HouseFactoryDeps> = {}): HouseFactoryDeps {
  return { clock, newId, ...overrides };
}

async function openCountOf(target: Db, rung: HouseRungName): Promise<number> {
  return (await openHouseLeaguesQuery(target, rung, clock.now())).length;
}

async function firstOpenHouseLeague(target: Db, rung: HouseRungName): Promise<string> {
  const [row] = await openHouseLeaguesQuery(target, rung, clock.now());
  if (row === undefined) throw new Error(`no open ${rung} league`);
  return row.id;
}

async function leagueIdsOf(target: Db, rung: HouseRungName): Promise<readonly string[]> {
  const rows = await target.select({ id: leagues.id }).from(leagues).where(eq(leagues.houseRung, rung));
  return rows.map((row) => row.id);
}

let filler = 0;

/** Seats a house league to its full width through the real public-join door — the same door a
 *  stranger walks through, never a hand-inserted `teams` row. */
async function fillLeague(target: Db, leagueId: string): Promise<void> {
  const [league] = await target.select({ teamCount: leagues.teamCount }).from(leagues).where(eq(leagues.id, leagueId));
  if (league === undefined) throw new Error(`no league ${leagueId}`);
  const seated = await target.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, leagueId));
  for (let i = seated.length; i < league.teamCount; i++) {
    const userId = `filler_${++filler}`;
    await target.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
    const outcome = await joinPublicLeague({ db: target, newId, clock }, { leagueId, userId });
    if (!outcome.ok) throw new Error(outcome.reason);
  }
}

/**
 * A house league seeded the way one of the SIX legacy, pre-2026-08-26 shelf slots actually looks
 * today: spawned directly through `spawnHouseLeagueInTx` — the SAME writer the real reconciler
 * uses, never a hand-typed row shape — but bypassing `ensureHouseCatalog`'s own `openAtOnce` gate,
 * because that gate is exactly the thing a legacy row predates. `edition` is the caller's own
 * choice so a test can seed several in a known creation order (`nextEdition`'s own arithmetic
 * would otherwise renumber them one at a time).
 */
async function seedLegacyHouseLeague(target: Db, rung: HouseRungName, edition: number, opts?: { readonly filledTeams?: number }): Promise<string> {
  const leagueId = `house_${rung}_${edition}`;
  const draftId = newId();
  await target.transaction(async (tx) => {
    await spawnHouseLeagueInTx(tx, {
      leagueId,
      draftId,
      rung,
      edition,
      kickoffAt: new Date(Date.parse(NOW) + 7 * 24 * 60 * 60 * 1000),
      clock,
      audit: getAuditLogger(),
    });
  });
  for (let i = 0; i < (opts?.filledTeams ?? 0); i += 1) {
    const userId = `legacy_filler_${++filler}`;
    await target.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
    const outcome = await joinPublicLeague({ db: target, newId, clock }, { leagueId, userId });
    if (!outcome.ok) throw new Error(outcome.reason);
  }
  return leagueId;
}

async function draftIdOf(target: Db, leagueId: string): Promise<string> {
  const [row] = await target.select({ id: drafts.id }).from(drafts).where(eq(drafts.leagueId, leagueId));
  if (row === undefined) throw new Error(`no draft for ${leagueId}`);
  return row.id;
}

async function startDraftOf(target: Db, leagueId: string): Promise<void> {
  await target.update(drafts).set({ status: "in_progress" }).where(eq(drafts.leagueId, leagueId));
}

interface Snapshot {
  readonly leagues: readonly unknown[];
  readonly drafts: readonly unknown[];
  readonly scoringSettings: readonly unknown[];
  readonly auditEvents: readonly unknown[];
}

async function snapshotOf(target: Db): Promise<Snapshot> {
  return {
    leagues: await target.select().from(leagues),
    drafts: await target.select().from(drafts),
    scoringSettings: await target.select().from(scoringSettings),
    auditEvents: await target.select().from(auditEvents),
  };
}

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
  filler = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("ensureHouseCatalog", () => {
  it("opens a rung to its full width on a cold database", async () => {
    await ensureHouseCatalog(db, deps());
    expect(await openCountOf(db, "open_12")).toBe(HOUSE_CATALOG.rungs.open_12.openAtOnce);
  });

  it("opens every rung to its own full width in the same call", async () => {
    await ensureHouseCatalog(db, deps());
    for (const rung of Object.keys(HOUSE_CATALOG.rungs) as HouseRungName[]) {
      expect(await openCountOf(db, rung)).toBe(HOUSE_CATALOG.rungs[rung].openAtOnce);
    }
  });

  it("opens exactly one more when one fills, so the shelf keeps its width", async () => {
    await ensureHouseCatalog(db, deps());
    const before = await openCountOf(db, "open_12");
    await fillLeague(db, await firstOpenHouseLeague(db, "open_12"));
    await ensureHouseCatalog(db, deps());
    expect(await openCountOf(db, "open_12")).toBe(before);
  });

  it("is a no-op on a shelf that is already full, and writes nothing at all", async () => {
    await ensureHouseCatalog(db, deps());
    const before = await snapshotOf(db);
    await ensureHouseCatalog(db, deps());
    const after = await snapshotOf(db);
    expect(after).toEqual(before);
  });

  it("survives two instances reconciling the same rung on the same tick", async () => {
    // PgBouncer forbids advisory locks, so this is RESOLVED rather than PREVENTED: both
    // reconcilers compute the same next edition, therefore the same deterministic id, therefore
    // one INSERT wins the primary key and the other is a clean no-op. Two real connections,
    // because a single-connection test would prove nothing about the case this defends against.
    const [a, b] = await Promise.all([ensureHouseCatalog(dbOne, deps()), ensureHouseCatalog(dbTwo, deps())]);
    // `opened` spans every rung this call restocked, not just `open_12` — filter to the one
    // rung this test is about before comparing against its own shelf width.
    const openedFor = (outcome: { readonly opened: readonly string[] }, rung: HouseRungName) =>
      outcome.opened.filter((id) => id.startsWith(`house_${rung}_`));
    expect(await openCountOf(db, "open_12")).toBe(HOUSE_CATALOG.rungs.open_12.openAtOnce);
    expect(openedFor(a, "open_12").length + openedFor(b, "open_12").length).toBe(HOUSE_CATALOG.rungs.open_12.openAtOnce);
    // No duplicate, no gap: the union of what each instance thinks it opened for this rung is
    // exactly the shelf's own ids.
    expect(new Set([...openedFor(a, "open_12"), ...openedFor(b, "open_12")])).toEqual(new Set(await leagueIdsOf(db, "open_12")));
  });

  it("counts a league that filled as closed, because a full league is not a seat", async () => {
    await ensureHouseCatalog(db, deps());
    await fillLeague(db, await firstOpenHouseLeague(db, "open_12"));
    expect(await openCountOf(db, "open_12")).toBe(HOUSE_CATALOG.rungs.open_12.openAtOnce - 1);
  });

  it("counts a league whose draft has started as closed, even with a seat still open", async () => {
    // `browseQuery` already refuses to list a league whose draft is not `scheduled`. The count
    // and the shelf must agree, or the factory restocks against a shelf nobody can see.
    await ensureHouseCatalog(db, deps());
    await startDraftOf(db, await firstOpenHouseLeague(db, "open_12"));
    expect(await openCountOf(db, "open_12")).toBe(HOUSE_CATALOG.rungs.open_12.openAtOnce - 1);
  });

  it("never reuses an edition number, so a replacement is never a resurrection", async () => {
    await ensureHouseCatalog(db, deps());
    const first = await firstOpenHouseLeague(db, "open_12");
    await fillLeague(db, first);
    await ensureHouseCatalog(db, deps());
    expect(await leagueIdsOf(db, "open_12")).toContain(first);
    expect(new Set(await leagueIdsOf(db, "open_12")).size).toBe(HOUSE_CATALOG.rungs.open_12.openAtOnce + 1);
  });

  it("stamps every spawn with a real, distinct deterministic id (house_<rung>_<edition>)", async () => {
    await ensureHouseCatalog(db, deps());
    // `beginner_12`'s own width dropped to 1 (founder directive 2026-08-26) — one cold spawn.
    const ids = await leagueIdsOf(db, "beginner_12");
    expect([...ids].sort()).toEqual(["house_beginner_12_1"]);
  });

  it("gives a when_full rung's spawn a far-future placeholder kickoff, never an immediately-due one", async () => {
    // `sitandgo_12` is retired to `openAtOnce: 0` (founder directive 2026-08-26) and never
    // spawns any more — `open_12` is the live `when_full` rung this now proves against.
    await ensureHouseCatalog(db, deps());
    const [draft] = await db
      .select({ kickoffAt: drafts.kickoffAt })
      .from(drafts)
      .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
      .where(eq(leagues.houseRung, "open_12"));
    expect(draft).toBeDefined();
    expect(Date.parse(draft!.kickoffAt.toISOString())).toBeGreaterThan(Date.parse(NOW));
  });

  it("stamps every spawn's leagues row public, house-owned and on the rung's own tier", async () => {
    await ensureHouseCatalog(db, deps());
    const [league] = await db.select().from(leagues).where(eq(leagues.id, "house_beginner_12_1"));
    expect(league).toMatchObject({
      commissionerUserId: null,
      houseRung: "beginner_12",
      isPublicMatchmade: true,
      experienceTier: HOUSE_CATALOG.rungs.beginner_12.experienceTier,
      teamCount: HOUSE_CATALOG.rungs.beginner_12.teamCount,
    });
  });

  it("carries every rung's fee terms through the one write shape — free, whole-shelf, until the founder flips a rung (Task 8)", async () => {
    await ensureHouseCatalog(db, deps());
    for (const rung of Object.keys(HOUSE_CATALOG.rungs) as (keyof typeof HOUSE_CATALOG.rungs)[]) {
      const spawned = await db.select().from(leagues).where(eq(leagues.houseRung, rung));
      // `sitandgo_12` is retired to `openAtOnce: 0` (founder directive 2026-08-26) — a cold
      // catalog spawns nothing for it, so only the two live rungs have anything to check here.
      if (HOUSE_CATALOG.rungs[rung].openAtOnce === 0) {
        expect(spawned.length).toBe(0);
        continue;
      }
      expect(spawned.length).toBeGreaterThan(0);
      for (const league of spawned) {
        expect({ id: league.id, entryFeeCents: league.entryFeeCents, platformFeeCents: league.platformFeeCents, payoutTable: league.payoutTable }).toEqual({
          id: league.id,
          entryFeeCents: HOUSE_CATALOG.rungs[rung].entryFeeCents,
          platformFeeCents: HOUSE_CATALOG.rungs[rung].platformFeeCents,
          payoutTable: HOUSE_CATALOG.rungs[rung].payoutTable,
        });
      }
    }
  });

  it("records a house_league_opened system_action on the new league's own chain", async () => {
    await ensureHouseCatalog(db, deps());
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.chainScope, "house_open_12_1"));
    // One `league_created` (the shared write path every league gets) and one `house_league_opened`.
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.eventType).sort()).toEqual(["league_created", "system_action"]);
    const systemAction = rows.find((row) => row.eventType === "system_action");
    expect(systemAction!.payload).toMatchObject({ action: "house_league_opened" });
    expect(systemAction!.actorId).toBeNull();
    expect(systemAction!.actorType).toBe("system");
  });

  it("never throws past one rung's own failure, and reports it on refused rather than the caller", async () => {
    const throwingAudit: AuditLogger = {
      record: async () => {
        throw new Error("audit boom");
      },
      recordAll: async () => {
        throw new Error("audit boom");
      },
    };
    const outcome = await ensureHouseCatalog(db, deps({ audit: throwingAudit }));
    expect(outcome.opened).toEqual([]);
    // Only the rungs with a real shortfall to attempt ever reach the `catch` that populates
    // `refused` — `sitandgo_12` is retired to `openAtOnce: 0` (founder directive 2026-08-26), so
    // its attempt ceiling is `0` and it is never attempted, therefore never refused either.
    const liveRungs = (Object.keys(HOUSE_CATALOG.rungs) as HouseRungName[]).filter((rung) => HOUSE_CATALOG.rungs[rung].openAtOnce > 0);
    expect(outcome.refused.length).toBe(liveRungs.length);
    for (const refusal of outcome.refused) {
      expect(liveRungs).toContain(refusal.rung);
      expect(refusal.reason.length).toBeGreaterThan(0);
    }
    // A failed spawn attempt never partially commits — the transaction it ran in rolled back
    // whole, so nothing about it is on the shelf at all.
    expect(await snapshotOf(db)).toEqual({ leagues: [], drafts: [], scoringSettings: [], auditEvents: [] });
  });

  // Founder directive 2026-08-26: sitandgo_12 is retired to `openAtOnce: 0` — `open_12` is the
  // sit-and-go now. The shortfall arithmetic needed no new guard for this (`rung.openAtOnce * 3`
  // is `0`, and `open.length >= rung.openAtOnce` is true at zero leagues too); this test is that
  // claim, proven rather than reasoned about.
  it("spawns nothing at all for a retired, openAtOnce: 0 rung, and never throws over it", async () => {
    const outcome = await ensureHouseCatalog(db, deps());
    expect(await openCountOf(db, "sitandgo_12")).toBe(0);
    expect(await leagueIdsOf(db, "sitandgo_12")).toEqual([]);
    expect(outcome.opened.some((id) => id.startsWith("house_sitandgo_12_"))).toBe(false);
    expect(outcome.refused.some((refusal) => refusal.rung === "sitandgo_12")).toBe(false);
  });

  it("ignores a malformed edition suffix rather than corrupting the next one it mints", async () => {
    // Never reachable through this reconciler's own writes — every id it ever mints matches
    // `house_${rung}_${edition}` by construction. A hand-inserted row with a non-numeric suffix
    // is the state `Number.isFinite` defends against: a row `nextEdition` cannot parse must not
    // poison `highest` with `NaN`, which `NaN > highest` would otherwise silently swallow.
    await db.insert(leagues).values({
      id: "house_open_12_bogus", name: "Bogus", format: "snake", teamCount: HOUSE_CATALOG.rungs.open_12.teamCount,
      commissionerUserId: null, houseRung: "open_12",
    });
    await ensureHouseCatalog(db, deps());
    // `open_12`'s own width dropped to 1 (founder directive 2026-08-26) — one real spawn, at
    // edition 1, since the bogus row's unparseable suffix never counted toward `nextEdition`.
    const ids = await leagueIdsOf(db, "open_12");
    expect(ids).toContain("house_open_12_1");
  });
});

describe("openHouseLeaguesQuery", () => {
  it("is empty for a rung with no leagues at all", async () => {
    expect(await openCountOf(db, "open_12")).toBe(0);
  });
});

/**
 * FOUNDER DIRECTIVE 2026-08-26 — THE STALL THIS BLOCK USED TO PROVE IS NOW STRUCTURALLY
 * IMPOSSIBLE FOR A HOUSE LEAGUE, not merely untested. Final whole-branch review F2's fix
 * (`houseKickoffStillAhead`) protected an under-filled `'scheduled'`-trigger house league whose
 * fixed kickoff had passed. Every `HOUSE_CATALOG` rung is `'when_full'` now (width dropped
 * 6 → 2), and `houseKickoffStillAhead` reads TRUE UNCONDITIONALLY for a `'when_full'` draft (its
 * first `OR` branch, `@/league-service/house-factory.ts`) — there is no clock left for a house
 * league's shelf slot to age past. The old two-test scenario ("kickoff passes while unfilled" /
 * "kickoff passes while full") cannot be constructed through the reconciler at all any more, so
 * this is the new invariant, proven directly rather than left unasserted: a house league's shelf
 * slot survives arbitrary clock passage, and only filling or starting ever closes it.
 */
describe("a house league no longer stalls by clock alone, because every rung is when_full", () => {
  it("stays on the shelf a year later, untouched by the clock, until it fills or starts", async () => {
    await ensureHouseCatalog(db, deps());
    const rung = HOUSE_CATALOG.rungs.open_12;
    expect(await openCountOf(db, "open_12")).toBe(rung.openAtOnce);

    const aYearLater = { now: () => new Date(Date.parse(NOW) + 365 * 24 * 60 * 60 * 1000).toISOString() };
    expect((await openHouseLeaguesQuery(db, "open_12", aYearLater.now())).map((row) => row.id)).toContain("house_open_12_1");
    expect(await openCountOf(db, "open_12")).toBe(rung.openAtOnce);

    // The reconciler, asked again at that same far-future instant, restocks nothing — there was
    // never a shortfall to see, because the clock never created one.
    const outcome = await ensureHouseCatalog(db, deps({ clock: aYearLater }));
    expect(outcome.opened).toEqual([]);
  });
});

/**
 * PHASE 3.6, TASK 7's ROLL, NOW STRUCTURALLY EXCLUDED FROM EVERY HOUSE LEAGUE (founder directive
 * 2026-08-26). The roll only ever touches a `startTrigger: 'scheduled'` draft
 * (`dueUnfilledScheduledDraftsQuery`'s own predicate and `rollUnfilledDraftInTx`'s own
 * `ROLL_REFUSALS.notScheduled`, both `@/league-service/roll.ts`) — every house rung is
 * `'when_full'` now, so no house league's draft ever carries `startTrigger: 'scheduled'` for the
 * roll to find. This is the "rolls for member-created scheduled leagues are untouched behavior"
 * half of the founder's directive, proven directly against a real, short-of-capacity, way-overdue
 * house league rather than merely asserted: the roll finds nothing to do for it, ever.
 */
describe("the roll no longer reaches a house league at all — Task 7's mechanism is member-only now", () => {
  it("skips a short, way-overdue house league entirely — it was never startTrigger: scheduled", async () => {
    await ensureHouseCatalog(db, deps());
    const leagueId = "house_open_12_1";

    // A short room, some seats taken, not all — the exact shape the roll exists to catch for a
    // MEMBER-created scheduled league.
    const [league] = await db.select({ teamCount: leagues.teamCount }).from(leagues).where(eq(leagues.id, leagueId));
    const shortOf = 3;
    for (let i = 0; i < (league?.teamCount ?? 0) - shortOf; i++) {
      const userId = `stall_filler_${++filler}`;
      await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
      const outcome = await joinPublicLeague({ db, newId, clock }, { leagueId, userId });
      if (!outcome.ok) throw new Error(outcome.reason);
    }

    // Way overdue by any clock — proves this is about `startTrigger`, not merely about being
    // early relative to some placeholder.
    const wayLater = { now: () => new Date(Date.parse(NOW) + 30 * 24 * 60 * 60 * 1000).toISOString() };
    const draftId = await draftIdOf(db, leagueId);

    const outcomes = await rollDueDrafts(db, { clock: wayLater });
    expect(outcomes.find((outcome) => outcome.draftId === draftId)).toBeUndefined();

    // Untouched — no roll count, still exactly the placeholder `ensureHouseCatalog` wrote it.
    const [draft] = await db.select({ kickoffRolls: drafts.kickoffRolls }).from(drafts).where(eq(drafts.id, draftId));
    expect(draft?.kickoffRolls).toBe(0);
  });
});

describe("the reconciler -> auto-start -> reconciler loop (fix round 1, F2)", () => {
  it("drafting a spawned house league closes its shelf slot, and the next reconcile restocks it with a fresh edition", async () => {
    // Stock the shelf for real.
    await ensureHouseCatalog(db, deps());
    const rung = HOUSE_CATALOG.rungs.open_12;
    const firstLeagueId = "house_open_12_1";
    expect(await leagueIdsOf(db, "open_12")).toContain(firstLeagueId);

    // Fill it to capacity through the real public-join door — the same door a stranger walks
    // through, never a hand-inserted `teams` row.
    await fillLeague(db, firstLeagueId);
    expect(await openCountOf(db, "open_12")).toBe(rung.openAtOnce - 1);

    const [draftRowBefore] = await db.select({ id: drafts.id, status: drafts.status }).from(drafts).where(eq(drafts.leagueId, firstLeagueId));
    expect(draftRowBefore?.status).toBe("scheduled");

    // A real pool to draft from — `reduceStart` (`@/draft-engine/reduce.ts`) refuses a pool
    // smaller than `teamCount * totalRosterSlots(rosterShape)` (12 * 15 = 180 for this rung's
    // standard shape), not just an empty one.
    const positions = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
    await db.insert(players).values(
      Array.from({ length: 200 }, (_, i) => ({
        id: `hf_p_${i}`,
        name: `Pool Player ${i}`,
        position: positions[i % positions.length],
        nflTeam: "KC",
      })),
    );

    // A minute past `fireWhenFullInTx`'s own grace window — `fillLeague`'s last join (on the
    // fixed module `clock`, `NOW`) fired the trigger and wrote `kickoff_at = NOW +
    // graceSeconds` (`./fill-trigger.ts`); this rung is `when_full` now, so that grace window is
    // its ONLY real kickoff — advanced on a LOCAL clock, never a hand-flipped `status` column, so
    // the real `autoStartDueDrafts` scan is what starts it.
    const dueAt = new Date(Date.parse(NOW) + MATCHMAKING_CONFIG.sitAndGo.graceSeconds * 1_000 + 60_000).toISOString();
    const laterClock = { now: () => dueAt };
    const store = createDraftStore({ db, publish: async () => "1-0", clock: laterClock });
    const outcomes = await autoStartDueDrafts(db, { store, clock: laterClock });
    expect(outcomes).toContainEqual({ draftId: draftRowBefore!.id, started: true });

    const [draftRowAfter] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.leagueId, firstLeagueId));
    expect(draftRowAfter?.status).toBe("in_progress");

    // Off the shelf for the SECOND reason `openHouseLeaguesQuery` closes a league: the draft
    // left `scheduled`, not that it filled (already proven above) — a started draft with an
    // open seat would still have to be closed, and this is the branch that's true here.
    expect(await openCountOf(db, "open_12")).toBe(rung.openAtOnce - 1);

    // THE ACTUAL PRODUCT LOOP: the next reconcile sees the shortfall this drafted league left
    // and restocks it — with a FRESH edition, never a resurrection of #1, which just drafted.
    await ensureHouseCatalog(db, deps());
    expect(await openCountOf(db, "open_12")).toBe(rung.openAtOnce);
    const ids = await leagueIdsOf(db, "open_12");
    expect(ids).toContain(firstLeagueId); // still exists — closed, not deleted
    expect(new Set(ids).size).toBe(rung.openAtOnce + 1); // the original 1, plus #1's replacement
  });
});

/**
 * STOREFRONT REVIEW E13: the reconciler retires surplus, oldest-empty-first, down to
 * `openAtOnce` — the surplus half of "the lobby is never empty, and never too crowded either",
 * proven directly against a shelf shaped like the real one: six legacy leagues predating the
 * 2026-08-26 directive, seeded through the SAME `spawnHouseLeagueInTx` writer the reconciler
 * itself uses (`seedLegacyHouseLeague`).
 */
describe("ensureHouseCatalog retires surplus empties (storefront review E13)", () => {
  it("retires the surplus empties oldest-first down to openAtOnce, and never touches a seated league", async () => {
    // Four legacy `open_12` leagues (openAtOnce is 1): #1 and #3 and #4 empty, #2 has a member.
    // Creation order is the seeded order (editions ascending), so the oldest-first rule says
    // #1, then #3, then #4 — never #2, whatever its age.
    await seedLegacyHouseLeague(db, "open_12", 1);
    await seedLegacyHouseLeague(db, "open_12", 2, { filledTeams: 1 });
    await seedLegacyHouseLeague(db, "open_12", 3);
    await seedLegacyHouseLeague(db, "open_12", 4);
    expect(await openCountOf(db, "open_12")).toBe(4);

    await ensureHouseCatalog(db, deps());

    // The surplus (3, comfortably inside the default retire budget) is gone; the seated league
    // and exactly one shelf slot's worth remain ON THE SHELF — `leagueIdsOf` would still find a
    // retired league's ROW (dissolution closes, it never deletes), so "remains open" is read
    // through `openHouseLeaguesQuery` instead, the same predicate the shelf itself reads by.
    expect(await openCountOf(db, "open_12")).toBe(1);
    const stillOpen = (await openHouseLeaguesQuery(db, "open_12", clock.now())).map((row) => row.id);
    expect(stillOpen).toEqual(["house_open_12_2"]);

    for (const retiredId of ["house_open_12_1", "house_open_12_3", "house_open_12_4"]) {
      const [draft] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.leagueId, retiredId));
      // Closed, never deleted — the SAME "dissolved" mark `dissolveLeague` stamps for an
      // operator-closed league (`@/money-service/dissolution`).
      expect(draft?.status).toBe("dissolved");

      const auditRows = await db.select().from(auditEvents).where(eq(auditEvents.chainScope, retiredId));
      const dissolution = auditRows.find(
        (row) => row.eventType === "system_action" && (row.payload as { action?: string }).action === "league_dissolved",
      );
      expect(dissolution).toBeDefined();
      expect(dissolution!.actorId).toBeNull();
      expect(dissolution!.actorType).toBe("system");
      expect((dissolution!.payload as { operatorUserId?: string }).operatorUserId).toBe(HOUSE_RECONCILER_ACTOR);
    }

    // The seated league's own draft never left `scheduled` — retirement stopped at the first
    // league with a member, exactly as the rule requires.
    const [survivorDraft] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.leagueId, "house_open_12_2"));
    expect(survivorDraft?.status).toBe("scheduled");
  });

  it("never retires a league with even one seated team, whatever the surplus", async () => {
    await seedLegacyHouseLeague(db, "beginner_12", 1, { filledTeams: 1 });
    await seedLegacyHouseLeague(db, "beginner_12", 2, { filledTeams: 2 });
    expect(await openCountOf(db, "beginner_12")).toBe(2);

    await ensureHouseCatalog(db, deps());

    // Both leagues carry a member — a surplus of two seated leagues over `openAtOnce: 1` is left
    // standing, on purpose (this function's own docblock): a seated manager is never evicted to
    // make the shelf's width arithmetic come out even.
    expect(await openCountOf(db, "beginner_12")).toBe(2);
    for (const leagueId of ["house_beginner_12_1", "house_beginner_12_2"]) {
      const [draft] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.leagueId, leagueId));
      expect(draft?.status).toBe("scheduled");
    }
  });

  it("bounds retirement at DRAFT_SERVICE_CONFIG.maxHouseRetiresPerRun per reconcile, finishing on the next tick", async () => {
    const surplusCount = DRAFT_SERVICE_CONFIG.maxHouseRetiresPerRun + 2;
    for (let edition = 1; edition <= surplusCount; edition += 1) {
      await seedLegacyHouseLeague(db, "open_12", edition);
    }
    expect(await openCountOf(db, "open_12")).toBe(surplusCount);

    await ensureHouseCatalog(db, deps());
    // Exactly one tick's worth of retirement happened — the rest is still open, waiting.
    expect(await openCountOf(db, "open_12")).toBe(surplusCount - DRAFT_SERVICE_CONFIG.maxHouseRetiresPerRun);

    await ensureHouseCatalog(db, deps());
    // The next tick finishes the job, down to the rung's own width.
    expect(await openCountOf(db, "open_12")).toBe(HOUSE_CATALOG.rungs.open_12.openAtOnce);
  });

  it("reports every retired id on the outcome's own retired list", async () => {
    await seedLegacyHouseLeague(db, "open_12", 1);
    await seedLegacyHouseLeague(db, "open_12", 2);
    const outcome = await ensureHouseCatalog(db, deps());
    expect(outcome.retired).toEqual(["house_open_12_1"]);
  });

  it("lets a fun-named spawn appear once the legacy surplus clears and the survivor fills (integration through ensureHouseCatalog)", async () => {
    // Three legacy leagues, all empty — the surplus this test clears in one tick.
    await seedLegacyHouseLeague(db, "open_12", 1);
    await seedLegacyHouseLeague(db, "open_12", 2);
    await seedLegacyHouseLeague(db, "open_12", 3);

    await ensureHouseCatalog(db, deps());
    expect(await openCountOf(db, "open_12")).toBe(1);
    const survivorId = await firstOpenHouseLeague(db, "open_12");

    // Fill the survivor so the shelf goes short again — the reconciler's ordinary shortfall path,
    // unchanged by this task, spawns the replacement with a curated fun name (`houseLeagueName`),
    // never the retired "Open 12-team League N" shape (founder directive 2026-08-26).
    await fillLeague(db, survivorId);
    await ensureHouseCatalog(db, deps());

    const ids = await leagueIdsOf(db, "open_12");
    const freshSpawnId = ids.find((id) => id !== survivorId && !id.endsWith("_1") && !id.endsWith("_2") && !id.endsWith("_3"));
    expect(freshSpawnId).toBeDefined();
    const [spawned] = await db.select({ name: leagues.name }).from(leagues).where(eq(leagues.id, freshSpawnId!));
    expect(spawned?.name).not.toMatch(/^Open 12-team League \d+$/);
  });
});
