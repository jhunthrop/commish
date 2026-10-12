import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { users } from "@/db/schema";

const withAuth = vi.fn<() => Promise<{ readonly user: { readonly id: string; readonly email: string } | null }>>();
vi.mock("@workos-inc/authkit-nextjs", () => ({ withAuth: () => withAuth() }));

const db: Db = createTestDb();
vi.mock("@research-ts/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@research-ts/db/client")>();
  return { ...actual, getDb: () => db };
});

const { getCurrentUser, requireAdmin, requireCurrentUser } = await import("./current-user");

/** Points `withAuth` at a session for `workosUserId`, or a signed-out session for `null`. */
function signInAs(workosUserId: string | null): void {
  withAuth.mockResolvedValue({ user: workosUserId === null ? null : { id: workosUserId, email: `${workosUserId}@test.local` } });
}

async function seedUser(target: Db, input: { readonly id: string; readonly isAdmin?: boolean }): Promise<void> {
  await target.insert(users).values({ id: input.id, email: `${input.id}@test.local`, displayName: input.id, isAdmin: input.isAdmin ?? false });
}

async function getCurrentUserWith(opts: { readonly workosUserId: string | null }) {
  signInAs(opts.workosUserId);
  return getCurrentUser();
}

async function requireAdminWith(opts: { readonly workosUserId: string | null }) {
  signInAs(opts.workosUserId);
  return requireAdmin();
}

beforeEach(async () => {
  await truncateAll(db);
  withAuth.mockReset();
});

describe("getCurrentUser — the operator flag", () => {
  it("hands back the admin flag as part of the identity, not as a second lookup", async () => {
    await seedUser(db, { id: "u_op", isAdmin: true });
    const user = await getCurrentUserWith({ workosUserId: "u_op" });
    expect(user?.isAdmin).toBe(true);
  });

  it("defaults every account that has never been granted anything to false", async () => {
    await seedUser(db, { id: "u_plain" });
    const user = await getCurrentUserWith({ workosUserId: "u_plain" });
    expect(user?.isAdmin).toBe(false);
  });

  it("is false for a freshly backfilled session with no local row yet — a brand-new row is never an operator", async () => {
    const user = await getCurrentUserWith({ workosUserId: "u_never_seen" });
    expect(user?.isAdmin).toBe(false);
    const [row] = await db.select().from(users).where(eq(users.id, "u_never_seen"));
    expect(row?.isAdmin).toBe(false);
  });

  it("is null for a signed-out caller, same as before this task", async () => {
    expect(await getCurrentUserWith({ workosUserId: null })).toBeNull();
  });
});

describe("requireAdmin", () => {
  it("returns the caller when they are an operator", async () => {
    await seedUser(db, { id: "u_op", isAdmin: true });
    const user = await requireAdminWith({ workosUserId: "u_op" });
    expect(user.id).toBe("u_op");
    expect(user.isAdmin).toBe(true);
  });

  it("refuses an ordinary signed-in account by name, so a caller cannot mistake it for a 401", async () => {
    await seedUser(db, { id: "u_plain" });
    await expect(requireAdminWith({ workosUserId: "u_plain" })).rejects.toThrow("Not an operator.");
  });

  it("refuses a signed-out caller with the SAME message requireCurrentUser uses", async () => {
    // requireAdmin composes requireCurrentUser rather than re-reading the session: two ways to
    // answer "who is this" is how they drift, and the drift here is an auth bypass.
    await expect(requireAdminWith({ workosUserId: null })).rejects.toThrow("Not authenticated.");
  });
});

describe("requireCurrentUser", () => {
  it("still throws its own message unchanged", async () => {
    signInAs(null);
    await expect(requireCurrentUser()).rejects.toThrow("Not authenticated.");
  });
});
