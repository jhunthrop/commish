import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { auditEvents, memberNotices, users } from "@/db/schema";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
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
 * "found by grep rather than by memory", applied here as a DRIFT TRIPWIRE for ruling 15: it
 * catches an accidental second writer of `users.isAdmin` written in the idiomatic spellings this
 * codebase actually uses (a Drizzle `.set({ isAdmin: … })`/column definition, or a raw
 * `is_admin` in hand-written SQL). It is NOT a proof against a deliberately obfuscated write — a
 * computed property key (`.set({ [col]: true })`) or an ORM call built from a dynamically
 * assembled column name would slip past every regex below, the same way a `victoryOK` filter
 * cannot catch every mine sweep — and closing that gap is what `code-reviewer` and the merge
 * review are for, not a static scan. What this DOES buy: the same accidental-drift class every
 * other source-scan test in this codebase catches (`reserved.test.ts`'s "found by grep rather
 * than by memory"), which is the failure mode a second contributor actually produces by adding an
 * ordinary write somewhere convenient, not by trying to evade a test.
 */
function grepSourceTree(pattern: RegExp, { dirs, exclude }: GrepOptions): readonly string[] {
  return dirs
    .flatMap((dir) => walk(join(process.cwd(), dir), exclude))
    .filter((path) => pattern.test(readFileSync(path, "utf8")))
    .map((path) => relative(process.cwd(), path))
    .sort();
}

describe("ruling 15 — no in-product way to grant operator access (a drift tripwire, not a proof — see grepSourceTree's docblock)", () => {
  it("gives an ordinary account no way to become an operator through the product's idiomatic write shapes", () => {
    // Every writer of users.isAdmin (the TS/Drizzle spelling), found by grep rather than by
    // memory: the column's own definition, and the one UPDATE that ever sets it. `top-bar.tsx`
    // (Task 5's `app-header.tsx`, renamed by Task 2) joins this list too, and is the false
    // positive the docblock above already names: `TopBarProps.isAdmin` is a prop TYPE —
    // `readonly isAdmin: boolean` — not a write, and the regex cannot tell the two spellings
    // apart. Task 2's shell adds four more of the exact same false positive: `app-shell.tsx`
    // (`AppShellProps.user.isAdmin`, another prop TYPE), the `(shell)` layout (`isAdmin: user
    // .isAdmin`, a plain passthrough READ into that same prop), and `browse/page.tsx` /
    // `reviews/page.tsx` (the SAME passthrough — both sit outside `/app` and call `shellData`/
    // render `AppShell` themselves, Task 2 Step 5). None of these WRITE to the column. Left in
    // rather than tightened, because narrowing the pattern to dodge a known-safe match is
    // exactly the kind of adjustment that quietly widens what this tripwire would miss on a REAL
    // second writer later. Phase 3.6, Task 6 adds a sixth, the identical false positive: the seat-
    // hold page (`/join/[leagueId]/hold`) sits outside `/app` too, and its signed-in "the return"
    // branch renders `AppShell` the same passthrough way `browse/page.tsx` already does.
    const writers = grepSourceTree(/\bisAdmin\s*:/, { dirs: ["src", "scripts"], exclude: /\.test\.tsx?$/ });
    expect(writers).toEqual([
      "src/app/app/(shell)/layout.tsx",
      "src/app/browse/page.tsx",
      "src/app/join/[leagueId]/hold/page.tsx",
      "src/app/reviews/page.tsx",
      // The flow analysis's A4 (2026-08-27): the five operator pages had no door, so the shell
      // grew an admin-only console nav. It DECLARES `isAdmin` as a prop and READS it to decide
      // whether to render — it grants nothing, writes nothing, and infers nothing from the
      // route. Added deliberately, which is what this tripwire exists to force.
      "src/components/app-shell/admin-console-nav.tsx",
      "src/components/app-shell/app-shell.tsx",
      "src/components/app-shell/top-bar.tsx",
      "research-ts/src/db/schema.ts",
      "src/integrity-service/grant-admin.ts",
    ]);

    // The same claim, in the RAW COLUMN spelling (`is_admin`) rather than the TS property name —
    // this is what catches a hand-written `sql\`UPDATE users SET is_admin = …\`` that never types
    // `isAdmin:` at all and so slips the scan above. `schema.ts` is excluded because it is the
    // one legitimate place the raw column name is declared (`boolean("is_admin")`); every other
    // production file that needs to TALK ABOUT the column does so via the TS property name
    // (`users.isAdmin`) in its own prose, which is what keeps this scan meaningful instead of
    // permanently red.
    const columnWriters = grepSourceTree(/\bis_admin\b/, { dirs: ["src", "scripts"], exclude: /\.test\.tsx?$|^schema\.ts$/ });
    expect(columnWriters).toEqual([]);

    // …and the only callers of grantAdmin are the script, the seed's own bootstrap grant, and
    // the function's own declaration (moved to its own module, fix round 1 — see that file's
    // docblock: `raiseFlag`/`grantAdmin` colocation in `flags.ts` let a same-file call escape
    // `flag-only.test.ts`'s import-closure proof entirely).
    const callers = grepSourceTree(/grantAdmin\(/, { dirs: ["src", "scripts"], exclude: /\.test\.tsx?$/ });
    expect(callers).toEqual(["scripts/grant-admin.ts", "src/data/seed/seed-operator.ts", "src/integrity-service/grant-admin.ts"]);
  });
});
