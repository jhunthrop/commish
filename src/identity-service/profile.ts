import { eq } from "drizzle-orm";
import type { Db, DbTx } from "@research/db/client";
import { users } from "@/db/schema";
import type { Clock } from "@research/domain/timing";
import type { ExperienceTier } from "@/domain/user";
import { avatarRefValue, parseAvatarRef, presetByKey, type AvatarPresetKey } from "@/identity";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import type { ProfileBody } from "@/account-room/contract";
import { applyTierDefaultHelpLevel } from "./preferences";

const systemClock: Clock = { now: () => new Date().toISOString() };

/**
 * What `updateProfile` actually accepts. Deliberately NOT `UpdateProfileInput`
 * (`./schemas.ts`) — that type is `z.infer<typeof updateProfileSchema>`, and `avatarPreset`
 * there widens to plain `string` because the schema builds its enum from a runtime array
 * (`PRESET_KEYS`) that has to be cast to a tuple for `z.enum` to accept it. This type is the
 * one that carries the guarantee: `avatarPreset: AvatarPresetKey | null` admits no other
 * string, so a request body validated by the schema still needs a narrowing step before it can
 * reach this function — there is no path from raw JSON straight into a write.
 */
export interface UpdateProfileParams {
  readonly userId: string;
  /** Omit to leave the stored name alone — see `updateProfile`'s SPARSE note. */
  readonly displayName?: string;
  /** Omit to leave the stored tier alone. */
  readonly experienceTier?: ExperienceTier;
  /** A preset key to choose one; `null` or omitted both leave `avatar_url` alone. */
  readonly avatarPreset?: AvatarPresetKey | null;
}

type ProfileRow = Pick<typeof users.$inferSelect, "displayName" | "experienceTier" | "avatarUrl">;

/**
 * The one place a `users` row becomes a `ProfileBody`. `avatarPreset` is derived, not stored: it
 * is whatever `parseAvatarRef` says `avatarUrl` currently resolves to, so a preset that gets
 * retired in a later release (`parseAvatarRef`'s own "falls back to initials" case) reports as
 * "no preset chosen" here too, rather than a preset key nothing can look up.
 */
function toProfileBody(row: ProfileRow): ProfileBody {
  const ref = parseAvatarRef(row.avatarUrl);
  return {
    displayName: row.displayName,
    experienceTier: row.experienceTier,
    avatarPreset: ref.kind === "preset" ? ref.preset.key : null,
    avatar: row.avatarUrl,
  };
}

/** The signed-in caller's own profile, or `null` if their `users` row somehow does not exist. */
export async function readProfile(db: Db, userId: string): Promise<ProfileBody | null> {
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  return row === undefined ? null : toProfileBody(row);
}

/**
 * The first write path this product has ever had to a user's own profile row.
 * `user-sync.ts`'s `syncUserFromWorkOS` has claimed since Phase 1 that `displayName`,
 * `experienceTier` and `avatarUrl` are "never clobbered by a later sync" because the user may
 * have edited them in-app; this is that edit, and `profile.test.ts` is what turns the claim
 * into an assertion.
 *
 * `avatarPreset` takes a PRESET KEY (`UpdateProfileParams`'s own docblock), never a URL, so
 * there is no code path from a request body to an `<img src>` at all — a stronger guarantee
 * than validating one would be. `null` means "leave the column alone": Drizzle's `.set()` drops
 * an `undefined`-valued key from the SQL entirely (`mapUpdateSet`, `drizzle-orm/utils`), so
 * declining a preset preserves whatever WorkOS-supplied picture is already in `avatarUrl`
 * rather than deleting a face nobody asked to remove.
 *
 * The `presetByKey` check below is a runtime backstop, not the guarantee itself — the real one
 * is `UpdateProfileParams`'s type, which admits no string but a real preset key. This only
 * matters for a caller that defeats the type system on purpose (a `@ts-expect-error`, or plain
 * JS), the same case `profile.test.ts`'s "never lets a profile write set an arbitrary avatar
 * value" case exercises: it fails loudly rather than silently writing whatever slipped through.
 *
 * SPARSE: this writes only the fields the caller actually sent. There is no version column and
 * no `updated_at` precondition on `users`, so a full-row write from a tab that loaded before
 * somebody else's change resurrects every field it is holding — the resurrection vector
 * `syncUserFromWorkOS` was wrongly suspected of. Sending only what changed removes the vector
 * for every pair of writers except two tabs editing the SAME field, where last write wins is
 * the honest answer anyway. A PATCH that names no writable field at all changes nothing and
 * reads the row back (`updateProfileSchema`'s `refine` already refuses the empty body at the
 * boundary; this is what keeps the service itself from handing Drizzle an empty `SET`).
 *
 * A TIER CHANGE ALSO RE-DERIVES `helpLevel`, in the same transaction
 * (`applyTierDefaultHelpLevel`, whose docblock carries the reasoning). The tier is the coarse
 * help control and the profile's explicit "How much help" is the fine one; both are on the same
 * page and last write wins.
 *
 * `deps.audit` records `profile_updated` on the PLATFORM chain — payload is the FIELD NAMES
 * that changed (`UpdateProfileParams`'s own keys: `"displayName"`, `"experienceTier"`,
 * `"avatarPreset"`), never their values. A display name is Plan C-sensitive, PII-adjacent
 * content that an audit row has no business holding; the fact that it changed is what this
 * product's trust surface needs, not what it changed to. Every write here — the sparse no-op
 * above and the two shapes below — now runs inside ONE transaction, so the audit event commits
 * with the row it describes or not at all (ruling 4); the previous plain-`db.update` path for a
 * non-tier change is folded into the same transaction rather than kept as a second, un-audited
 * shape.
 */
export async function updateProfile(
  db: Db,
  input: UpdateProfileParams,
  clock: Clock = systemClock,
  { audit = getAuditLogger() }: { readonly audit?: AuditLogger } = {},
): Promise<ProfileBody> {
  if (input.avatarPreset !== null && input.avatarPreset !== undefined && presetByKey(input.avatarPreset) === undefined) {
    throw new Error(`Unknown avatar preset: ${input.avatarPreset}`);
  }
  const changes = {
    displayName: input.displayName,
    experienceTier: input.experienceTier,
    avatarUrl: input.avatarPreset === null || input.avatarPreset === undefined ? undefined : avatarRefValue(input.avatarPreset),
  };
  if (Object.values(changes).every((value) => value === undefined)) {
    const profile = await readProfile(db, input.userId);
    if (profile === null) throw new Error(`No user row for id ${input.userId}.`);
    return profile;
  }

  // The canonical field-name order, filtered to what THIS caller actually sent — never the
  // storage-column names `changes` uses (`avatarUrl` there is `avatarPreset` here).
  const fields = (
    [
      input.displayName !== undefined ? "displayName" : null,
      input.experienceTier !== undefined ? "experienceTier" : null,
      input.avatarPreset !== undefined ? "avatarPreset" : null,
    ] as const
  ).filter((field): field is "displayName" | "experienceTier" | "avatarPreset" => field !== null);

  const tier = input.experienceTier;
  // Evaluated BEFORE the transaction opens — no clock read, and no other work, inside it.
  const now = new Date(clock.now());

  return db.transaction(async (tx) => {
    const profile = await writeUserRow(tx, input.userId, changes);
    if (tier !== undefined) await applyTierDefaultHelpLevel(tx, input.userId, tier, now);
    await audit.record(tx, {
      eventType: "profile_updated",
      actorId: input.userId,
      actorType: "user",
      leagueId: null,
      payload: { fields },
      occurredAt: clock.now(),
    });
    return profile;
  });
}

/** The `users` write itself, shared by the plain path and the tier-change transaction. */
async function writeUserRow(db: Db | DbTx, userId: string, changes: Partial<ProfileRow>): Promise<ProfileBody> {
  const [row] = await db.update(users).set(changes).where(eq(users.id, userId)).returning();
  if (row === undefined) throw new Error(`No user row for id ${userId}.`);
  return toProfileBody(row);
}
