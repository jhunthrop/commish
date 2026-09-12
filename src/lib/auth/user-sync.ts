import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import type { User } from "@/domain/user";
import { stripHiddenCharacters } from "@/identity/display-name";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { recordSessionSignals } from "@/integrity-service/session-signals";

/** The subset of the WorkOS User object this module needs — kept narrow so it's easy to fake in tests. */
export interface WorkOSUserLike {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly profilePictureUrl?: string | null;
}

/**
 * Which door this sync came through, recorded on the `session_started` event.
 *
 * A PARAMETER, not a literal, and that is the whole point. It used to be the hardcoded string
 * `"callback"`, which is true of one of the two callers and false of the other: `getCurrentUser`
 * calls this as a lazy backfill for a session whose local row is missing, which is not the
 * AuthKit callback and does not happen at sign-in time. A field that is constant carries no
 * information; a field that is constant AND wrong on one path is worse than an absent one,
 * because the record is append-only and nothing may ever repair it.
 */
export type SessionEntry = "callback" | "session_backfill";

/**
 * What `/callback` observed about this request's `User-Agent`, `Accept-Language` and address —
 * Task 7's device/IP signals (ruling 9: no client beacon, server-observed only). Every field is
 * independently nullable: a header the caller never saw is a signal not observed, not an error.
 */
export interface SessionSignalHeaders {
  readonly userAgent: string | null;
  readonly acceptLanguage: string | null;
  readonly clientIp: string | null;
}

/** Every field absent — the `session_backfill` caller (`getCurrentUser`) has no request headers
 *  to offer, and a test that omits `signals` entirely means exactly the same thing. */
const NO_SIGNALS: SessionSignalHeaders = { userAgent: null, acceptLanguage: null, clientIp: null };

interface Deps {
  readonly db: Db;
  readonly clock: Clock;
  /** Which caller this is. See `SessionEntry`. */
  readonly via: SessionEntry;
  /** Defaults to the process-wide logger (`getAuditLogger()`), the same way every other writer here defaults its collaborators. */
  readonly audit?: AuditLogger;
  /**
   * Passed through from the door this sync came in, rather than read here via `next/headers` —
   * this file has no business knowing it is inside a request (Task 7's own brief says so in
   * those words). Defaults to `NO_SIGNALS`: `getCurrentUser`'s lazy backfill call has none to
   * give, and "a signal you did not observe is not an error" holds here exactly as it does
   * inside `recordSessionSignals` itself.
   */
  readonly signals?: SessionSignalHeaders;
}

/**
 * The name a new account starts with, taken from the identity provider.
 *
 * STRIPPED, not refused. Every other door a display name comes through is a person typing into a
 * form, where `isPrintableDisplayName` refuses and the person fixes it. This one is a sign-in: the
 * value arrives from WorkOS with the session, the person may not know a zero-width joiner is in
 * their provider profile at all, and refusing here would refuse them the product. Removing an
 * invisible character changes nothing they could see. See `stripHiddenCharacters`' own docblock.
 */
export function displayNameFrom(u: Pick<WorkOSUserLike, "firstName" | "lastName" | "email">): string {
  const parts = [u.firstName, u.lastName].filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  if (parts.length > 0) return stripHiddenCharacters(parts.join(" "));
  return stripHiddenCharacters(u.email.split("@")[0] ?? u.email);
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
 * The AUDIT EVENT carries NO IP and NO device signal (ruling 20 / ruling 7). All four pre-Plan-B
 * IP reads in this codebase key on `X-Forwarded-For`, which their own docblocks call caller-
 * controlled and rotatable — a multi-account flag built on a forgeable header lets an attacker
 * manufacture suspicion against someone else's account, which is worse than the bypassed rate
 * limiter it would be defending against. Task 7 adds the real device/IP signals Plan B needs, but
 * they land in `session_signals` (a mutable, cascading table `recordSessionSignals` writes
 * below), never in this append-only, foreign-key-free payload.
 *
 * `recordSessionSignals` joins the SAME transaction, BEFORE the anchor (lock order, ruling 3 —
 * its insert carries an implicit `FOR KEY SHARE` on `users` through its foreign key, exactly like
 * `member_notices`' insert). It runs on every call, `session_backfill` included: `signals`
 * defaults to `NO_SIGNALS` when the caller has none to give, which stores an all-null row rather
 * than skipping the write — "a signal you did not observe is not an error" applies here too.
 */
export async function syncUserFromWorkOS(
  { db, clock, via, audit = getAuditLogger(), signals = NO_SIGNALS }: Deps,
  wu: WorkOSUserLike,
): Promise<User> {
  const now = new Date(clock.now());
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({
        id: wu.id,
        email: wu.email.toLowerCase(),
        displayName: displayNameFrom(wu),
        // NOT `wu.profilePictureUrl` (fix round 2). WorkOS answers a GENERATED PLACEHOLDER for
        // every account that never uploaded a photo, so storing it dressed a stock image as a
        // face the manager had chosen — on every surface at once, and with no way to get rid of
        // it short of picking a preset. A manager's face is theirs to choose in the account room
        // (presets today, uploads when Plan D flips `IDENTITY_CONFIG.avatar.uploads`), and until
        // they do, their initials are a real and correct face. `parseAvatarRef` covers the rows
        // already written this way.
        avatarUrl: null,
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

    await recordSessionSignals(tx, {
      userId: row.id,
      occurredAt: clock.now(),
      userAgent: signals.userAgent,
      acceptLanguage: signals.acceptLanguage,
      clientIp: signals.clientIp,
    });

    await audit.record(tx, {
      eventType: "session_started",
      actorId: row.id,
      actorType: "user",
      leagueId: null,
      payload: { via, firstSignIn: row.firstSignIn },
      occurredAt: clock.now(),
    });

    return toUser(row);
  });
}
