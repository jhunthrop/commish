import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, getTableName, is, isNull, Table } from "drizzle-orm";
import { countingDb, createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import type { Db } from "@research/db/client";
import * as researchSchema from "@research/db/schema";
import * as appSchema from "@/db/schema";
import { auditEvents, integrityFlags, leagues, memberNotices, reviewReports, reviews, teams, users } from "@/db/schema";
import type { Clock } from "@research/domain/timing";
import { createAuditLogger } from "@/integrity-service/audit-logger";
import { notifyAffectedMember, quoteFor, type MemberNotice } from "@/integrity-service/notify";
import { renderNotice } from "@/integrity/notices";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { REMOVAL_REASON_VALUES, REVIEW_CONFIG, removalPhraseFor, removalSentenceFor } from "@/reviews/config";
import type { ReviewView } from "@/reviews/contract";
import { parseReviewCursor } from "@/reviews/cursor";
import { feedQuery, listReviews, myReview, removeReview, reportReview, REVIEW_VIEW_FIELDS, submitReview } from "./reviews";

const db = createTestDb();

const at = (iso: string): Clock => ({ now: () => iso });

let counter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(counter += 1)}` });

const LONG_ENOUGH = "This league runs itself. Draft night was smooth and scoring settled fast.";
const BRUTAL = "The commissioner vanished mid-season and nobody ever settled the standings.";
const REVISED = "Updating my review: they came back and made it right. Genuinely impressed now.";
const SPAM = "Click here for free V-bucks, best fantasy site ever, link in bio!!!";

/** Every table either half of the schema declares, so "which of them does this SQL name" is a closed question. */
const ALL_TABLE_NAMES: readonly string[] = Object.values({ ...researchSchema, ...appSchema })
  .filter((value) => is(value, Table))
  .map((table) => getTableName(table as Table));

/**
 * The tables a rendered statement actually references. Drizzle quotes every identifier, so
 * `"reviews"` matches the table and never `review_reports`, and a qualifier (`"users"."id"`)
 * counts the same as a `FROM` — which is what we want: any appearance at all is a reference.
 */
function tablesIn(sql: string): readonly string[] {
  return ALL_TABLE_NAMES.filter((name) => sql.includes(`"${name}"`)).sort();
}

async function seedUser(id: string): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@test.local`, displayName: id });
}

/** The same `giveCompletedSeasons` idiom `join.test.ts`/`browse.test.ts`/`creation.test.ts` each
 *  already establish: one completed league per season, this account the sole team in it. */
async function giveCompletedSeasons(userId: string, count: number): Promise<void> {
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
  for (let i = 0; i < count; i += 1) {
    const leagueId = `${userId}_history_${i}`;
    await db.insert(leagues).values({
      id: leagueId,
      name: leagueId,
      format: "snake",
      teamCount: 1,
      commissionerUserId: userId,
      seasonCompletedAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    await db.insert(teams).values({ id: `${leagueId}_team`, leagueId, userId, name: "Team" });
  }
}

beforeEach(async () => {
  await truncateAll(db);
  counter = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("listReviews / feedQuery — the curation proof", () => {
  it("shows a one-star review exactly where a five-star one would be", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await submitReview(db, { userId: "u1", rating: 5, body: LONG_ENOUGH, clock: at("2026-08-01T00:00:00Z"), newId: () => "r-five" });
    await submitReview(db, { userId: "u2", rating: 1, body: BRUTAL, clock: at("2026-08-02T00:00:00Z"), newId: () => "r-one" });

    const feed = await listReviews(db, {});
    expect(feed.reviews.map((r) => r.rating)).toEqual([1, 5]);
  });

  it("has no rating predicate in the feed query at all", () => {
    // Stronger than the case above, which a filter tuned to hide 2-star reviews would still pass.
    // The query's own SQL is inspected: a rating comparison in the feed is the bug this whole
    // feature exists to not have.
    const { sql: text } = feedQuery(db, {}).toSQL();
    expect(text).not.toMatch(/rating/i);
  });

  it("touches EXACTLY two tables — the reviews and their authors, and nothing else", () => {
    // The rating regex above locks a TOKEN; this locks the PROPERTY. A `notExists(reviewReports…)`
    // filter — hiding every review anyone reported, reachable today because
    // `POST /api/reviews/[reviewId]/report` is an unmoderated write open to any signed-in account
    // — contains no "rating" anywhere and passed every other assertion in this file. It cannot
    // pass this one: it names a third table. Neither can a join to `leagues`, `teams`, or
    // anything else a future curation lever would have to reach for.
    expect(tablesIn(feedQuery(db, {}).toSQL().sql)).toEqual(["reviews", "users"]);
  });

  it("keeps a reported review in the feed, in the same place — reports are signal, not a lever", async () => {
    // The behavioral half of the assertion above: reporting is available to any signed-in
    // account, so if it moved or hid anything, curation would be a click away.
    await seedUser("u1");
    await seedUser("u2");
    await submitReview(db, { userId: "u1", rating: 1, body: BRUTAL, clock: at("2026-08-01T00:00:00Z"), newId: () => "r-reported" });
    await submitReview(db, { userId: "u2", rating: 5, body: LONG_ENOUGH, clock: at("2026-08-02T00:00:00Z"), newId: () => "r-clean" });
    const before = (await listReviews(db, {})).reviews.map((r) => r.id);
    expect(before).toEqual(["r-clean", "r-reported"]);

    await reportReview(db, { reviewId: "r-reported", reporterUserId: "u2", reason: "spam", clock: at("2026-08-03T00:00:00Z") });

    expect((await listReviews(db, {})).reviews.map((r) => r.id)).toEqual(before);
  });

  it("edits the existing review rather than adding a second", async () => {
    await seedUser("u1");
    await submitReview(db, { userId: "u1", rating: 2, body: LONG_ENOUGH, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });
    await submitReview(db, { userId: "u1", rating: 4, body: REVISED, clock: at("2026-08-03T00:00:00Z"), newId: () => "r-should-not-be-used" });

    const feed = await listReviews(db, {});
    expect(feed.reviews).toHaveLength(1);
    expect(feed.reviews[0]).toMatchObject({ id: "r1", rating: 4, body: REVISED, createdAt: "2026-08-01T00:00:00.000Z" });
  });

  it("excludes a removed review from the feed and keeps every fact about the removal", async () => {
    await seedUser("u1");
    await seedUser("operator");
    await submitReview(db, { userId: "u1", rating: 5, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });
    await removeReview(db, { reviewId: "r1", removedByUserId: "operator", reason: "spam", clock: at("2026-08-04T00:00:00Z") });

    expect((await listReviews(db, {})).reviews).toHaveLength(0);
    const [row] = await db.select().from(reviews).where(eq(reviews.id, "r1"));
    expect(row).toMatchObject({ body: SPAM, userId: "u1", removedByUserId: "operator", removalReason: "spam" });
  });

  it("paginates with pageSize + 1 lookahead and reports hasMore/nextBefore", async () => {
    for (let i = 0; i < 3; i += 1) {
      const id = `u${i}`;
      await seedUser(id);
      await submitReview(db, { userId: id, rating: 3, body: LONG_ENOUGH, clock: at(`2026-08-0${i + 1}T00:00:00Z`), newId: () => `r${i}` });
    }
    const first = await listReviews(db, {});
    expect(first.reviews).toHaveLength(3);
    expect(first.hasMore).toBe(false);
    expect(first.nextBefore).toBeNull();
  });

  it("pages strictly older reviews with the before cursor", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await submitReview(db, { userId: "u1", rating: 5, body: LONG_ENOUGH, clock: at("2026-08-01T00:00:00Z"), newId: () => "r-old" });
    await submitReview(db, { userId: "u2", rating: 1, body: BRUTAL, clock: at("2026-08-02T00:00:00Z"), newId: () => "r-new" });

    const first = await listReviews(db, {});
    expect(first.reviews.map((r) => r.id)).toEqual(["r-new", "r-old"]);

    const second = await listReviews(db, { before: { createdAt: first.reviews[0]!.createdAt, id: first.reviews[0]!.id } });
    expect(second.reviews.map((r) => r.id)).toEqual(["r-old"]);
  });

  // L4: `created_at` is millisecond-precision and not unique, and the feed used to page with a
  // strict `created_at <` — so a row sharing the boundary row's millisecond silently dropped out
  // of the page after it, on the feed whose whole selling point is that nothing is missing from
  // it. One review per page boundary, every review stamped at the SAME instant.
  it("loses nothing across a page boundary when every review shares one millisecond", async () => {
    const SAME_MS = "2026-08-01T00:00:00.000Z";
    const total = REVIEW_CONFIG.pageSize + 1;
    for (let i = 0; i < total; i += 1) {
      const suffix = String(i).padStart(2, "0");
      await seedUser(`u${suffix}`);
      await submitReview(db, { userId: `u${suffix}`, rating: 3, body: LONG_ENOUGH, clock: at(SAME_MS), newId: () => `r${suffix}` });
    }

    // Page through using only the cursor the feed itself hands back.
    const first = await listReviews(db, {});
    expect(first.hasMore).toBe(true);
    expect(first.nextBefore).not.toBeNull();
    // The cursor carries the boundary ROW, not just its timestamp.
    expect(first.nextBefore).toContain("|");

    const second = await listReviews(db, { before: parseReviewCursor(first.nextBefore ?? "") ?? undefined });
    const seen = [...first.reviews, ...second.reviews].map((review) => review.id);
    expect(new Set(seen).size).toBe(total);
    expect(second.hasMore).toBe(false);
  });
});

describe("listReviews — the verified badge", () => {
  it("marks a reviewer verified when they have finished a season here", async () => {
    await giveCompletedSeasons("u_alice", 1);
    await submitReview(db, { userId: "u_alice", rating: 5, body: LONG_ENOUGH, clock: at("2026-08-01T00:00:00Z"), newId: () => "r-alice" });

    const [review] = (await listReviews(db, {})).reviews;
    expect(review!.verified).toBe(true);
  });

  it("marks a signed-in account that has never played here unverified, and says nothing else about them", async () => {
    // The badge's whole content is one boolean. It never carries the count, because "3 seasons"
    // on a public feed is a fact about a stranger that nobody asked them to publish.
    await seedUser("u_stranger");
    await submitReview(db, { userId: "u_stranger", rating: 3, body: LONG_ENOUGH, clock: at("2026-08-01T00:00:00Z"), newId: () => "r-stranger" });

    const [review] = (await listReviews(db, {})).reviews;
    expect(review!.verified).toBe(false);
    expect(Object.keys(review!)).toEqual([...REVIEW_VIEW_FIELDS]);
  });

  it("costs one extra query for a whole page of reviews, never one per review", async () => {
    // `listReviews` already makes two round trips (the page, then the display-only rating
    // lookup). This is a third, batched over the page's distinct author ids — the same shape
    // `listLeagueActivity`'s three batched name lookups use, and for the same reason.
    await giveCompletedSeasons("u_page_a", INTEGRITY_CONFIG.participation.verifiedSeasonCutoff);
    await seedUser("u_page_b");
    await submitReview(db, { userId: "u_page_a", rating: 5, body: LONG_ENOUGH, clock: at("2026-08-01T00:00:00Z"), newId: () => "r-page-a" });
    await submitReview(db, { userId: "u_page_b", rating: 4, body: REVISED, clock: at("2026-08-02T00:00:00Z"), newId: () => "r-page-b" });

    const counting = countingDb(db);
    const page = await listReviews(counting.db, {});
    expect(page.reviews).toHaveLength(2);
    expect(counting.selectCount()).toBe(3);
  });

  it("never shows a negative badge — an unverified reviewer's row has no verified marker at all beyond the false boolean", async () => {
    await seedUser("u_none");
    await submitReview(db, { userId: "u_none", rating: 2, body: LONG_ENOUGH, clock: at("2026-08-01T00:00:00Z"), newId: () => "r-none" });

    const [review] = (await listReviews(db, {})).reviews;
    const fields: readonly (keyof ReviewView)[] = Object.keys(review!) as (keyof ReviewView)[];
    expect(fields).toEqual([...REVIEW_VIEW_FIELDS]);
    expect(review!.verified).toBe(false);
  });
});

describe("submitReview", () => {
  it("returns the author's name and stored avatar ref", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "Ada Lovelace", avatarUrl: "preset:shield" });
    const result = await submitReview(db, { userId: "u1", rating: 5, body: LONG_ENOUGH, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });
    expect(result.ok && result.review).toMatchObject({ authorName: "Ada Lovelace", authorAvatar: "preset:shield" });
  });

  it("carries the verified badge on the writer's own copy of what they just posted", async () => {
    await giveCompletedSeasons("u_verified_writer", INTEGRITY_CONFIG.participation.verifiedSeasonCutoff);
    const result = await submitReview(db, { userId: "u_verified_writer", rating: 5, body: LONG_ENOUGH, clock: at("2026-08-01T00:00:00Z"), newId: () => "r-verified" });
    expect(result.ok && result.review.verified).toBe(true);

    await seedUser("u_unverified_writer");
    const second = await submitReview(db, { userId: "u_unverified_writer", rating: 3, body: REVISED, clock: at("2026-08-02T00:00:00Z"), newId: () => "r-unverified" });
    expect(second.ok && second.review.verified).toBe(false);
  });

  it("refuses a removed author's write and leaves the removed row byte-unchanged", async () => {
    await seedUser("u1");
    await seedUser("operator");
    await submitReview(db, { userId: "u1", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });
    await removeReview(db, { reviewId: "r1", removedByUserId: "operator", reason: "spam", clock: at("2026-08-04T00:00:00Z") });
    const [before] = await db.select().from(reviews).where(eq(reviews.id, "r1"));

    const result = await submitReview(db, { userId: "u1", rating: 5, body: REVISED, clock: at("2026-08-05T00:00:00Z"), newId: () => "r-never" });
    expect(result).toEqual({ ok: false, status: 409, reason: "We removed your review. It cannot be edited." });

    // The evidence ruling 18's removal row exists to preserve — every column of it.
    const [after] = await db.select().from(reviews).where(eq(reviews.id, "r1"));
    expect(after).toEqual(before);
    // And no second row was inserted to sneak past the unique index either.
    expect(await db.select().from(reviews)).toHaveLength(1);
  });

  it("still lets a NON-removed author edit their own review", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await seedUser("operator");
    await submitReview(db, { userId: "u1", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });
    await submitReview(db, { userId: "u2", rating: 2, body: LONG_ENOUGH, clock: at("2026-08-02T00:00:00Z"), newId: () => "r2" });
    await removeReview(db, { reviewId: "r1", removedByUserId: "operator", reason: "spam", clock: at("2026-08-04T00:00:00Z") });

    const result = await submitReview(db, { userId: "u2", rating: 4, body: REVISED, clock: at("2026-08-05T00:00:00Z"), newId: () => "r-unused" });
    expect(result).toMatchObject({ ok: true, review: { id: "r2", rating: 4, body: REVISED } });
  });
});

/**
 * `submitReview`'s last guard. Real Postgres cannot reach it: the upsert returns no row only
 * when the conflict fired AND `setWhere` was false, which means a row exists with a non-null
 * `removed_at` — the 409 above. The guard is there so a future change to that statement fails
 * LOUDLY rather than reporting a review that was never written, and a stub `Db` is the only way
 * to put the code in the state it defends against.
 */
describe("submitReview — the impossible-state guard", () => {
  // Table-aware: `submitReview` now also reads `completedSeasonsFor` (via `@/league-service/
  // participation`) to compute the badge's own `verified` field, and that query joins `teams` to
  // `leagues` rather than `reviews`/`users` — a stub that answered every `select()` identically
  // would hand it `existingRows` (a review or removal row) where it expects a `count(*)` row.
  // Every real caller sees exactly one grouped row for `count(*)` with no `GROUP BY`; `0` here is
  // what an author with no completed seasons anywhere else actually reads as.
  const stubWith = (existingRows: readonly unknown[], written: readonly unknown[] = []): Db =>
    ({
      insert: () => ({ values: () => ({ onConflictDoUpdate: () => ({ returning: async () => written }) }) }),
      select: () => ({
        from: (table: unknown) => (table === teams ? { innerJoin: () => ({ where: async () => [{ count: 0 }] }) } : { where: async () => existingRows }),
      }),
    }) as unknown as Db;

  it("throws when the upsert writes nothing and there is no removed row to explain it", async () => {
    await expect(submitReview(stubWith([]), { userId: "u1", rating: 4, body: LONG_ENOUGH })).rejects.toThrow(
      "submitReview: no row returned for user u1.",
    );
  });

  it("throws when the upsert writes nothing and the existing row is not removed either", async () => {
    await expect(submitReview(stubWith([{ removedAt: null }]), { userId: "u1", rating: 4, body: LONG_ENOUGH })).rejects.toThrow(
      "submitReview: no row returned for user u1.",
    );
  });

  it("names an author it cannot find rather than rendering a blank byline", async () => {
    // A `users` row vanishing between the write and the author read is FK-impossible today. The
    // fallback exists so the review still renders as somebody's, not as nobody's.
    const row = {
      id: "r1",
      rating: 4,
      body: LONG_ENOUGH,
      createdAt: new Date("2026-08-01T00:00:00Z"),
      updatedAt: new Date("2026-08-01T00:00:00Z"),
    };
    const result = await submitReview(stubWith([], [row]), { userId: "u1", rating: 4, body: LONG_ENOUGH });
    expect(result).toMatchObject({ ok: true, review: { authorName: "A manager", authorAvatar: null } });
  });
});

/**
 * `listReviews` reads the feed and its display-only ratings in two round trips, so a review can
 * disappear between them — `reviews.user_id` cascades on user deletion, which is a real, if
 * rare, way for the second read to come back short. The rating renders as absent rather than as
 * a number nobody chose. A stub `Db` is what lets the two reads disagree on purpose.
 */
describe("listReviews — a rating that vanishes between the two round trips", () => {
  it("renders the review with no rating rather than inventing one", async () => {
    const feedRow = {
      id: "r1",
      userId: "u1",
      body: LONG_ENOUGH,
      createdAt: new Date("2026-08-01T00:00:00Z"),
      updatedAt: new Date("2026-08-01T00:00:00Z"),
      authorName: "Ada Lovelace",
      authorAvatar: null,
    };
    // Three round trips: the feed page, the rating lookup that misses, and the verified-badge
    // lookup — which also comes back empty here, so `u1` reads as never having completed a
    // season and the review renders unverified.
    const responses: readonly (readonly unknown[])[] = [[feedRow], [], []];
    const calls = { made: 0 };
    const chain = (rows: readonly unknown[]): unknown => {
      const self: Record<string, unknown> = {
        then: (resolve: (value: readonly unknown[]) => unknown) => resolve(rows),
      };
      for (const method of ["from", "innerJoin", "where", "orderBy", "limit", "groupBy"]) self[method] = () => self;
      return self;
    };
    const stub = {
      select: () => {
        const rows = responses[calls.made] ?? [];
        calls.made += 1;
        return chain(rows);
      },
    } as unknown as Db;

    const page = await listReviews(stub, {});
    expect(page.reviews).toEqual([
      {
        id: "r1",
        rating: null,
        body: LONG_ENOUGH,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        authorName: "Ada Lovelace",
        authorAvatar: null,
        verified: false,
      },
    ]);
  });
});

describe("myReview", () => {
  it("reports none before a user has ever written one, and the live review after", async () => {
    await seedUser("u1");
    expect(await myReview(db, "u1")).toEqual({ state: "none" });
    await submitReview(db, { userId: "u1", rating: 4, body: LONG_ENOUGH, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });
    expect(await myReview(db, "u1")).toMatchObject({ state: "live", review: { id: "r1", rating: 4, verified: false } });
  });

  it("carries the verified badge on the caller's own live review", async () => {
    await giveCompletedSeasons("u_my_verified", INTEGRITY_CONFIG.participation.verifiedSeasonCutoff);
    await submitReview(db, { userId: "u_my_verified", rating: 5, body: LONG_ENOUGH, clock: at("2026-08-01T00:00:00Z"), newId: () => "r-my-verified" });
    expect(await myReview(db, "u_my_verified")).toMatchObject({ state: "live", review: { verified: true } });
  });

  it("reports the removed state with the operator's reason, never an editable-looking review", async () => {
    await seedUser("u1");
    await seedUser("operator");
    await submitReview(db, { userId: "u1", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });
    await removeReview(db, { reviewId: "r1", removedByUserId: "operator", reason: "spam", clock: at("2026-08-04T00:00:00Z") });

    expect(await myReview(db, "u1")).toEqual({ state: "removed", reason: "spam", removedAt: "2026-08-04T00:00:00.000Z" });
  });

  it("reports an absent removal reason as absent, and still lands the author on a sentence", async () => {
    // `removed_at` and `removal_reason` are independently nullable columns; `removeReview` always
    // writes all three together, but nothing at the database level says it must.
    //
    // `reason` on this contract is the stored TOKEN, so an absent one reads as `null` rather than
    // as "breaking the review rules" — that string is a rendered PHRASE, and standing it in here
    // put two different types under one field name, where a future consumer switching on the
    // token would get a string matching no case. The author still reads a sentence: the mapper
    // owns the fallback, and it owns it in one place.
    await seedUser("u1");
    await submitReview(db, { userId: "u1", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });
    await db.update(reviews).set({ removedAt: new Date("2026-08-04T00:00:00Z") }).where(eq(reviews.id, "r1"));

    expect(await myReview(db, "u1")).toEqual({
      state: "removed",
      reason: null,
      removedAt: "2026-08-04T00:00:00.000Z",
    });
    expect(removalSentenceFor(null)).toBe("We removed your review for breaking the review rules. It cannot be edited.");
  });
});

describe("reportReview", () => {
  it("is idempotent by primary key: reporting twice is the same report, not an error", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await submitReview(db, { userId: "u1", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });

    const first = await reportReview(db, { reviewId: "r1", reporterUserId: "u2", reason: "spam", clock: at("2026-08-02T00:00:00Z") });
    expect(first).toEqual({ ok: true });
    const second = await reportReview(db, { reviewId: "r1", reporterUserId: "u2", reason: "spam", clock: at("2026-08-03T00:00:00Z") });
    expect(second).toEqual({ ok: true });
  });

  it("answers not-found for a review id that doesn't exist", async () => {
    await seedUser("u2");
    const result = await reportReview(db, { reviewId: "missing", reporterUserId: "u2", reason: "spam" });
    expect(result).toEqual({ ok: false, status: 404, reason: "That review is no longer here." });
  });

  async function openFlags() {
    return db.select().from(integrityFlags).where(isNull(integrityFlags.resolvedAt));
  }

  async function reportCount(reviewId: string): Promise<number> {
    const rows = await db.select({ reporterUserId: reviewReports.reporterUserId }).from(reviewReports).where(eq(reviewReports.reviewId, reviewId));
    return rows.length;
  }

  it("raises exactly one open flag however many people report the same review", async () => {
    await seedUser("u1");
    await seedUser("u_a");
    await seedUser("u_b");
    await submitReview(db, { userId: "u1", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "r_1" });

    await reportReview(db, { reviewId: "r_1", reporterUserId: "u_a", reason: "spam" });
    await reportReview(db, { reviewId: "r_1", reporterUserId: "u_b", reason: "abusive" });

    const flags = await openFlags();
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ flagType: "review_report", subjectType: "review", subjectId: "r_1" });
    // Both reports are still rows in review_reports: that table stays the insert-only signal and
    // this row is the decision. The queue derives the count, it does not store it (ruling 5).
    expect(await reportCount("r_1")).toBe(2);
  });

  it("still treats a second report from the SAME reporter as confirmation, not an error", async () => {
    // The behavior Phase 2 shipped on the composite primary key, unchanged by the flag.
    await seedUser("u1");
    await seedUser("u_a");
    await submitReview(db, { userId: "u1", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "r_1" });

    await reportReview(db, { reviewId: "r_1", reporterUserId: "u_a", reason: "spam" });
    expect(await reportReview(db, { reviewId: "r_1", reporterUserId: "u_a", reason: "spam" })).toEqual({ ok: true });
    expect(await openFlags()).toHaveLength(1);
  });

  it("raises the flag and the report row together, or neither — the transaction proof", async () => {
    await seedUser("u1");
    await seedUser("u_a");
    await submitReview(db, { userId: "u1", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "r_1" });

    const brokenAudit = { ...logger, record: async () => { throw new Error("audit append failed"); } };
    await expect(reportReview(db, { reviewId: "r_1", reporterUserId: "u_a", reason: "spam", audit: brokenAudit })).rejects.toThrow("audit append failed");

    expect(await reportCount("r_1")).toBe(0);
    expect(await openFlags()).toHaveLength(0);
  });
});

describe("removeReview", () => {
  it("stamps removal and returns the record the script prints", async () => {
    await seedUser("u1");
    await seedUser("operator");
    await submitReview(db, { userId: "u1", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });

    const result = await removeReview(db, { reviewId: "r1", removedByUserId: "operator", reason: "spam", clock: at("2026-08-04T00:00:00Z") });
    expect(result).toEqual({
      ok: true,
      record: {
        reviewId: "r1",
        userId: "u1",
        removedByUserId: "operator",
        reason: "spam",
        removedAt: "2026-08-04T00:00:00.000Z",
      },
    });
  });

  it("refuses a review id that doesn't exist", async () => {
    const result = await removeReview(db, { reviewId: "missing", removedByUserId: "operator", reason: "spam" });
    expect(result).toEqual({ ok: false, reason: 'No review with id "missing".' });
  });

  // Fix round 1, FIX 7: defense in depth alongside the script's own closed-enum `--reason` gate
  // — this function, not the CLI, is the boundary a future direct caller would actually hit.
  // Checked before any write, and before the review-id lookup even runs (a too-long reason is
  // wrong regardless of which review it names).
  it("refuses a reason longer than REVIEW_CONFIG.removalReason.maxLength, before any write", async () => {
    const tooLong = "x".repeat(REVIEW_CONFIG.removalReason.maxLength + 1);
    const result = await removeReview(db, { reviewId: "missing", removedByUserId: "operator", reason: tooLong });
    expect(result).toEqual({
      ok: false,
      reason: `--reason must be ${REVIEW_CONFIG.removalReason.maxLength} characters or fewer.`,
    });
  });

  it("refuses to re-stamp an already-removed review — the no-re-stamp invariant, enforced here and not just in the script", async () => {
    await seedUser("u1");
    await seedUser("operator");
    await seedUser("operator2");
    await submitReview(db, { userId: "u1", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });

    const first = await removeReview(db, { reviewId: "r1", removedByUserId: "operator", reason: "spam", clock: at("2026-08-04T00:00:00Z") });
    expect(first.ok).toBe(true);

    // A second operator's attempt is refused, not a silent overwrite of the first operator's
    // reason and timestamp.
    const second = await removeReview(db, { reviewId: "r1", removedByUserId: "operator2", reason: "abusive", clock: at("2026-08-05T00:00:00Z") });
    expect(second).toEqual({ ok: false, reason: 'Review "r1" is already removed.' });

    // The original stamp is untouched by the refused second attempt.
    const [row] = await db.select().from(reviews).where(eq(reviews.id, "r1"));
    expect(row).toMatchObject({ removedByUserId: "operator", removalReason: "spam" });
    expect(row?.removedAt?.toISOString()).toBe("2026-08-04T00:00:00.000Z");
  });

  it("records the removal on the platform chain, and only when the stamp actually landed", async () => {
    await seedUser("user_bob");
    await seedUser("user_operator");
    await seedUser("user_other");
    await submitReview(db, { userId: "user_bob", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "rev_1" });

    await removeReview(db, { reviewId: "rev_1", removedByUserId: "user_operator", reason: "abuse", clock: at("2026-08-04T00:00:00Z"), audit: logger });
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "review_removed"));
    expect(event).toMatchObject({ chainScope: "platform", leagueId: null, actorId: "user_operator", actorType: "user" });
    // `flagId` is `null` here — the script's own door, which resolves no flag.
    expect(event!.payload).toEqual({ reviewId: "rev_1", authorUserId: "user_bob", reason: "abuse", flagId: null });

    // The no-re-stamp invariant means a second removal changes nothing, so it must record nothing.
    await removeReview(db, { reviewId: "rev_1", removedByUserId: "user_other", reason: "spam", clock: at("2026-08-05T00:00:00Z"), audit: logger });
    expect(await db.select().from(auditEvents).where(eq(auditEvents.eventType, "review_removed"))).toHaveLength(1);
  });

  it("records nothing when there is no review to remove", async () => {
    await removeReview(db, { reviewId: "missing", removedByUserId: "operator", reason: "spam", audit: logger });
    expect(await db.select().from(auditEvents)).toHaveLength(0);
  });

  it("rolls back the removal stamp when the audit append fails — ruling 4, the opposite of publishing", async () => {
    await seedUser("u1");
    await seedUser("operator");
    await submitReview(db, { userId: "u1", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });

    const brokenAudit = { ...logger, record: async () => { throw new Error("audit append failed"); } };
    await expect(
      removeReview(db, { reviewId: "r1", removedByUserId: "operator", reason: "spam", clock: at("2026-08-04T00:00:00Z"), audit: brokenAudit }),
    ).rejects.toThrow("audit append failed");

    const [row] = await db.select().from(reviews).where(eq(reviews.id, "r1"));
    expect(row?.removedAt).toBeNull();
  });
});

describe("removeReview — notices", () => {
  it("writes the notice the removed review's author can read, and names the event minted after it", async () => {
    await seedUser("user_bob");
    await seedUser("user_operator");
    await submitReview(db, { userId: "user_bob", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "rev_1" });

    await removeReview(db, { reviewId: "rev_1", removedByUserId: "user_operator", reason: "other", clock: at("2026-08-04T00:00:00Z"), audit: logger });

    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "review_removed"));
    const [notice] = await db.select().from(memberNotices);
    expect(notice).toMatchObject({
      userId: "user_bob",
      leagueId: null,
      noticeType: "review_removed",
      title: "We removed your review",
      // The notice row is now written BEFORE the append (ruling 3: its insert takes an FK lock on
      // `users`, and the anchor is the last lock), then stamped with the event id by
      // `attachAuditEvent`. This assertion is what proves the second statement actually ran.
      auditEventId: event!.eventId,
      readAt: null,
    });
    // The reason is stored on `context` as the token it is, and MAPPED at render — see `quoteFor`.
    expect(notice!.body).toBe("An operator removed your review. We keep your review on file exactly as you wrote it. There is no reply to this message.");
    expect(notice!.context).toEqual({ reason: "other" });
  });

  /**
   * HIGH-3: the blockquote used to render the stored enum, so a removed author's inbox read
   * "We removed your review" / "other". Three things in this codebase disagreed with that, and
   * the operator's confirmation preview promised a fourth thing again.
   *
   * This holds the two ends together: what `scripts/remove-review.ts` prints in its preview and
   * what a member actually reads come out of the SAME functions, for every value in the closed
   * vocabulary. The script's preview is those functions; that is the point of extracting them.
   */
  it("shows the operator exactly the words the author reads, for every removal reason", async () => {
    for (const reason of REMOVAL_REASON_VALUES) {
      await truncateAll(db);
      await seedUser("author");
      await seedUser("operator");
      await submitReview(db, { userId: "author", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "rev_1" });
      await removeReview(db, { reviewId: "rev_1", removedByUserId: "operator", reason, clock: at("2026-08-04T00:00:00Z"), audit: logger });

      const [row] = await db.select().from(memberNotices);
      const stored: MemberNotice = {
        id: row!.id, userId: row!.userId, leagueId: row!.leagueId, noticeType: "review_removed",
        title: row!.title, body: row!.body, context: row!.context, auditEventId: row!.auditEventId,
        createdAt: row!.createdAt.toISOString(), readAt: null,
      };

      // The script's preview lines, built the one way the script builds them.
      const preview = renderNotice("review_removed", { reason });
      expect(stored.title).toBe(preview.title);
      expect(stored.body).toBe(preview.body);
      expect(quoteFor(stored)).toBe(removalPhraseFor(reason));

      // And the raw token never reaches the reader on its own.
      expect(quoteFor(stored)).not.toBe(reason);
      expect(removalSentenceFor(reason)).toContain(removalPhraseFor(reason));
    }
  });

  it("writes no notice when there is nothing to remove", async () => {
    await removeReview(db, { reviewId: "missing", removedByUserId: "operator", reason: "spam", audit: logger });
    expect(await db.select().from(memberNotices)).toHaveLength(0);
  });

  it("writes no second notice for a re-stamp attempt the WHERE clause refuses", async () => {
    await seedUser("u1");
    await seedUser("operator");
    await seedUser("operator2");
    await submitReview(db, { userId: "u1", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });

    await removeReview(db, { reviewId: "r1", removedByUserId: "operator", reason: "spam", clock: at("2026-08-04T00:00:00Z"), audit: logger });
    await removeReview(db, { reviewId: "r1", removedByUserId: "operator2", reason: "abusive", clock: at("2026-08-05T00:00:00Z"), audit: logger });

    expect(await db.select().from(memberNotices)).toHaveLength(1);
  });

  it("rolls back the removal stamp and its audit event when the notice write fails", async () => {
    await seedUser("u1");
    await seedUser("operator");
    await submitReview(db, { userId: "u1", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });

    const brokenNotify: typeof notifyAffectedMember = async () => {
      throw new Error("notice write failed");
    };
    await expect(
      removeReview(db, {
        reviewId: "r1", removedByUserId: "operator", reason: "spam", clock: at("2026-08-04T00:00:00Z"),
        audit: logger, notify: brokenNotify,
      }),
    ).rejects.toThrow("notice write failed");

    const [row] = await db.select().from(reviews).where(eq(reviews.id, "r1"));
    expect(row?.removedAt).toBeNull();
    expect(await db.select().from(auditEvents)).toHaveLength(0);
  });
});
