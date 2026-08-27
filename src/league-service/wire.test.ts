import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { auditEvents, drafts, leagues, teams, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { WireItem } from "@/matchmaking/contract";
import { listWireItems } from "./wire";

const db = createTestDb();

/** The one instant every test in this file treats as "now" — injected, never read from a wall
 *  clock, per the service modules' own "no ambient clock" rule. */
const NOW = "2026-09-10T12:00:00.000Z";
const clock: Clock = { now: () => NOW };
const nowMs = Date.parse(NOW);

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

let leagueSeq = 0;
let eventSeq = 0;
let userSeq = 0;

/**
 * One league, its one draft, and `filledTeams` seated members — the whole shape every wire read
 * touches. Defaults describe the common case (public, scheduled, half full); each test overrides
 * exactly the axis it is about.
 */
async function seedLeague(opts: {
  readonly name?: string;
  readonly isPublicMatchmade?: boolean;
  readonly teamCount?: number;
  readonly filledTeams?: number;
  readonly draftStatus?: "scheduled" | "in_progress" | "complete";
  readonly kickoffAt?: Date;
  readonly startTrigger?: "scheduled" | "when_full";
  readonly fillFiredAt?: Date;
  /** Phase 4.5, Task 2: a mock league always ships `isPublicMatchmade: false` in production
   *  (`createMockRoom`, a later task) — this option seeds that exact shape directly, rather than
   *  relying on a caller to also pass `isPublicMatchmade: false` by hand, so a test can pin "a
   *  mock is excluded" as its own claim instead of piggybacking on "a private league is
   *  excluded". */
  readonly isMock?: boolean;
}): Promise<string> {
  leagueSeq += 1;
  const id = `wlg${leagueSeq}`;
  const commissionerId = `wlg_owner_${leagueSeq}`;
  await db.insert(users).values({ id: commissionerId, email: `${commissionerId}@test.local`, displayName: commissionerId });
  await db.insert(leagues).values({
    id,
    name: opts.name ?? id,
    format: "snake",
    teamCount: opts.teamCount ?? 12,
    isPublicMatchmade: opts.isMock === true ? false : (opts.isPublicMatchmade ?? true),
    isMock: opts.isMock ?? false,
    commissionerUserId: commissionerId,
  });
  await db.insert(drafts).values({
    id: `${id}_draft`,
    leagueId: id,
    format: "snake",
    status: opts.draftStatus ?? "scheduled",
    kickoffAt: opts.kickoffAt ?? new Date(nowMs + 30 * 24 * MS_PER_HOUR),
    startTrigger: opts.startTrigger ?? "scheduled",
    fillFiredAt: opts.fillFiredAt ?? null,
  });
  for (let i = 0; i < (opts.filledTeams ?? 0); i += 1) {
    userSeq += 1;
    const userId = `wu${userSeq}`;
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId });
    await db.insert(teams).values({ id: `${id}_team_${i}`, leagueId: id, userId, name: `${id} team ${i}` });
  }
  return id;
}

/** A raw `member_joined` audit row — `audit_events` carries no foreign keys by design, so no
 *  actor row is needed. `outcome: "seat_released"` is the release compromise's own spelling
 *  (`releaseSeat`, `@/league-service/release`): the same event type, a different fact. */
async function seedJoinEvent(leagueId: string, occurredAt: Date, opts?: { readonly seatReleased?: boolean }): Promise<void> {
  eventSeq += 1;
  await db.insert(auditEvents).values({
    eventId: `wevt_${eventSeq}`,
    chainScope: leagueId,
    sequence: eventSeq,
    eventType: "member_joined",
    actorId: `wactor_${eventSeq}`,
    actorType: "user",
    leagueId,
    payload: opts?.seatReleased === true ? { teamId: "t", outcome: "seat_released" } : { teamId: "t", via: "public_browse" },
    occurredAt,
    previousEventHash: "prev",
    eventHash: `wevt_hash_${eventSeq}`,
    hashVersion: 1,
  });
}

function ofKind<K extends WireItem["kind"]>(items: readonly WireItem[], kind: K): readonly Extract<WireItem, { kind: K }>[] {
  return items.filter((item): item is Extract<WireItem, { kind: K }> => item.kind === kind);
}

beforeEach(async () => {
  await truncateAll(db);
  leagueSeq = 0;
  eventSeq = 0;
  userSeq = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("listWireItems — seat_claimed", () => {
  it("reports a public claim inside the window, actor-free, with the coarse-ago delta and the league's open-seat count", async () => {
    const leagueId = await seedLeague({ name: "Sunday Money", teamCount: 12, filledTeams: 10 });
    await seedJoinEvent(leagueId, new Date(nowMs - 5 * MS_PER_MINUTE));

    const items = await listWireItems(db, clock);
    const claims = ofKind(items, "seat_claimed");
    expect(claims).toEqual([{ kind: "seat_claimed", leagueName: "Sunday Money", agoMs: 5 * MS_PER_MINUTE, seatsOpen: 2 }]);
    // S9: nothing on any wire item names a person — the shape itself has no actor field, and
    // this pins that no field VALUE smuggles the actor id in either.
    expect(JSON.stringify(items)).not.toContain("wactor_");
  });

  it("never discloses a private league's claim, and never reaches outside the window", async () => {
    const privateLeague = await seedLeague({ name: "Group Chat League", isPublicMatchmade: false });
    await seedJoinEvent(privateLeague, new Date(nowMs - 5 * MS_PER_MINUTE));
    const publicLeague = await seedLeague({ name: "Sunday Money" });
    await seedJoinEvent(publicLeague, new Date(nowMs - MATCHMAKING_CONFIG.wire.windowMs - MS_PER_MINUTE));

    expect(ofKind(await listWireItems(db, clock), "seat_claimed")).toEqual([]);
  });

  it("never reads a seat release as a claim, even though it rides the same event type", async () => {
    const leagueId = await seedLeague({ name: "Sunday Money" });
    await seedJoinEvent(leagueId, new Date(nowMs - 5 * MS_PER_MINUTE), { seatReleased: true });

    expect(ofKind(await listWireItems(db, clock), "seat_claimed")).toEqual([]);
  });

  it("orders claims newest first", async () => {
    const first = await seedLeague({ name: "League One" });
    const second = await seedLeague({ name: "League Two" });
    await seedJoinEvent(first, new Date(nowMs - 3 * MS_PER_HOUR));
    await seedJoinEvent(second, new Date(nowMs - 10 * MS_PER_MINUTE));

    const claims = ofKind(await listWireItems(db, clock), "seat_claimed");
    expect(claims.map((claim) => claim.leagueName)).toEqual(["League Two", "League One"]);
  });
});

describe("listWireItems — league_filled", () => {
  it("reports a full public league as drafting soon while scheduled, and drafting now once in progress", async () => {
    await seedLeague({ name: "Filled Scheduled", teamCount: 2, filledTeams: 2, draftStatus: "scheduled" });
    await seedLeague({ name: "Filled Live", teamCount: 2, filledTeams: 2, draftStatus: "in_progress" });

    const filled = ofKind(await listWireItems(db, clock), "league_filled");
    expect(filled).toContainEqual({ kind: "league_filled", leagueName: "Filled Scheduled", draftStatus: "scheduled" });
    expect(filled).toContainEqual({ kind: "league_filled", leagueName: "Filled Live", draftStatus: "in_progress" });
  });

  it("reports neither an unfilled league, nor a private full one, nor one whose draft already completed", async () => {
    await seedLeague({ name: "Still Filling", teamCount: 4, filledTeams: 3 });
    await seedLeague({ name: "Private Full", teamCount: 2, filledTeams: 2, isPublicMatchmade: false });
    await seedLeague({ name: "Already Done", teamCount: 2, filledTeams: 2, draftStatus: "complete" });

    expect(ofKind(await listWireItems(db, clock), "league_filled")).toEqual([]);
  });

  it("orders filled leagues by fill recency — the league whose last seat landed most recently, first", async () => {
    const older = await seedLeague({ name: "Filled Earlier", teamCount: 2, filledTeams: 2 });
    const newer = await seedLeague({ name: "Filled Just Now", teamCount: 2, filledTeams: 2 });
    await seedJoinEvent(older, new Date(nowMs - 6 * MS_PER_HOUR));
    await seedJoinEvent(newer, new Date(nowMs - 10 * MS_PER_MINUTE));

    const filled = ofKind(await listWireItems(db, clock), "league_filled");
    expect(filled.map((item) => item.leagueName)).toEqual(["Filled Just Now", "Filled Earlier"]);
  });
});

describe("listWireItems — season_count", () => {
  it("reports the floored season count once it clears the proof floor, exactly once", async () => {
    for (let i = 0; i < MATCHMAKING_CONFIG.proof.floors.leaguesFilled; i += 1) {
      await seedLeague({ draftStatus: i % 2 === 0 ? "complete" : "in_progress" });
    }
    const counts = ofKind(await listWireItems(db, clock), "season_count");
    expect(counts).toEqual([{ kind: "season_count", count: MATCHMAKING_CONFIG.proof.floors.leaguesFilled }]);
  });

  it("omits the season count below the same floor the proof strip reads, never a small number dressed up", async () => {
    for (let i = 0; i < MATCHMAKING_CONFIG.proof.floors.leaguesFilled - 1; i += 1) {
      await seedLeague({ draftStatus: "complete" });
    }
    // The other three sources still have material, so the omission is the floor's doing alone.
    const withClaims = await seedLeague({ name: "Sunday Money", draftStatus: "scheduled" });
    await seedJoinEvent(withClaims, new Date(nowMs - MS_PER_MINUTE));

    expect(ofKind(await listWireItems(db, clock), "season_count")).toEqual([]);
  });
});

/**
 * Phase 4.5, Task 2 — the architecture call's own claim, PINNED rather than trusted:
 * `ENFORCED_LEAGUE_SQL` (`is_public_matchmade = true`) already keeps a mock off two of the
 * wire's three reads BY CONSTRUCTION (storefront review R1 retired the wire's fourth read,
 * `draft_tonight` — see that describe block's own removal note), because a mock always ships
 * `isPublicMatchmade: false` — every test above already proves that predicate for a PRIVATE
 * league, and a mock is just one more private league to those two queries. This block seeds the
 * identical shape with `isMock: true` explicitly, so a future engineer cannot read the
 * private-league tests above as "not really about mocks" — a mock genuinely produces no wire item
 * through either `ENFORCED_LEAGUE_SQL` read, and the third (`leaguesFilledQuery`'s own
 * `season_count`, the one query that is NOT joined on `ENFORCED_LEAGUE_SQL`) is excluded by its
 * own `NOT is_mock` predicate instead (`@/league-service/proof`).
 */
describe("listWireItems — a mock league is invisible to every one of the three reads (Phase 4.5, Task 2)", () => {
  it("never reports a mock's seat claim", async () => {
    const mockLeague = await seedLeague({ name: "Practice Room", isMock: true, teamCount: 12, filledTeams: 10 });
    await seedJoinEvent(mockLeague, new Date(nowMs - 5 * MS_PER_MINUTE));
    expect(ofKind(await listWireItems(db, clock), "seat_claimed")).toEqual([]);
  });

  it("never reports a mock as a filled league, live or scheduled", async () => {
    await seedLeague({ name: "Practice Full Scheduled", isMock: true, teamCount: 2, filledTeams: 2, draftStatus: "scheduled" });
    await seedLeague({ name: "Practice Full Live", isMock: true, teamCount: 2, filledTeams: 2, draftStatus: "in_progress" });
    expect(ofKind(await listWireItems(db, clock), "league_filled")).toEqual([]);
  });

  it("never lets a drafted mock inflate the season count, even sitting right at the floor", async () => {
    for (let i = 0; i < MATCHMAKING_CONFIG.proof.floors.leaguesFilled; i += 1) {
      await seedLeague({ draftStatus: i % 2 === 0 ? "complete" : "in_progress" });
    }
    await seedLeague({ name: "Practice Drafted", isMock: true, draftStatus: "complete" });
    expect(ofKind(await listWireItems(db, clock), "season_count")).toEqual([{ kind: "season_count", count: MATCHMAKING_CONFIG.proof.floors.leaguesFilled }]);
  });
});

/**
 * D1 (storefront review; flow analysis J04) — `notAFixtureLeague()` proven against the wire's
 * own two league-named reads. `seatClaimsQuery`/`filledLeaguesQuery` are `@/league-service/
 * browse.ts`'s shared predicate applied a second place, not a second rule.
 */
describe("listWireItems excludes dev/e2e fixture leagues (D1)", () => {
  it("never reports a fixture-named league's seat claim, while a normal one still appears", async () => {
    const fixture = await seedLeague({ name: "E2E Money Dark 1787678163994" });
    await seedJoinEvent(fixture, new Date(nowMs - MS_PER_MINUTE));
    const real = await seedLeague({ name: "The Longshot League 5" });
    await seedJoinEvent(real, new Date(nowMs - 2 * MS_PER_MINUTE));

    const claims = ofKind(await listWireItems(db, clock), "seat_claimed");
    expect(claims.map((claim) => claim.leagueName)).toEqual(["The Longshot League 5"]);
  });

  it("never reports a fixture-named league as filled, while a normal one still appears", async () => {
    await seedLeague({ name: "Mobile360 Hold League", teamCount: 2, filledTeams: 2 });
    await seedLeague({ name: "Sunday Money", teamCount: 2, filledTeams: 2 });

    const filled = ofKind(await listWireItems(db, clock), "league_filled");
    expect(filled.map((item) => item.leagueName)).toEqual(["Sunday Money"]);
  });
});

/**
 * D2 (storefront review; flow analysis journey J23) — a burst of joins to the SAME league inside
 * the window used to print the identical sentence roughly ten times in a single marquee pass.
 */
describe("listWireItems de-duplicates a burst for the same league (D2)", () => {
  it("collapses many seat claims for the same league down to the newest one", async () => {
    const leagueId = await seedLeague({ name: "The Longshot League 5", teamCount: 12, filledTeams: 10 });
    await seedJoinEvent(leagueId, new Date(nowMs - 11 * MS_PER_MINUTE));
    await seedJoinEvent(leagueId, new Date(nowMs - 11 * MS_PER_MINUTE));
    await seedJoinEvent(leagueId, new Date(nowMs - 2 * MS_PER_MINUTE));

    const claims = ofKind(await listWireItems(db, clock), "seat_claimed");
    expect(claims).toEqual([{ kind: "seat_claimed", leagueName: "The Longshot League 5", agoMs: 2 * MS_PER_MINUTE, seatsOpen: 2 }]);
  });

  it("never collapses claims from two different leagues into one", async () => {
    const a = await seedLeague({ name: "League A" });
    const b = await seedLeague({ name: "League B" });
    await seedJoinEvent(a, new Date(nowMs - MS_PER_MINUTE));
    await seedJoinEvent(b, new Date(nowMs - 2 * MS_PER_MINUTE));

    const claims = ofKind(await listWireItems(db, clock), "seat_claimed");
    expect(claims.map((claim) => claim.leagueName).sort()).toEqual(["League A", "League B"]);
  });

  it("keeps a seat_claimed and a league_filled item for the same league — dedup never crosses kinds", async () => {
    const leagueId = await seedLeague({ name: "Filled After A Claim", teamCount: 2, filledTeams: 2 });
    await seedJoinEvent(leagueId, new Date(nowMs - MS_PER_MINUTE));

    const items = await listWireItems(db, clock);
    expect(ofKind(items, "seat_claimed").map((i) => i.leagueName)).toEqual(["Filled After A Claim"]);
    expect(ofKind(items, "league_filled").map((i) => i.leagueName)).toEqual(["Filled After A Claim"]);
  });
});

describe("listWireItems — the merged wire", () => {
  it("returns [] on a quiet product, never padding", async () => {
    expect(await listWireItems(db, clock)).toEqual([]);
  });

  it("interleaves the kinds rather than clustering them, so the ticker reads as varied activity", async () => {
    const claimed = await seedLeague({ name: "Claimed League" });
    await seedJoinEvent(claimed, new Date(nowMs - MS_PER_MINUTE));
    const secondClaimed = await seedLeague({ name: "Second Claimed League" });
    await seedJoinEvent(secondClaimed, new Date(nowMs - 2 * MS_PER_MINUTE));
    await seedLeague({ name: "Filled League", teamCount: 2, filledTeams: 2 });

    const items = await listWireItems(db, clock);
    expect(items.map((item) => item.kind)).toEqual(["seat_claimed", "league_filled", "seat_claimed"]);
  });

  it("caps the merged wire at MATCHMAKING_CONFIG.wire.maxItems", async () => {
    for (let i = 0; i < MATCHMAKING_CONFIG.wire.maxItems; i += 1) {
      const leagueId = await seedLeague({ teamCount: 2, filledTeams: 2 });
      await seedJoinEvent(leagueId, new Date(nowMs - (i + 1) * MS_PER_MINUTE));
    }
    const items = await listWireItems(db, clock);
    expect(items).toHaveLength(MATCHMAKING_CONFIG.wire.maxItems);
  });

  it("defaults to the real wall clock when no clock is injected", async () => {
    // Not asserting a value — only that the edge default exists and the call does not throw,
    // the same smoke-test shape `proofStats`'s own default-clock test uses.
    await expect(listWireItems(db)).resolves.toBeDefined();
  });
});
