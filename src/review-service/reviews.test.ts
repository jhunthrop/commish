import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { reviews, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { feedQuery, listReviews, myReview, removeReview, reportReview, submitReview } from "./reviews";

const db = createTestDb();

const at = (iso: string): Clock => ({ now: () => iso });

const LONG_ENOUGH = "This league runs itself. Draft night was smooth and scoring settled fast.";
const BRUTAL = "The commissioner vanished mid-season and nobody ever settled the standings.";
const REVISED = "Updating my review: they came back and made it right. Genuinely impressed now.";
const SPAM = "Click here for free V-bucks, best fantasy site ever, link in bio!!!";

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

    const second = await listReviews(db, { before: first.reviews[0]!.createdAt });
    expect(second.reviews.map((r) => r.id)).toEqual(["r-old"]);
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
