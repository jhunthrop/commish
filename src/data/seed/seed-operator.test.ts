import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { auditEvents, memberNotices, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { DEV_SEED } from "./config";
import { seedOperator } from "./seed-operator";

const db = createTestDb();
const clock = { now: () => "2026-09-01T00:00:00.000Z" };

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("seedOperator", () => {
  it("grants the claimed account operator access through the real writer — a real audit event and a real notice, not mock data", async () => {
    await db.insert(users).values({ id: "u_founder", email: "founder@test.local", displayName: "Founder" });

    const result = await seedOperator(db, clock, "u_founder");
    expect(result).toEqual({ ok: true, userId: "u_founder", isAdmin: true });

    const [row] = await db.select().from(users).where(eq(users.id, "u_founder"));
    expect(row?.isAdmin).toBe(true);

    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "admin_action"));
    expect(event).toMatchObject({ chainScope: "platform", actorId: null, actorType: "system" });
    expect(event!.payload).toEqual({ action: "admin_granted", subjectUserId: "u_founder" });

    const [notice] = await db.select().from(memberNotices).where(eq(memberNotices.userId, "u_founder"));
    expect(notice?.noticeType).toBe("admin_granted");
  });

  it("falls back to the first dev placeholder when no account has been claimed yet", async () => {
    const fallbackId = `${DEV_SEED.userIdPrefix}01`;
    await db.insert(users).values({ id: fallbackId, email: `${fallbackId}@test.local`, displayName: "Dev Manager 01" });

    const result = await seedOperator(db, clock);
    expect(result).toEqual({ ok: true, userId: fallbackId, isAdmin: true });
  });

  it("is a graceful no-op on a reseed — the bootstrap check refuses rather than crashing", async () => {
    // `grantAdmin`'s bootstrap check runs BEFORE its UPDATE, so a reseed (which always grants
    // with `--by bootstrap`) is refused by that check — "this database already has an operator"
    // — the moment the first seed's own grant made one exist, not by the toggle's own
    // already-set guard. Either refusal is a graceful `{ ok: false }`, never a throw.
    await db.insert(users).values({ id: "u_founder", email: "founder@test.local", displayName: "Founder" });
    await seedOperator(db, clock, "u_founder");

    const second = await seedOperator(db, clock, "u_founder");
    expect(second).toEqual({ ok: false, reason: "This database already has an operator. Pass --by <their user id>." });
  });
});

interface GrepOptions {
  readonly dirs: readonly string[];
  readonly exclude: RegExp;
}

function walk(dir: string, exclude: RegExp): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, exclude);
    if (!/\.tsx?$/.test(entry.name) || exclude.test(entry.name)) return [];
    return [full];
  });
}

/**
 * Every production file (`.ts`/`.tsx`, not matching `exclude`) under the given repo-root-relative
 * `dirs` whose text matches `pattern` — the source-scan idiom `reserved.test.ts` established for
 * "found by grep rather than by memory", applied here to prove ruling 15's negative: nobody
 * outside the two files below can ever write `users.is_admin`, and nobody outside three call
 * sites can ever reach the one function that does.
 */
function grepSourceTree(pattern: RegExp, { dirs, exclude }: GrepOptions): readonly string[] {
  return dirs
    .flatMap((dir) => walk(join(process.cwd(), dir), exclude))
    .filter((path) => pattern.test(readFileSync(path, "utf8")))
    .map((path) => relative(process.cwd(), path))
    .sort();
}

describe("ruling 15 — no in-product way to grant operator access", () => {
  it("gives an ordinary account no way to become an operator through the product", () => {
    // Every writer of users.is_admin, found by grep rather than by memory: the column's own
    // definition, and the one UPDATE that ever sets it.
    const writers = grepSourceTree(/\bisAdmin\s*:/, { dirs: ["src", "scripts"], exclude: /\.test\.tsx?$/ });
    expect(writers).toEqual(["src/db/schema.ts", "src/integrity-service/flags.ts"]);

    // …and the only callers of grantAdmin are the script, the seed's own bootstrap grant, and
    // the function's own declaration.
    const callers = grepSourceTree(/grantAdmin\(/, { dirs: ["src", "scripts"], exclude: /\.test\.tsx?$/ });
    expect(callers).toEqual(["scripts/grant-admin.ts", "src/data/seed/seed-operator.ts", "src/integrity-service/flags.ts"]);
  });
});
