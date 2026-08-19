import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import type { ExperienceTier } from "@/domain/user";
import { avatarRefValue, parseAvatarRef, presetByKey, type AvatarPresetKey } from "@/identity";
import type { ProfileBody } from "@/account-room/contract";

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
  readonly displayName: string;
  readonly experienceTier: ExperienceTier;
  readonly avatarPreset: AvatarPresetKey | null;
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
 */
export async function updateProfile(db: Db, input: UpdateProfileParams): Promise<ProfileBody> {
  if (input.avatarPreset !== null && presetByKey(input.avatarPreset) === undefined) {
    throw new Error(`Unknown avatar preset: ${input.avatarPreset}`);
  }
  const [row] = await db
    .update(users)
    .set({
      displayName: input.displayName,
      experienceTier: input.experienceTier,
      avatarUrl: input.avatarPreset === null ? undefined : avatarRefValue(input.avatarPreset),
    })
    .where(eq(users.id, input.userId))
    .returning();
  if (row === undefined) throw new Error(`No user row for id ${input.userId}.`);
  return toProfileBody(row);
}
