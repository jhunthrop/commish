import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { auditEvents, drafts, leagues, players, scoringSettings, teams, users } from "@/db/schema";
import type { Db } from "@/db/client";
import { autoStartDueDrafts } from "@/draft-service/auto-start";
import { createDraftStore } from "@/draft-service/store";
import type { AuditLogger } from "@/integrity-service/audit-logger";
import { HOUSE_CATALOG, houseKickoffFor, type HouseRungName } from "@/matchmaking/house-catalog";
import { ensureHouseCatalog, openHouseLeaguesQuery, type HouseFactoryDeps } from "./house-factory";
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
    const ids = await leagueIdsOf(db, "beginner_12");
    expect([...ids].sort()).toEqual(["house_beginner_12_1", "house_beginner_12_2"]);
  });

  it("gives a when_full rung's spawn a far-future placeholder kickoff, never an immediately-due one", async () => {
    await ensureHouseCatalog(db, deps());
    const [draft] = await db
      .select({ kickoffAt: drafts.kickoffAt })
      .from(drafts)
      .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
      .where(eq(leagues.houseRung, "sitandgo_12"));
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
    expect(outcome.refused.length).toBe(Object.keys(HOUSE_CATALOG.rungs).length);
    for (const refusal of outcome.refused) {
      expect(Object.keys(HOUSE_CATALOG.rungs)).toContain(refusal.rung);
      expect(refusal.reason.length).toBeGreaterThan(0);
    }
    // A failed spawn attempt never partially commits — the transaction it ran in rolled back
    // whole, so nothing about it is on the shelf at all.
    expect(await snapshotOf(db)).toEqual({ leagues: [], drafts: [], scoringSettings: [], auditEvents: [] });
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
    const ids = await leagueIdsOf(db, "open_12");
    expect(ids).toContain("house_open_12_1");
    expect(ids).toContain("house_open_12_2");
    expect(ids).toContain("house_open_12_3");
  });
});

describe("openHouseLeaguesQuery", () => {
  it("is empty for a rung with no leagues at all", async () => {
    expect(await openCountOf(db, "open_12")).toBe(0);
  });
});

/**
 * FINAL WHOLE-BRANCH REVIEW, F2 — THE PERMANENT STALL.
 *
 * An under-filled `scheduled`-trigger house league whose kickoff passed used to hold its shelf
 * slot forever. `reduceStart` (`@/draft-engine`) refuses a draft with fewer than two teams, so
 * its status never left `'scheduled'`; this query had no kickoff predicate, so it kept counting
 * toward the rung's width and the reconciler never restocked; and `houseShelfQuery` kept
 * rendering it at the TOP of the public shelf, reading "starting now". Nothing could repair it by
 * hand either — a house league's kickoff refuses edits by design. One predicate on both queries
 * (`houseKickoffStillAhead`) retires it from both roles at the same instant.
 */
describe("a stale scheduled-trigger house league", () => {
  /** `open_12`'s first slot kicks off `firstKickoffMinutes` out; this is a minute past that. */
  function justPastTheFirstKickoff(): { readonly now: () => string } {
    const dueAt = new Date(Date.parse(houseKickoffFor(NOW, HOUSE_CATALOG.rungs.open_12, 0)) + 60_000).toISOString();
    return { now: () => dueAt };
  }

  it("stops counting toward the shelf, and the next reconcile opens a fresh edition in its place", async () => {
    await ensureHouseCatalog(db, deps());
    const rung = HOUSE_CATALOG.rungs.open_12;
    expect(await openCountOf(db, "open_12")).toBe(rung.openAtOnce);

    // Nobody joined `house_open_12_1`, and its chosen time came and went.
    const laterClock = justPastTheFirstKickoff();
    expect((await openHouseLeaguesQuery(db, "open_12", laterClock.now())).map((row) => row.id)).not.toContain("house_open_12_1");
    expect((await openHouseLeaguesQuery(db, "open_12", laterClock.now())).length).toBe(rung.openAtOnce - 1);

    // THE POINT: the shortfall is now visible, so the reconciler restocks the slot — with a
    // fresh edition, never a resurrection of the stalled one (ruling 35).
    const outcome = await ensureHouseCatalog(db, deps({ clock: laterClock }));
    expect(outcome.opened).toEqual([`house_open_12_${rung.openAtOnce + 1}`]);
    expect((await openHouseLeaguesQuery(db, "open_12", laterClock.now())).length).toBe(rung.openAtOnce);

    // Closed, not deleted — the stalled league's row and its members' history stay exactly where
    // they are. No abandonment state machine ships with this fix (Phase 3.6's Task 7, "roll until
    // full", replaces this whole door).
    expect(await leagueIdsOf(db, "open_12")).toContain("house_open_12_1");
  });

  it("leaves a stale but FULL league alone — a full room is startable, so it is not stalled at all", async () => {
    await ensureHouseCatalog(db, deps());
    const rung = HOUSE_CATALOG.rungs.open_12;
    await fillLeague(db, "house_open_12_1");

    const laterClock = justPastTheFirstKickoff();
    // It was already off the shelf for being FULL, before its kickoff ever passed — the staleness
    // predicate adds nothing here and takes nothing away.
    expect((await openHouseLeaguesQuery(db, "open_12", laterClock.now())).length).toBe(rung.openAtOnce - 1);

    // And it still STARTS, through the real scan: `dueDraftsQuery`/`autoStartDueDrafts` never
    // consulted the shelf-width predicate and still do not. A full room whose time has come is
    // exactly the room this platform exists to draft.
    const positions = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
    await db.insert(players).values(
      Array.from({ length: 200 }, (_, i) => ({
        id: `stale_p_${i}`, name: `Pool Player ${i}`, position: positions[i % positions.length], nflTeam: "KC",
      })),
    );
    const store = createDraftStore({ db, publish: async () => "1-0", clock: laterClock });
    const outcomes = await autoStartDueDrafts(db, { store, clock: laterClock });
    expect(outcomes).toContainEqual({ draftId: await draftIdOf(db, "house_open_12_1"), started: true });

    const [row] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.leagueId, "house_open_12_1"));
    expect(row?.status).toBe("in_progress");
  });
});

/**
 * PHASE 3.6, TASK 7 — THE COMPOSITION THIS DESCRIBE BLOCK'S OWN DOCBLOCK PROMISED. "No abandonment
 * state machine ships with this fix (Phase 3.6's Task 7, 'roll until full', replaces this whole
 * door)" — this is that replacement, proven rather than asserted. A stale scheduled-trigger house
 * league does not sit retired forever waiting for a fresh edition to paper over it: the SAME
 * `dueDraftsQuery`/`autoStartDueDrafts` scan that starts a full public league (`ENFORCED_LEAGUE_
 * SQL` is `is_public_matchmade = true`, and a house league's own `spawnHouseLeagueInTx` always
 * writes that) finds this one too, sees its room is not full, and ROLLS its kickoff forward
 * instead. The instant that write lands, `houseKickoffStillAhead` reads TRUE again for this exact
 * row — the identical predicate `houseShelfQuery` (public) and `openHouseLeaguesQuery`
 * (reconciler) both already gate on — so the league re-enters BOTH roles on the very same write
 * that retired it, with no separate "unstall" step and no state this task had to invent.
 */
describe("a stale scheduled-trigger house league composes with the roll (Task 7)", () => {
  it("rolls instead of stalling, and re-enters the shelf the instant its kickoff moves forward", async () => {
    await ensureHouseCatalog(db, deps());
    const rung = HOUSE_CATALOG.rungs.open_12;
    const leagueId = "house_open_12_1";

    // A short room, the exact shape the founder's ruling exists for — some seats taken, not all.
    const [league] = await db.select({ teamCount: leagues.teamCount }).from(leagues).where(eq(leagues.id, leagueId));
    const shortOf = 3;
    for (let i = 0; i < (league?.teamCount ?? 0) - shortOf; i++) {
      const userId = `stall_filler_${++filler}`;
      await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
      const outcome = await joinPublicLeague({ db, newId, clock }, { leagueId, userId });
      if (!outcome.ok) throw new Error(outcome.reason);
    }

    // `open_12`'s first slot kicks off `firstKickoffMinutes` out; this is a minute past that —
    // the identical instant `justPastTheFirstKickoff` (the stall describe block above) computes.
    const dueAt = new Date(Date.parse(houseKickoffFor(NOW, rung, 0)) + 60_000).toISOString();
    const laterClock = { now: () => dueAt };
    // Off the shelf, exactly as the existing stall test already proves.
    expect((await openHouseLeaguesQuery(db, "open_12", laterClock.now())).map((row) => row.id)).not.toContain(leagueId);

    // THE COMPOSITION: the roll finds it (still short a seat, still due) and moves its kickoff
    // forward — never starts it, because `roomIsFull` still says no.
    const outcomes = await rollDueDrafts(db, { clock: laterClock });
    const draftId = await draftIdOf(db, leagueId);
    const rolledThisLeague = outcomes.find((outcome) => outcome.draftId === draftId);
    expect(rolledThisLeague).toMatchObject({ rolled: true });

    const [draft] = await db.select({ kickoffAt: drafts.kickoffAt, kickoffRolls: drafts.kickoffRolls }).from(drafts).where(eq(drafts.id, draftId));
    expect(draft?.kickoffRolls).toBe(1);
    expect(Date.parse(draft!.kickoffAt.toISOString())).toBeGreaterThan(Date.parse(laterClock.now()));

    // BACK ON THE SHELF — the SAME `houseKickoffStillAhead` predicate that retired it a moment
    // ago now reads TRUE again for the SAME row, with no second write and no unstall step.
    expect((await openHouseLeaguesQuery(db, "open_12", laterClock.now())).map((row) => row.id)).toContain(leagueId);
    // And the reconciler, asked again right now, sees the shelf as it actually is — full width,
    // not short one slot the way the old retire-and-replace shape would have reported it.
    expect(await openCountOf(db, "open_12")).toBe(rung.openAtOnce);
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

    // A minute past this league's real, staggered kickoff (`houseKickoffFor`'s own index-0
    // arithmetic) — advanced on a LOCAL clock, never a hand-flipped `status` column, so the real
    // `autoStartDueDrafts` scan is what starts it.
    const dueAt = new Date(Date.parse(houseKickoffFor(NOW, rung, 0)) + 60_000).toISOString();
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
    expect(new Set(ids).size).toBe(rung.openAtOnce + 1); // the original 3, plus #1's replacement
  });
});
