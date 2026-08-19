import { getDb } from "@/db/client";
import type { AvatarPresetKey } from "@/identity";
import { updateProfile, type UpdateProfileParams } from "@/identity-service/profile";
import { updateProfileSchema } from "@/identity-service/schemas";
import { ok, parseJson } from "@/lib/api/respond";
import type { ProfileBody } from "@/account-room/contract";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import { profileRateLimited } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The first write path this product has to who a signed-in user is. Rate-limited per user
 * (`profileRateLimited`) because it is authenticated, the same reasoning `advisorRateLimited`
 * uses — the user themselves is the right blast-radius unit, not their IP.
 */
export async function PATCH(request: Request) {
  return withCurrentUser(request, async (userId, req) => {
    const limited = profileRateLimited(userId);
    if (limited !== null) return limited;

    const parsed = await parseJson(req, updateProfileSchema);
    if (!parsed.ok) return parsed.response;

    const params: UpdateProfileParams = {
      userId,
      displayName: parsed.value.displayName,
      experienceTier: parsed.value.experienceTier,
      // `updateProfileSchema` validates this against the very keys `AvatarPresetKey` admits
      // (`PRESET_KEYS`, `@/identity-service/schemas`), but its Zod-inferred type widens to plain
      // `string` — see `UpdateProfileParams`'s own docblock in `@/identity-service/profile` for
      // why that widening exists and why this narrowing cast is the one place it gets undone.
      avatarPreset: parsed.value.avatarPreset as AvatarPresetKey | null,
    };
    const profile = await updateProfile(getDb(), params);
    return ok<ProfileBody>(profile);
  });
}
