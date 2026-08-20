import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import type { User } from "@/domain/user";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";

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
  /** Defaults to the process-wide logger (`getAuditLogger()`), the same way every other writer here defaults its collaborators. */
  readonly audit?: AuditLogger;
}

export function displayNameFrom(u: Pick<WorkOSUserLike, "firstName" | "lastName" | "email">): string {
  const parts = [u.firstName, u.lastName].filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  if (parts.length > 0) return parts.join(" ");
  return u.email.split("@")[0] ?? u.email;
}

type UserRow = Pick<typeof users.$inferSelect, "id" | "displayName" | "experienceTier" | "avatarUrl" | "createdAt">;

function toUser(row: UserRow): User {
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
 *
 * Every sign-in also writes a `session_started` event on the PLATFORM chain (ruling 4: no catch,
 * no best-effort — a sign-in nobody recorded is a hole in the record), so the upsert is wrapped
 * in a transaction even though it is one statement on its own: the row and its audit event must
 * commit together. `firstSignIn` is read off `xmax = 0` on the `RETURNING` row rather than a
 * second query — the standard Postgres way to tell an insert from an update inside an
 * `ON CONFLICT` return.
 *
 * Carries NO IP and NO device signal (ruling 20). All four existing IP reads in this codebase key
 * on `X-Forwarded-For`, which their own docblocks call caller-controlled and rotatable — a
 * multi-account flag built on a forgeable header lets an attacker manufacture suspicion against
 * someone else's account, which is worse than the bypassed rate limiter it would be defending
 * against. Plan B adds real device/IP signals, with the IP weight at zero.
 */
export async function syncUserFromWorkOS({ db, clock, audit = getAuditLogger() }: Deps, wu: WorkOSUserLike): Promise<User> {
  const now = new Date(clock.now());
  return db.transaction(async (tx) => {
    const [row] = await tx
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
      .returning({
        id: users.id,
        displayName: users.displayName,
        experienceTier: users.experienceTier,
        avatarUrl: users.avatarUrl,
        createdAt: users.createdAt,
        // The system column set only on the tuple version an INSERT produced — an UPDATE branch
        // of the same `ON CONFLICT` statement returns a row whose `xmax` is the current
        // transaction, never 0. See the doc comment above.
        firstSignIn: sql<boolean>`(xmax = 0)`,
      });
    if (row === undefined) throw new Error("User upsert returned no row.");

    await audit.record(tx, {
      eventType: "session_started",
      actorId: row.id,
      actorType: "user",
      leagueId: null,
      payload: { via: "callback", firstSignIn: row.firstSignIn },
      occurredAt: clock.now(),
    });

    return toUser(row);
  });
}
