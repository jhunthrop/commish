import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import type { DraftFormat } from "@/domain/league";
import type { DraftStatus } from "@/domain/draft";
import { drafts, leagues, lineupSlots, matchups, statWeeks, teams, users, weeks } from "@/db/schema";
import { countingDb, createTestDb, truncateAll } from "@/db/test-db";
import { STATS_INGESTION_CONFIG } from "@/stats-pipeline/config";
import type { ScoreCache, ScoreCacheBatchRequest } from "@/stats-pipeline/score-cache";
import type { TeamScore } from "@/stats-pipeline/contract";
import { crossLeagueHome, liveStateFor } from "./home";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

interface TeamSpec {
  readonly teamId: string;
  readonly userId: string;
  readonly name?: string;
}

interface SeedLeagueInput {
  readonly leagueId: string;
  readonly commissionerUserId: string;
  readonly teamCount: number;
  readonly teams: readonly TeamSpec[];
  readonly format?: DraftFormat;
  readonly draftStatus?: DraftStatus;
}

/** One league: its own draft row, and only the teams named — `teamCount` may exceed
 *  `teams.length` to model open seats for the commissioner-unfilled case. */
async function seedLeague(input: SeedLeagueInput): Promise<void> {
  const userIds = new Set([input.commissionerUserId, ...input.teams.map((t) => t.userId)]);
  await db
    .insert(users)
    .values([...userIds].map((id) => ({ id, email: `${id}@test.local`, displayName: id })))
    .onConflictDoNothing();
  await db.insert(leagues).values({
    id: input.leagueId,
    name: input.leagueId,
    format: input.format ?? "snake",
    teamCount: input.teamCount,
    commissionerUserId: input.commissionerUserId,
  });
  if (input.teams.length > 0) {
    await db.insert(teams).values(input.teams.map((t) => ({ id: t.teamId, leagueId: input.leagueId, userId: t.userId, name: t.name ?? t.teamId })));
  }
  await db.insert(drafts).values({
    id: `${input.leagueId}_draft`,
    leagueId: input.leagueId,
    format: input.format ?? "snake",
    status: input.draftStatus ?? "complete",
    kickoffAt: new Date("2026-09-01T00:00:00.000Z"),
  });
}

/** Writes one league-week's stored median directly — the same column `finalizeWeekInTx` writes,
 *  bypassed here since this file seeds matchups by hand rather than through a full settlement. */
async function seedMedian(leagueId: string, weekNumber: number, medianScore: number): Promise<void> {
  await db.insert(weeks).values({ leagueId, weekNumber, medianScore });
}

async function seedMatchup(
  leagueId: string,
  weekNumber: number,
  homeTeamId: string,
  awayTeamId: string,
  homeScore: number | null = null,
  awayScore: number | null = null,
): Promise<void> {
  await db.insert(matchups).values({ leagueId, weekNumber, homeTeamId, awayTeamId, homeScore, awayScore });
}

/** Writes (or overwrites) one week's `stat_weeks` row — global to the NFL calendar, not
 *  per-league, exactly like `weekStatusFor` reads it. */
async function setWeekStatus(
  week: number,
  status: "scheduled" | "in_progress" | "final",
  version = 0,
  gamesTotal = 0,
  gamesFinal = 0,
): Promise<void> {
  await db
    .insert(statWeeks)
    .values({ week, status, version, gamesTotal, gamesFinal })
    .onConflictDoUpdate({ target: statWeeks.week, set: { status, version, gamesTotal, gamesFinal } });
}

/** A fixed-answer stand-in for the injected score cache: returns exactly `entries`, keyed by
 *  the same `STATS_INGESTION_CONFIG.keys.score` key production reads. */
function fixedScoreCache(entries: ReadonlyMap<string, readonly TeamScore[]>): Pick<ScoreCache, "readMany"> {
  return {
    readMany: async (requests: readonly ScoreCacheBatchRequest[]) => {
      const result = new Map<string, readonly TeamScore[]>();
      for (const request of requests) {
        const key = STATS_INGESTION_CONFIG.keys.score(request.leagueId, request.week);
        const hit = entries.get(key);
        if (hit !== undefined) result.set(key, hit);
      }
      return result;
    },
  };
}

const missingScoreCache: Pick<ScoreCache, "readMany"> = { readMany: async () => new Map() };

describe("crossLeagueHome", () => {
  it("a user in three leagues of mixed format sees exactly those three", async () => {
    await seedLeague({
      leagueId: "lg_snake",
      commissionerUserId: "u1",
      teamCount: 2,
      teams: [{ teamId: "sn_t1", userId: "u1" }, { teamId: "sn_t2", userId: "u2" }],
      format: "snake",
    });
    await seedLeague({
      leagueId: "lg_auction",
      commissionerUserId: "u3",
      teamCount: 2,
      teams: [{ teamId: "au_t1", userId: "u1" }, { teamId: "au_t2", userId: "u3" }],
      format: "auction",
    });
    await seedLeague({
      leagueId: "lg_third",
      commissionerUserId: "u1",
      teamCount: 4,
      teams: [{ teamId: "th_t1", userId: "u1" }, { teamId: "th_t2", userId: "u4" }],
      format: "snake",
      draftStatus: "scheduled",
    });

    const result = await crossLeagueHome(db, "u1");
    expect(result.leagues.map((league) => league.id).sort()).toEqual(["lg_auction", "lg_snake", "lg_third"]);
  });

  it("does not leak a second user's leagues into the first user's payload", async () => {
    // Deliberately overlapping-LOOKING, not disjoint: same league name, same current week (2),
    // both leagues have a completed week 1 and a live week 2 — so a join or filter bug that
    // pulled the wrong owner's rows would produce visibly WRONG data (the intruder's team names,
    // or a record padded by the intruder's own week-1 result), not merely an extra league id. A
    // test that only compares id lists would still pass if `myLeaguesOverview` forgot to scope
    // `teams`/`drafts`/`matchups` to `ids` at all, since both leagues share a name and a week.
    await seedLeague({
      leagueId: "lgA",
      commissionerUserId: "u1",
      teamCount: 2,
      teams: [{ teamId: "a1", userId: "u1", name: "Bay Bandits" }, { teamId: "a2", userId: "rival1", name: "Iron Owls" }],
    });
    await seedMatchup("lgA", 1, "a1", "a2", 30, 20); // u1's team wins week 1
    await seedMatchup("lgA", 2, "a1", "a2", null, null); // current week, live

    await seedLeague({
      leagueId: "lgB",
      commissionerUserId: "intruder",
      teamCount: 2,
      teams: [{ teamId: "b1", userId: "intruder", name: "Shadow Squad" }, { teamId: "b2", userId: "intruderMate", name: "Ghost Riders" }],
      // Same name as `lgA` on purpose — a card keyed on name rather than id would collide.
    });
    // Give lgB an id-shadowing look too: same display name as lgA.
    await db.update(leagues).set({ name: "Money League" }).where(inArray(leagues.id, ["lgA", "lgB"]));
    await seedMatchup("lgB", 1, "b1", "b2", 40, 35); // the intruder's own team wins week 1
    await seedMatchup("lgB", 2, "b1", "b2", null, null); // same current week as lgA

    // One shared, global `stat_weeks` row for week 2 — exactly how production works, and exactly
    // the kind of shared state a leak could ride in on.
    await setWeekStatus(2, "in_progress", 5, 4, 1);

    const result = await crossLeagueHome(db, "u1");
    expect(result.leagues.map((league) => league.id)).toEqual(["lgA"]);
    expect(result.leagues.some((league) => league.id === "lgB")).toBe(false);

    const card = result.leagues[0]!;
    expect(card.matchup).toMatchObject({ homeTeamName: "Bay Bandits", awayTeamName: "Iron Owls" });
    // u1's own record only — not padded by the intruder's week-1 win in the other league.
    expect(card.record).toEqual({ wins: 1, losses: 0, ties: 0 });
    expect(card.filledTeams).toBe(2);

    // Nowhere in the payload — not on this card, not on a stray extra card — does the other
    // user's team content appear.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Shadow Squad");
    expect(serialized).not.toContain("Ghost Riders");
    expect(serialized).not.toContain("intruder");
  });

  it("a user in zero leagues gets an empty list, not an error", async () => {
    await db.insert(users).values({ id: "lonely", email: "lonely@test.local", displayName: "Lonely" });
    await expect(crossLeagueHome(db, "lonely")).resolves.toEqual({ leagues: [], liveState: null });
  });

  it("the record and this week's matchup are correct against a partially-played season", async () => {
    await seedLeague({
      leagueId: "lgProgress",
      commissionerUserId: "u1",
      teamCount: 2,
      teams: [{ teamId: "p_t1", userId: "u1", name: "Bay Bandits" }, { teamId: "p_t2", userId: "u2", name: "Iron Owls" }],
    });
    // Week 1: my team (home) wins. Week 2: my team (away) loses. Week 3: not yet played.
    await seedMatchup("lgProgress", 1, "p_t1", "p_t2", 30, 20);
    await seedMatchup("lgProgress", 2, "p_t2", "p_t1", 25, 15);
    await seedMatchup("lgProgress", 3, "p_t1", "p_t2", null, null);

    const result = await crossLeagueHome(db, "u1");
    const card = result.leagues.find((league) => league.id === "lgProgress");
    expect(card?.record).toEqual({ wins: 1, losses: 1, ties: 0 });
    expect(card?.weekNumber).toBe(3);
    expect(card?.weekStatus).toBe("scheduled"); // no `stat_weeks` row for week 3 yet
    expect(card?.matchup).toEqual({
      weekNumber: 3,
      homeTeamId: "p_t1",
      awayTeamId: "p_t2",
      homeTeamName: "Bay Bandits",
      awayTeamName: "Iron Owls",
      homeScore: null,
      awayScore: null,
      final: false,
      weekStatus: "scheduled",
    });
  });

  it("a live week's score comes from the cache", async () => {
    await seedLeague({
      leagueId: "lgLive",
      commissionerUserId: "u1",
      teamCount: 2,
      teams: [{ teamId: "l_t1", userId: "u1" }, { teamId: "l_t2", userId: "u2" }],
    });
    await seedMatchup("lgLive", 1, "l_t1", "l_t2", null, null);
    await setWeekStatus(1, "in_progress", 7, 4, 1);

    const scoreCache = fixedScoreCache(
      new Map([[STATS_INGESTION_CONFIG.keys.score("lgLive", 1), [{ teamId: "l_t1", points: 55.5 }, { teamId: "l_t2", points: 40.25 }]]]),
    );

    const result = await crossLeagueHome(db, "u1", { scoreCache });
    const card = result.leagues.find((league) => league.id === "lgLive");
    expect(card?.weekStatus).toBe("in_progress");
    expect(card?.matchup?.homeScore).toBe(55.5);
    expect(card?.matchup?.awayScore).toBe(40.25);
  });

  it("a cache miss still returns the right number, from Postgres", async () => {
    await seedLeague({
      leagueId: "lgMiss",
      commissionerUserId: "u1",
      teamCount: 2,
      teams: [{ teamId: "m_t1", userId: "u1" }, { teamId: "m_t2", userId: "u2" }],
    });
    // Live week, but Postgres already carries real numbers for it — the cache has nothing.
    await seedMatchup("lgMiss", 1, "m_t1", "m_t2", 12.5, 9.75);
    await setWeekStatus(1, "in_progress", 3, 4, 1);

    const result = await crossLeagueHome(db, "u1", { scoreCache: missingScoreCache });
    const card = result.leagues.find((league) => league.id === "lgMiss");
    expect(card?.weekStatus).toBe("in_progress");
    expect(card?.matchup?.homeScore).toBe(12.5);
    expect(card?.matchup?.awayScore).toBe(9.75);
  });

  it("costs a bounded number of queries whether the caller is in two leagues or ten", async () => {
    for (let i = 1; i <= 10; i++) {
      await seedLeague({
        leagueId: `lgMany${i}`,
        commissionerUserId: `owner${i}`,
        teamCount: 2,
        teams: [{ teamId: `many${i}_t1`, userId: "uMany" }, { teamId: `many${i}_t2`, userId: `owner${i}` }],
      });
      await seedMatchup(`lgMany${i}`, 1, `many${i}_t1`, `many${i}_t2`, null, null);
    }

    const counting = countingDb(db);
    const result = await crossLeagueHome(counting.db, "uMany");
    expect(result.leagues).toHaveLength(10);
    // `myLeaguesOverview`'s four queries (membership, leagues, teams, drafts) plus this
    // function's own matchups, weeks (medians), stat_weeks and (Task 10, Step 1b) lineup_slots
    // reads: eight total, bounded regardless of league count, never one query per league.
    expect(counting.selectCount()).toBeLessThanOrEqual(8);
  });

  it("reads every league's medians in one query, however many leagues a manager is in", async () => {
    for (let i = 1; i <= 5; i++) {
      await seedLeague({
        leagueId: `lgMed${i}`,
        commissionerUserId: `mowner${i}`,
        teamCount: 2,
        teams: [{ teamId: `med${i}_t1`, userId: "uMed" }, { teamId: `med${i}_t2`, userId: `mowner${i}` }],
      });
      await seedMatchup(`lgMed${i}`, 1, `med${i}_t1`, `med${i}_t2`, 10, 20);
    }

    const counting = countingDb(db);
    await crossLeagueHome(counting.db, "uMed");
    expect(counting.queriesMatching(/from "weeks"/)).toBe(1);
  });

  it("folds MULTIPLE weeks' medians into one league's own record, not just its first week", async () => {
    await seedLeague({
      leagueId: "lgMedMulti",
      commissionerUserId: "u_multi_owner",
      teamCount: 2,
      teams: [{ teamId: "multi_t1", userId: "uMulti" }, { teamId: "multi_t2", userId: "u_multi_owner" }],
    });
    // Week 1: t1 wins head-to-head AND beats the median. Week 2: t2 wins head-to-head AND beats
    // the median. Two teams, so each week's median is the average of that week's own two scores.
    await seedMatchup("lgMedMulti", 1, "multi_t1", "multi_t2", 24, 4);
    await seedMedian("lgMedMulti", 1, 14);
    await seedMatchup("lgMedMulti", 2, "multi_t1", "multi_t2", 10, 20);
    await seedMedian("lgMedMulti", 2, 15);

    const result = await crossLeagueHome(db, "uMulti");
    const card = result.leagues.find((league) => league.id === "lgMedMulti");
    // Head-to-head: 1 win (week 1), 1 loss (week 2). Median: 1 win (week 1), 1 loss (week 2).
    expect(card?.record).toEqual({ wins: 2, losses: 2, ties: 0 });
  });

  it("a commissioner with an unfilled league sees invite-managers as the next action", async () => {
    await seedLeague({
      leagueId: "lgUnfilled",
      commissionerUserId: "u1",
      teamCount: 6,
      teams: [{ teamId: "uf_t1", userId: "u1" }],
      draftStatus: "scheduled",
    });

    const result = await crossLeagueHome(db, "u1");
    const card = result.leagues.find((league) => league.id === "lgUnfilled");
    expect(card?.nextAction).toEqual({ kind: "invite-managers", label: "Invite managers" });
  });

  it("finds the current week's matchup when the caller's team is the AWAY side, not just the home side", async () => {
    // Every other matchup fixture in this file seeds the caller as the home team for the week
    // under test — the `.find()`'s `||` never evaluates its right operand without this.
    await seedLeague({
      leagueId: "lgAway",
      commissionerUserId: "u1",
      teamCount: 2,
      teams: [{ teamId: "away_t1", userId: "u1" }, { teamId: "away_t2", userId: "u2" }],
    });
    await seedMatchup("lgAway", 1, "away_t2", "away_t1", null, null);

    const result = await crossLeagueHome(db, "u1");
    const card = result.leagues.find((league) => league.id === "lgAway");
    expect(card?.matchup).toMatchObject({ homeTeamId: "away_t2", awayTeamId: "away_t1" });
  });

  it("falls back on every '??' guard a league's own membership rows can never actually violate through real Postgres", async () => {
    // `myLeaguesOverview`'s `ids` — the set every other query is scoped to — comes directly from
    // the caller's own team rows, so a REAL Postgres read can never hand this function a league
    // with no matching team/draft/myTeamByLeague entry. A stub `Db` whose four independent
    // SELECTs disagree with each other is the only way to put the code in that state, proving
    // every defensive `?? null` / `?? 0` fallback below `myLeaguesOverview`'s call actually does
    // something, rather than merely existing.
    interface Thenable {
      then(resolve: (value: readonly unknown[]) => void): void;
      where(): Thenable;
      orderBy(): Thenable;
    }
    function thenableChain(data: readonly unknown[]): Thenable {
      const chain: Thenable = {
        then: (resolve) => resolve(data),
        where: () => chain,
        orderBy: () => chain,
      };
      return chain;
    }
    const responses: (readonly unknown[])[] = [
      [{ leagueId: "lg_real", teamId: "team_real" }], // myLeaguesOverview: "mine"
      [
        { id: "lg_real", name: "Real League", format: "snake", teamCount: 2, stakeTier: 0, isPublicMatchmade: false, experienceTier: "beginner", commissionerUserId: "u1", houseRung: null, rosterSlots: [], createdAt: new Date() },
        // A league Postgres could never actually return here — its id is absent from `ids`.
        { id: "lg_phantom", name: "Phantom League", format: "snake", teamCount: 2, stakeTier: 0, isPublicMatchmade: false, experienceTier: "beginner", commissionerUserId: "u1", houseRung: null, rosterSlots: [], createdAt: new Date() },
      ], // leagueRows
      [{ id: "team_real", leagueId: "lg_real", name: "Real Team" }], // teamRows — none for lg_phantom
      [], // draftRows — none for either league
      [], // allMatchups
      [], // statWeekRows
    ];
    let call = 0;
    const fromStub = () => {
      const data = responses[call] ?? [];
      call += 1;
      return thenableChain(data);
    };
    const stubDb = {
      select: () => ({ from: fromStub }),
      // Step 1b's `lineup_slots` read (F1) uses `selectDistinct`, not `select` — same stub
      // shape, so it falls back to `responses[call] ?? []` exactly like every other read here.
      selectDistinct: () => ({ from: fromStub }),
    } as unknown as import("@/db/client").Db;

    const result = await crossLeagueHome(stubDb, "u1");
    const phantom = result.leagues.find((league) => league.id === "lg_phantom");
    expect(phantom).toMatchObject({ myTeamId: null, filledTeams: 0, draftId: null, draftStatus: null, record: null });
  });

  // Phase 3.6, Task 10, Step 1b (F1).
  it("lineupSet is false, and nextAction asks for a fix, when this manager has no lineup_slots row for the current week", async () => {
    await seedLeague({
      leagueId: "lgLineup",
      commissionerUserId: "u1",
      teamCount: 2,
      teams: [{ teamId: "ll_t1", userId: "u1" }, { teamId: "ll_t2", userId: "u2" }],
    });
    await seedMatchup("lgLineup", 1, "ll_t1", "ll_t2", null, null);
    await setWeekStatus(1, "scheduled");
    // Neither row is THIS manager's own week-1 lineup: one belongs to the other team, the other
    // is a different week entirely — proving the predicate is scoped to (teamId, weekNumber).
    await db.insert(lineupSlots).values({ teamId: "ll_t2", weekNumber: 1, slot: "QB", slotIndex: 0, playerId: null });
    await db.insert(lineupSlots).values({ teamId: "ll_t1", weekNumber: 2, slot: "QB", slotIndex: 0, playerId: null });

    const result = await crossLeagueHome(db, "u1");
    const card = result.leagues.find((league) => league.id === "lgLineup");
    expect(card?.lineupSet).toBe(false);
    expect(card?.nextAction).toEqual({ kind: "fix-lineup", label: "Fix your lineup" });
  });

  it("lineupSet is true once this manager's own row exists for the current week, and nextAction falls through to set-lineup", async () => {
    await seedLeague({
      leagueId: "lgLineupSet",
      commissionerUserId: "u1",
      teamCount: 2,
      teams: [{ teamId: "ls_t1", userId: "u1" }, { teamId: "ls_t2", userId: "u2" }],
    });
    await seedMatchup("lgLineupSet", 1, "ls_t1", "ls_t2", null, null);
    await setWeekStatus(1, "scheduled");
    await db.insert(lineupSlots).values({ teamId: "ls_t1", weekNumber: 1, slot: "QB", slotIndex: 0, playerId: null });

    const result = await crossLeagueHome(db, "u1");
    const card = result.leagues.find((league) => league.id === "lgLineupSet");
    expect(card?.lineupSet).toBe(true);
    expect(card?.nextAction).toEqual({ kind: "set-lineup", label: "Set your lineup" });
  });

  // A caller with NO team in a league can never actually reach this function for that league at
  // all: `myLeaguesOverview`'s own membership read (`teams.userId = userId`) is the sole entry
  // point into `ids`, so a league with no team for this caller is a league that never appears in
  // `leagueRows` in the first place. `lineupSetFor`'s own `teamId === null` branch is exercised
  // instead by the "falls back on every '??' guard" test above, the one place a `myTeamId: null`
  // card is ever constructed (through a stub `Db`, the only way to reach that state at all).

  // Phase 3.6, Task 10, Step 2: the median row's own fact, read off the same `weeks`/`leagues`
  // rows this function already selects.
  it("carries the league's medianGame flag and this week's own stored median, at zero extra cost", async () => {
    await seedLeague({
      leagueId: "lgMedianFlag",
      commissionerUserId: "u1",
      teamCount: 2,
      teams: [{ teamId: "mf_t1", userId: "u1" }, { teamId: "mf_t2", userId: "u2" }],
    });
    await db.update(leagues).set({ medianGame: true }).where(inArray(leagues.id, ["lgMedianFlag"]));
    await seedMatchup("lgMedianFlag", 1, "mf_t1", "mf_t2", 30, 20);
    await seedMedian("lgMedianFlag", 1, 121.4);
    // Week 2 is the CURRENT week (week 1 is fully scored); it has no stored median yet.
    await seedMatchup("lgMedianFlag", 2, "mf_t1", "mf_t2", null, null);

    const result = await crossLeagueHome(db, "u1");
    const card = result.leagues.find((league) => league.id === "lgMedianFlag");
    expect(card?.medianGame).toBe(true);
    expect(card?.weekNumber).toBe(2);
    expect(card?.medianScore).toBeNull();
  });

  it("a non-median league carries medianGame: false", async () => {
    await seedLeague({
      leagueId: "lgNotMedian",
      commissionerUserId: "u1",
      teamCount: 2,
      teams: [{ teamId: "nm_t1", userId: "u1" }, { teamId: "nm_t2", userId: "u2" }],
    });

    const result = await crossLeagueHome(db, "u1");
    const card = result.leagues.find((league) => league.id === "lgNotMedian");
    expect(card?.medianGame).toBe(false);
  });

  // Phase 3.6, Task 10, Step 3: the top bar's one live fact, read from the same `stat_weeks`
  // rows already fetched for `weekStatus` — the pure gate itself (`liveStateFor`) is unit-tested
  // below; this proves `crossLeagueHome` actually wires a real clock through to it.
  it("wires liveState from stat_weeks through an injected clock", async () => {
    await seedLeague({
      leagueId: "lgLive",
      commissionerUserId: "u1",
      teamCount: 2,
      teams: [{ teamId: "lv_t1", userId: "u1" }, { teamId: "lv_t2", userId: "u2" }],
    });
    await seedMatchup("lgLive", 1, "lv_t1", "lv_t2", null, null);
    await setWeekStatus(1, "in_progress", 1, 16, 9);

    const sunday = { now: () => "2026-08-23T18:00:00.000Z" };
    const result = await crossLeagueHome(db, "u1", { clock: sunday });
    expect(result.liveState).toEqual({ weekday: "Sunday", gamesLive: 7 });

    const tuesday = { now: () => "2026-08-25T18:00:00.000Z" };
    const resultMidWeek = await crossLeagueHome(db, "u1", { clock: tuesday });
    expect(resultMidWeek.liveState).toBeNull();
  });
});

describe("liveStateFor", () => {
  const ROW = { status: "in_progress" as const, gamesTotal: 16, gamesFinal: 9 };

  it("is null off-season: no in-progress week at all", () => {
    expect(liveStateFor([{ ...ROW, status: "scheduled" }], new Date("2026-08-23T18:00:00.000Z"))).toBeNull();
  });

  it("is null mid-week: the week is in progress, but today is not a real NFL game day", () => {
    expect(liveStateFor([ROW], new Date("2026-08-25T18:00:00.000Z"))).toBeNull(); // a Tuesday
  });

  it("is null pre-kickoff: the week has not started at all, even on a real game day", () => {
    expect(liveStateFor([{ ...ROW, status: "scheduled", gamesFinal: 0 }], new Date("2026-08-23T18:00:00.000Z"))).toBeNull();
  });

  it("is null once every game in the week is already final, even on a game day", () => {
    expect(liveStateFor([{ ...ROW, gamesFinal: 16 }], new Date("2026-08-23T18:00:00.000Z"))).toBeNull();
  });

  it("renders the real weekday and the real live count on an actual game day", () => {
    expect(liveStateFor([ROW], new Date("2026-08-23T18:00:00.000Z"))).toEqual({ weekday: "Sunday", gamesLive: 7 });
  });

  it("picks the one in-progress week among several stat_weeks rows", () => {
    expect(
      liveStateFor(
        [{ status: "final", gamesTotal: 16, gamesFinal: 16 }, ROW, { status: "scheduled", gamesTotal: 16, gamesFinal: 0 }],
        new Date("2026-08-23T18:00:00.000Z"),
      ),
    ).toEqual({ weekday: "Sunday", gamesLive: 7 });
  });
});
