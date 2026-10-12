import { withAuth } from "@workos-inc/authkit-nextjs";
import { eq } from "drizzle-orm";
import { getDb } from "@research/db/client";
import { users } from "@/db/schema";
import type { User } from "@/domain/user";
import { syncUserFromWorkOS } from "./user-sync";

const systemClock = { now: () => new Date().toISOString() };

/**
 * `isAdmin` is `Readonly<Pick<…, "isAdmin">>` off the same Drizzle-inferred row shape
 * `user-sync.ts`'s `UserRow` uses, not a hand-retyped `boolean` — the operator flag's type has
 * exactly one source of truth (the column), so a future migration that ever changed its shape
 * would fail this file's compile instead of silently drifting from it.
 */
export interface CurrentUser extends User, Readonly<Pick<typeof users.$inferSelect, "isAdmin">> {
  readonly email: string;
}

/**
 * The single server-side identity seam. Every server component, route handler, and
 * server action that needs "who is this" calls this — never WorkOS directly.
 *
 * WorkOS AuthKit owns authentication (credentials, sessions, MFA, OAuth). This joins
 * the WorkOS session to our local profile row, creating it if the callback hasn't yet
 * (e.g. a session established before a deploy that added this table).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { user: wu } = await withAuth();
  if (!wu) return null;

  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.id, wu.id));
  const profile = row !== undefined ? row : null;

  // A row this read just found carries the flag straight through — no second lookup. A row this
  // read did NOT find is about to be created (or was just created) by the backfill below, and a
  // brand-new row is never an operator: `scripts/grant-admin.ts` is the only writer of this
  // column, and it grants an EXISTING user, so "no local row yet" and "not an operator" are the
  // same fact here.
  const isAdmin = profile?.isAdmin ?? false;

  const local =
    profile !== null
      ? {
          id: profile.id,
          displayName: profile.displayName,
          experienceTier: profile.experienceTier,
          avatarUrl: profile.avatarUrl,
          createdAt: profile.createdAt.toISOString(),
        }
      : // The lazy backfill: a valid AuthKit session whose local row is missing (a database
        // restore, a row deleted by hand, a first request that raced the callback). It is a
        // sign-in event either way — the person did just present a session — but it is NOT the
        // callback, and the audit row says which (`SessionEntry`).
        await syncUserFromWorkOS({ db, clock: systemClock, via: "session_backfill" }, wu);

  return { ...local, isAdmin, email: wu.email };
}

export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user === null) throw new Error("Not authenticated.");
  return user;
}

/**
 * The operator gate. Composes `requireCurrentUser` rather than reading the session again, so
 * there is exactly one answer to "who is this" in this codebase and this function only answers
 * the second question.
 *
 * It THROWS rather than returning a `Response`, matching `requireCurrentUser`. Route handlers
 * translate; `withAdmin` (`src/app/api/admin/_shared.ts`) is the one place that translation lives
 * and it answers 404, never 403 (ruling 14).
 */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireCurrentUser();
  if (!user.isAdmin) throw new Error("Not an operator.");
  return user;
}
