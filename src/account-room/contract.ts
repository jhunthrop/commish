import type { AvatarPresetKey } from "@/identity";
import type { ExperienceTier } from "@/domain/user";

/**
 * TYPES ONLY, no runtime code — mirrors `@/league-room/contract`'s own note. Imported by
 * `/api/profile` as its return shape and by `src/account-room/**` as its prop shape, so the
 * two cannot drift.
 */
export interface ProfileBody {
  readonly displayName: string;
  readonly experienceTier: ExperienceTier;
  /** The preset the user chose, or `null` if they never have — never a URL. */
  readonly avatarPreset: AvatarPresetKey | null;
  /** The STORED avatar ref (`users.avatar_url`): `Avatar`'s `avatar` prop takes this directly. */
  readonly avatar: string | null;
}
