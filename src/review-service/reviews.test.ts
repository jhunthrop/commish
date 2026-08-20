import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, getTableName, is, Table } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { reviews, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { REVIEW_CONFIG } from "@/reviews/config";
import { parseReviewCursor } from "@/reviews/cursor";
import { feedQuery, listReviews, myReview, removeReview, reportReview, submitReview } from "./reviews";

const db = createTestDb();

const at = (iso: string): Clock => ({ now: () => iso });

const LONG_ENOUGH = "This league runs itself. Draft night was smooth and scoring settled fast.";
const BRUTAL = "The commissioner vanished mid-season and nobody ever settled the standings.";
const REVISED = "Updating my review: they came back and made it right. Genuinely impressed now.";
const SPAM = "Click here for free V-bucks, best fantasy site ever, link in bio!!!";

/** Every table this schema declares, so "which of them does this SQL name" is a closed question. */
const ALL_TABLE_NAMES: readonly string[] = Object.values(schema)
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

beforeEach(async () => {
  await truncateAll(db);
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

describe("submitReview", () => {
  it("returns the author's name and stored avatar ref", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "Ada Lovelace", avatarUrl: "preset:shield" });
    const result = await submitReview(db, { userId: "u1", rating: 5, body: LONG_ENOUGH, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });
    expect(result.ok && result.review).toMatchObject({ authorName: "Ada Lovelace", authorAvatar: "preset:shield" });
  });

  it("refuses a removed author's write and leaves the removed row byte-unchanged", async () => {
    await seedUser("u1");
    await seedUser("operator");
    await submitReview(db, { userId: "u1", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });
    await removeReview(db, { reviewId: "r1", removedByUserId: "operator", reason: "spam", clock: at("2026-08-04T00:00:00Z") });
    const [before] = await db.select().from(reviews).where(eq(reviews.id, "r1"));

    const result = await submitReview(db, { userId: "u1", rating: 5, body: REVISED, clock: at("2026-08-05T00:00:00Z"), newId: () => "r-never" });
    expect(result).toEqual({ ok: false, status: 409, reason: "Your review was removed and can't be edited." });

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
  const stubWith = (existingRows: readonly unknown[], written: readonly unknown[] = []): Db =>
    ({
      insert: () => ({ values: () => ({ onConflictDoUpdate: () => ({ returning: async () => written }) }) }),
      select: () => ({ from: () => ({ where: async () => existingRows }) }),
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
      body: LONG_ENOUGH,
      createdAt: new Date("2026-08-01T00:00:00Z"),
      updatedAt: new Date("2026-08-01T00:00:00Z"),
      authorName: "Ada Lovelace",
      authorAvatar: null,
    };
    const responses: readonly (readonly unknown[])[] = [[feedRow], []];
    const calls = { made: 0 };
    const chain = (rows: readonly unknown[]): unknown => {
      const self: Record<string, unknown> = {
        then: (resolve: (value: readonly unknown[]) => unknown) => resolve(rows),
      };
      for (const method of ["from", "innerJoin", "where", "orderBy", "limit"]) self[method] = () => self;
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
      },
    ]);
  });
});

describe("myReview", () => {
  it("reports none before a user has ever written one, and the live review after", async () => {
    await seedUser("u1");
    expect(await myReview(db, "u1")).toEqual({ state: "none" });
    await submitReview(db, { userId: "u1", rating: 4, body: LONG_ENOUGH, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });
    expect(await myReview(db, "u1")).toMatchObject({ state: "live", review: { id: "r1", rating: 4 } });
  });

  it("reports the removed state with the operator's reason, never an editable-looking review", async () => {
    await seedUser("u1");
    await seedUser("operator");
    await submitReview(db, { userId: "u1", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });
    await removeReview(db, { reviewId: "r1", removedByUserId: "operator", reason: "spam", clock: at("2026-08-04T00:00:00Z") });

    expect(await myReview(db, "u1")).toEqual({ state: "removed", reason: "spam", removedAt: "2026-08-04T00:00:00.000Z" });
  });

  it("still explains a removal whose reason column is somehow empty", async () => {
    // `removed_at` and `removal_reason` are independently nullable columns; `removeReview` always
    // writes all three together, but nothing at the database level says it must. The author gets
    // a sentence either way rather than "removed for null".
    await seedUser("u1");
    await submitReview(db, { userId: "u1", rating: 1, body: SPAM, clock: at("2026-08-01T00:00:00Z"), newId: () => "r1" });
    await db.update(reviews).set({ removedAt: new Date("2026-08-04T00:00:00Z") }).where(eq(reviews.id, "r1"));

    expect(await myReview(db, "u1")).toEqual({
      state: "removed",
      reason: "breaking the review rules",
      removedAt: "2026-08-04T00:00:00.000Z",
    });
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
});
