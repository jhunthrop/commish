import { createHash } from "node:crypto";
import { desc, inArray } from "drizzle-orm";
import type { Db, DbTx } from "@research-ts/db/client";
import { sessionSignals } from "@/db/schema";
import { INTEGRITY_CONFIG } from "@/integrity/config";

/**
 * Where an address on a `session_signals` row came from. A UNION, not a schema decision, so the
 * Phase 2 Plan D flip (Fly's proxy overwriting `X-Forwarded-For`) is a value change, never a
 * migration: `CURRENT_IP_SOURCE` below is the one line that plan edits.
 *
 * `xff_unverified`: read straight off the caller-controlled `X-Forwarded-For` header, exactly
 * like every other IP read in this codebase — rotatable, spoofable, and therefore excluded from
 * `INTEGRITY_CONFIG.multiAccount.weights.ip` (pinned at 0) by the heuristic that reads this
 * column. `platform_verified`: written after a trusted proxy owns the header, the only state the
 * weight is ever allowed above 0 for.
 */
export type IpSource = "xff_unverified" | "platform_verified";

/**
 * Always this, today. `session_signals.ip_source` exists so flipping the release gate
 * (`INTEGRITY_CONFIG.multiAccount.weights.ip`) is a filter the heuristic already applies — rows
 * stamped before Fly's proxy owns `X-Forwarded-For` stay `xff_unverified` forever, and only this
 * one constant changes the day that is true.
 */
const CURRENT_IP_SOURCE: IpSource = "xff_unverified";

/** One row of `session_signals`, exactly as it is stored. */
export interface SessionSignal {
  readonly id: string;
  readonly userId: string;
  readonly occurredAt: string;
  readonly userAgent: string | null;
  readonly acceptLanguage: string | null;
  readonly ipHash: string | null;
  readonly ipSource: IpSource;
}

export interface RecordSessionSignalsInput {
  readonly userId: string;
  readonly occurredAt: string;
  /** The `User-Agent` header, or `null` — the caller never observed one. */
  readonly userAgent: string | null;
  /** The `Accept-Language` header, or `null` — the caller never observed one. */
  readonly acceptLanguage: string | null;
  /** The request's address (the first hop of `X-Forwarded-For`), or `null` — the caller never
   *  observed one. A signal not observed is not an error; it is stored as an absent one. */
  readonly clientIp: string | null;
}

/**
 * `SESSION_SIGNAL_SALT`, required and never defaulted. Fails fast the same LAZY way
 * `db/client.ts`'s `requireDatabaseUrl` and `realtime/redis.ts`'s `requireRedisUrl` do: neither
 * of those throws at import time either, only when the resource they guard is actually reached
 * for. Here that is the moment `recordSessionSignals` has an address to hash — a sign-in with no
 * observed `clientIp` needs no salt and gets none demanded of it, "a signal you did not observe
 * is not an error" holding for the salt requirement too. A salt that silently fell back to a
 * constant would be a salt that does nothing, which is why there is no fallback at all.
 */
function requireSessionSignalSalt(): string {
  const salt = process.env.SESSION_SIGNAL_SALT;
  if (salt === undefined || salt.length === 0) {
    throw new Error("SESSION_SIGNAL_SALT is not set. Copy .env.example to .env.local and set a real value.");
  }
  return salt;
}

/**
 * sha256(salt + address), hex. Correlating two sign-ins needs equality between two hashes and
 * nothing more — never the address itself, which is why this is the only function in this module
 * that ever sees one. Pure and salt-parameterized (not reaching for `process.env` itself) so it
 * is trivial to test without an environment to fake.
 */
export function hashClientIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}${ip}`).digest("hex");
}

/** `null`/empty in, `null` out — never an empty string stored where "not observed" is meant. */
function truncate(value: string | null, maxLength: number): string | null {
  if (value === null || value.length === 0) return null;
  return value.slice(0, maxLength);
}

function toSignal(row: typeof sessionSignals.$inferSelect): SessionSignal {
  return {
    id: row.id,
    userId: row.userId,
    occurredAt: row.occurredAt.toISOString(),
    userAgent: row.userAgent,
    acceptLanguage: row.acceptLanguage,
    ipHash: row.ipHash,
    ipSource: row.ipSource as IpSource,
  };
}

/**
 * Records what the server observed about one sign-in. The caller's transaction, not this
 * function's own — `syncUserFromWorkOS` joins this to its user upsert and its `session_started`
 * append so the three either all land or none do (Task 7's own storage test: "goes with the user
 * row and the audit event, or none of them go").
 *
 * LOCK ORDER (ruling 3): this insert carries a foreign key to `users`, so it takes an implicit
 * `FOR KEY SHARE` on that row — the same class of lock `member_notices`' insert takes — and must
 * therefore run BEFORE the caller's chain anchor, never after.
 *
 * Every field but `userId` and `occurredAt` may be absent: a signal the caller did not observe
 * (no `User-Agent`, no `Accept-Language`, no address) is stored as `null`, never treated as a
 * refusal. `userAgent`/`acceptLanguage` are truncated to `INTEGRITY_CONFIG.multiAccount.signals`'
 * caps before storage — both are caller-controlled and otherwise unbounded.
 */
export async function recordSessionSignals(
  tx: DbTx,
  input: RecordSessionSignalsInput,
  deps: { readonly newId: () => string } = { newId: () => crypto.randomUUID() },
): Promise<SessionSignal> {
  const caps = INTEGRITY_CONFIG.multiAccount.signals;
  const ipHash = input.clientIp === null || input.clientIp.length === 0 ? null : hashClientIp(input.clientIp, requireSessionSignalSalt());

  const [row] = await tx
    .insert(sessionSignals)
    .values({
      id: deps.newId(),
      userId: input.userId,
      occurredAt: new Date(input.occurredAt),
      userAgent: truncate(input.userAgent, caps.maxUserAgentLength),
      acceptLanguage: truncate(input.acceptLanguage, caps.maxAcceptLanguageLength),
      ipHash,
      ipSource: CURRENT_IP_SOURCE,
    })
    .returning();
  return toSignal(row!);
}

/**
 * Every signal on record for the given users, most recent first. Empty input answers `[]`
 * without a round trip — the same "derive over a bounded set, never query for nothing" discipline
 * `aboutFor` (`@/integrity-service/flags`) already follows for its own batched lookups.
 *
 * Task 9 is the only caller: it builds each account's `DeviceProfile`/`NetworkProfile` from
 * these rows before handing them to `deviceSimilarity`/`ipCorrelation`.
 */
export async function signalsForUsers(db: Db, userIds: readonly string[]): Promise<readonly SessionSignal[]> {
  if (userIds.length === 0) return [];
  const rows = await signalsForUsersQuery(db, userIds);
  return rows.map(toSignal);
}

/**
 * `signalsForUsers`' statement, as a builder — exported for the same reason `browseQuery`,
 * `pendingFlagQuery` and `chatPageQuery` are: `src/db/index-plans.test.ts` EXPLAINs it, and a
 * plan assertion over a hand-copied lookalike measures the lookalike (final review, HIGH 3 is
 * what that costs). The ORDERING IS GLOBAL, across every requested user at once, which is why
 * `session_signals_user_occurred_idx` is `(user_id)` alone: a per-user `occurred_at` ordering
 * cannot serve a global sort, so the second column was pure write cost
 * (`drizzle/0026_measured_index_shapes.sql` carries the measurement).
 */
export function signalsForUsersQuery(db: Db, userIds: readonly string[]) {
  return db.select().from(sessionSignals).where(inArray(sessionSignals.userId, userIds)).orderBy(desc(sessionSignals.occurredAt));
}
