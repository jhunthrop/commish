import { withAuth } from "@workos-inc/authkit-nextjs";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import type { User } from "@/domain/user";
import { syncUserFromWorkOS } from "./user-sync";

const systemClock = { now: () => new Date().toISOString() };

export interface CurrentUser extends User {
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

  const local =
    profile !== null
      ? {
          id: profile.id,
          displayName: profile.displayName,
          experienceTier: profile.experienceTier,
          avatarUrl: profile.avatarUrl,
          createdAt: profile.createdAt.toISOString(),
        }
      : await syncUserFromWorkOS({ db, clock: systemClock }, wu);

  return { ...local, email: wu.email };
}

export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user === null) throw new Error("Not authenticated.");
  return user;
}
