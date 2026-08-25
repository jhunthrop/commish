import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, reviews, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { LEAGUE_CONFIG } from "@/league/config";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { proofStats, type ProofStatsDeps } from "./proof";

const db = createTestDb();

const fixedAt = (iso: string): Clock => ({ now: () => iso });

/** Comfortably inside `LEAGUE_CONFIG.season.startedAt` — every seeded league in this file uses
 *  it unless a test is specifically exercising the season boundary itself. */
const DEFAULT_CREATED_AT = new Date("2026-08-15T00:00:00.000Z");
/** The instant every test treats as "now" unless it overrides the clock — chosen so a 48-hour
 *  window from here lands cleanly inside `DEFAULT_KICKOFF`'s neighborhood below. */
const NOW = "2026-09-10T12:00:00.000Z";
const DEFAULT_KICKOFF = new Date("2026-09-20T00:00:00.000Z");

const deps: ProofStatsDeps = { clock: fixedAt(NOW) };

let leagueSeq = 0;

/**
 * One league and its one draft — the whole shape every proof query reads. No `teams` rows:
 * none of the three proof queries (`leaguesFilledQuery`, `draftsNext48hQuery`,
 * `reviewAggregateQuery`) reads `teams` at all, so seeding them here would only be decoration.
 */
async function seedLeague(opts: {
  readonly draftStatus: "scheduled" | "in_progress" | "complete";
  readonly createdAt?: Date;
  readonly kickoffAt?: Date;
  readonly isPublicMatchmade?: boolean;
}): Promise<string> {
  leagueSeq += 1;
  const id = `plg${leagueSeq}`;
  const commissionerId = `plg_owner_${leagueSeq}`;
  await db.insert(users).values({ id: commissionerId, email: `${commissionerId}@test.local`, displayName: commissionerId }).onConflictDoNothing();
  await db.insert(leagues).values({
    id,
    name: id,
    format: "snake",
    teamCount: 12,
    isPublicMatchmade: opts.isPublicMatchmade ?? true,
    commissionerUserId: commissionerId,
    createdAt: opts.createdAt ?? DEFAULT_CREATED_AT,
  });
  await db.insert(drafts).values({
    id: `${id}_draft`,
    leagueId: id,
    format: "snake",
    status: opts.draftStatus,
    kickoffAt: opts.kickoffAt ?? DEFAULT_KICKOFF,
  });
  return id;
}

/**
 * `drafted` leagues get a draft that actually ran (split between `in_progress` and `complete`,
 * proving neither status alone is what this counts); `full` and `filling` both get a
 * `'scheduled'` draft — team fill has no bearing on `leaguesFilled` at all (the query never
 * reads `teams`), so the only thing distinguishing them from `drafted` is the status column,
 * which is the exact claim this seeder exists to isolate.
 */
async function seedLeagues(counts: { readonly drafted: number; readonly full: number; readonly filling: number }): Promise<void> {
  for (let i = 0; i < counts.drafted; i += 1) {
    await seedLeague({ draftStatus: i % 2 === 0 ? "complete" : "in_progress" });
  }
  for (let i = 0; i < counts.full; i += 1) {
    await seedLeague({ draftStatus: "scheduled" });
  }
  for (let i = 0; i < counts.filling; i += 1) {
    await seedLeague({ draftStatus: "scheduled" });
  }
}

let reviewSeq = 0;

/** Ratings, one per review, so a caller can hit an exact average (`seedReviews`'s own docblock)
 *  rather than a rounded one. Defaults to five stars across the board. */
async function seedReviews(count: number, opts?: { readonly ratings?: readonly number[]; readonly removed?: boolean }): Promise<void> {
  const ratings = opts?.ratings ?? Array.from({ length: count }, () => 5);
  for (let i = 0; i < count; i += 1) {
    reviewSeq += 1;
    const userId = `rev_u${reviewSeq}`;
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
    await db.insert(reviews).values({
      id: `rev_${reviewSeq}`,
      userId,
      rating: ratings[i] ?? 5,
      body: "A generic review body that clears the twenty character minimum with room to spare.",
      removedAt: opts?.removed === true ? new Date("2026-08-01T00:00:00.000Z") : null,
      removedByUserId: opts?.removed === true ? userId : null,
      removalReason: opts?.removed === true ? "other" : null,
    });
  }
}

beforeEach(async () => {
  await truncateAll(db);
  leagueSeq = 0;
  reviewSeq = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("proofStats — leaguesFilled", () => {
  it("counts a league as filled only once its draft actually ran", async () => {
    // "Leagues filled this season" is a claim about rooms that got to draft, not about rows. A
    // league sitting at capacity with a scheduled draft has not yet done the thing being
    // counted, and counting it would inflate the number by exactly the leagues most likely to
    // still fall over. 30 clears the floor (25) so the assertion also proves the floor did not
    // silently swallow a real number.
    await seedLeagues({ drafted: 30, full: 5, filling: 10 });
    expect((await proofStats(db, deps)).leaguesFilled).toBe(30);
  });

  it("excludes a league created before this season started, even once its draft has run", async () => {
    await seedLeagues({ drafted: 30, full: 0, filling: 0 });
    await seedLeague({
      draftStatus: "complete",
      createdAt: new Date(new Date(LEAGUE_CONFIG.season.startedAt).getTime() - 24 * 60 * 60 * 1000),
    });
    // Still 30, not 31 — the prior-season league drafted too, and does not count anyway.
    expect((await proofStats(db, deps)).leaguesFilled).toBe(30);
  });

  it("hides leaguesFilled below its own floor, rather than printing a small number big", async () => {
    await seedLeagues({ drafted: MATCHMAKING_CONFIG.proof.floors.leaguesFilled - 1, full: 0, filling: 0 });
    expect((await proofStats(db, deps)).leaguesFilled).toBeNull();
  });
});

describe("proofStats — draftsNext48h", () => {
  it("counts only the drafts a visitor could actually still join, in the next 48 hours", async () => {
    const now = new Date(NOW);
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in47h = new Date(now.getTime() + 47 * 60 * 60 * 1000);
    // Four public, scheduled drafts inside the window — clears the floor (3).
    await seedLeague({ draftStatus: "scheduled", kickoffAt: now, isPublicMatchmade: true });
    await seedLeague({ draftStatus: "scheduled", kickoffAt: in24h, isPublicMatchmade: true });
    await seedLeague({ draftStatus: "scheduled", kickoffAt: in47h, isPublicMatchmade: true });
    await seedLeague({ draftStatus: "scheduled", kickoffAt: new Date(now.getTime() + 48 * 60 * 60 * 1000), isPublicMatchmade: true });
    // A private league's draft, inside the window — excluded by ENFORCED_LEAGUE_SQL so a
    // private calendar is never disclosed in aggregate.
    await seedLeague({ draftStatus: "scheduled", kickoffAt: in24h, isPublicMatchmade: false });
    // Three days out — a real draft, but not one a visitor could join in the next 48 hours.
    await seedLeague({ draftStatus: "scheduled", kickoffAt: new Date(now.getTime() + 72 * 60 * 60 * 1000), isPublicMatchmade: true });
    // Already started — a visitor cannot join a draft that is no longer `'scheduled'`.
    await seedLeague({ draftStatus: "in_progress", kickoffAt: in24h, isPublicMatchmade: true });

    const stats = await proofStats(db, deps);
    expect(stats.draftsNext48h).toBe(4);
  });

  it("hides draftsNext48h below its own floor", async () => {
    const now = new Date(NOW);
    await seedLeague({ draftStatus: "scheduled", kickoffAt: now, isPublicMatchmade: true });
    await seedLeague({ draftStatus: "scheduled", kickoffAt: now, isPublicMatchmade: true });
    expect(MATCHMAKING_CONFIG.proof.floors.draftsNext48h).toBe(3);
    expect((await proofStats(db, deps)).draftsNext48h).toBeNull();
  });
});

describe("proofStats — rating", () => {
  it("hides a stat that has not earned belief yet, rather than printing a small number big", async () => {
    await seedReviews(MATCHMAKING_CONFIG.proof.floors.reviewCount - 1);
    expect((await proofStats(db, deps)).rating).toBeNull();
  });

  it("reports the review count beside the average, because an average with no n is a slogan", async () => {
    // 51 five-star, 12 four-star: sum 303 / 63 = 4.8095... which rounds to 4.8, the same
    // one-decimal precision a stranger would actually read on the front door.
    const ratings = [...Array<number>(51).fill(5), ...Array<number>(12).fill(4)];
    await seedReviews(63, { ratings });
    expect((await proofStats(db, deps)).rating).toEqual({ average: 4.8, count: 63 });
  });

  it("never lets a removed review nudge the average or the count", async () => {
    const ratings = [...Array<number>(51).fill(5), ...Array<number>(12).fill(4)];
    await seedReviews(63, { ratings });
    // A pile of one-star removed reviews that would drag the average down hard if counted.
    await seedReviews(10, { ratings: Array<number>(10).fill(1), removed: true });
    expect((await proofStats(db, deps)).rating).toEqual({ average: 4.8, count: 63 });
  });
});

describe("proofStats — nextDraftAt", () => {
  it("reports the earliest public scheduled kickoff inside the window, as the instant itself", async () => {
    const now = new Date(NOW);
    const in5h = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const in10h = new Date(now.getTime() + 10 * 60 * 60 * 1000);
    await seedLeague({ draftStatus: "scheduled", kickoffAt: in10h, isPublicMatchmade: true });
    await seedLeague({ draftStatus: "scheduled", kickoffAt: in5h, isPublicMatchmade: true });
    // A private league's earlier draft never wins: ENFORCED_LEAGUE_SQL keeps a private
    // calendar out of the aggregate, the identical reasoning draftsNext48hQuery documents.
    await seedLeague({ draftStatus: "scheduled", kickoffAt: new Date(now.getTime() + 60 * 60 * 1000), isPublicMatchmade: false });
    // A draft already running is not a "next draft" anybody can still sit down for.
    await seedLeague({ draftStatus: "in_progress", kickoffAt: new Date(now.getTime() + 30 * 60 * 1000), isPublicMatchmade: true });
    expect((await proofStats(db, deps)).nextDraftAt).toBe(in5h.toISOString());
  });

  it("omits a next draft beyond MATCHMAKING_CONFIG.proof.nextDraftWithinMs, and keeps the boundary itself", async () => {
    const now = new Date(NOW);
    const beyond = new Date(now.getTime() + MATCHMAKING_CONFIG.proof.nextDraftWithinMs + 60 * 60 * 1000);
    await seedLeague({ draftStatus: "scheduled", kickoffAt: beyond, isPublicMatchmade: true });
    expect((await proofStats(db, deps)).nextDraftAt).toBeNull();

    const atBoundary = new Date(now.getTime() + MATCHMAKING_CONFIG.proof.nextDraftWithinMs);
    await seedLeague({ draftStatus: "scheduled", kickoffAt: atBoundary, isPublicMatchmade: true });
    expect((await proofStats(db, deps)).nextDraftAt).toBe(atBoundary.toISOString());
  });

  it("never lets nextDraftAt alone show the strip: `any` is untouched and ignores it", async () => {
    const now = new Date(NOW);
    await seedLeague({ draftStatus: "scheduled", kickoffAt: new Date(now.getTime() + 2 * 60 * 60 * 1000), isPublicMatchmade: true });
    const stats = await proofStats(db, deps);
    expect(stats.nextDraftAt).not.toBeNull();
    // One scheduled draft is below every floor — the chip rides a strip other numbers earned,
    // it never carries the strip itself.
    expect(stats.any).toBe(false);
  });
});

describe("proofStats — the whole strip", () => {
  it("hides the whole strip when every stat is below its floor, and says nothing at all", async () => {
    await truncateAll(db);
    expect(await proofStats(db, deps)).toEqual({ leaguesFilled: null, draftsNext48h: null, rating: null, nextDraftAt: null, any: false });
  });

  it("shows the strip once even one stat clears its floor", async () => {
    await seedLeagues({ drafted: MATCHMAKING_CONFIG.proof.floors.leaguesFilled, full: 0, filling: 0 });
    const stats = await proofStats(db, deps);
    expect(stats.any).toBe(true);
    expect(stats.leaguesFilled).not.toBeNull();
    expect(stats.draftsNext48h).toBeNull();
    expect(stats.rating).toBeNull();
  });

  it("defaults to the real wall clock when no clock is injected", async () => {
    // Not asserting a value — only that the edge default exists and the call does not throw,
    // the same smoke-test shape `listPublicLeagues`'s own `clock = systemClock` default gets.
    await expect(proofStats(db, {})).resolves.toBeDefined();
  });
});
