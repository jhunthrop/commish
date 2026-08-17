import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import type { User } from "@/domain/user";

/** The subset of the WorkOS User object this module needs — kept narrow so it's easy to fake in tests. */
export interface WorkOSUserLike {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly profilePictureUrl?: string | null;
}

interface Deps {
  readonly db: Db;
  readonly clock: Clock;
}

export function displayNameFrom(u: Pick<WorkOSUserLike, "firstName" | "lastName" | "email">): string {
  const parts = [u.firstName, u.lastName].filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  if (parts.length > 0) return parts.join(" ");
  return u.email.split("@")[0] ?? u.email;
}

function toUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    displayName: row.displayName,
    experienceTier: row.experienceTier,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Upserts the local profile row for a WorkOS user. Called from the AuthKit callback on
 * every sign-in. Identity fields (email) follow the provider; app-owned fields
 * (displayName, experienceTier, avatarUrl) are only set on first creation and are
 * never clobbered by a later sync — the user may have edited them in-app.
 */
export async function syncUserFromWorkOS({ db, clock }: Deps, wu: WorkOSUserLike): Promise<User> {
  const now = new Date(clock.now());
  const [row] = await db
    .insert(users)
    .values({
      id: wu.id,
      email: wu.email.toLowerCase(),
      displayName: displayNameFrom(wu),
      avatarUrl: wu.profilePictureUrl ?? null,
      createdAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: sql`excluded.email`,
        lastSeenAt: now,
      },
    })
    .returning();
  if (row === undefined) throw new Error("User upsert returned no row.");
  return toUser(row);
}
