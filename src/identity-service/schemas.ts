import { z } from "zod";
import { AVATAR_PRESETS, IDENTITY_CONFIG, isPrintableDisplayName } from "@/identity";

const PRESET_KEYS = AVATAR_PRESETS.map((preset) => preset.key) as [string, ...string[]];

/**
 * SPARSE: every field optional, at least one required. A profile PATCH says what CHANGED, not
 * what the form happened to be holding — a tab left open before someone renamed themselves in
 * another tab used to resurrect the old `displayName` and `experienceTier` on its next Save,
 * because `updateProfile` is a blind `UPDATE ... SET` with no version guard. Omitting a field is
 * how a caller declines to touch it, and `ProfileForm` sends only its dirty fields.
 *
 * The `refine` is what keeps "sparse" from meaning "empty": a PATCH that asks for nothing is a
 * 400 naming the fields, not a silent success.
 */
export const updateProfileSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(IDENTITY_CONFIG.displayName.minLength, "Your name needs at least 2 characters.")
      .max(IDENTITY_CONFIG.displayName.maxLength, "Your name can be at most 40 characters.")
      // Length was the only rule, and a display name renders under `authorName` on the
      // unauthenticated `/reviews` page — see `isPrintableDisplayName`'s own docblock for what
      // this does and does not defend against.
      .refine(isPrintableDisplayName, "Your name can only use characters people can see.")
      .optional(),
    experienceTier: z.enum(["beginner", "experienced"]).optional(),
    /** A preset KEY or null. Never a URL: see `updateProfile`'s docblock. */
    avatarPreset: z.enum(PRESET_KEYS).nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Send at least one of displayName, experienceTier or avatarPreset.",
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Both fields optional: a caller sends whichever one it's changing (the draft-room tour sends
 * only `dismissDraftTour`; a future help-level control would send only `helpLevel`), and
 * `updatePreferences` leaves the other column alone.
 */
export const updatePreferencesSchema = z.object({
  helpLevel: z.enum(["guided", "standard"]).optional(),
  dismissDraftTour: z.boolean().optional(),
});

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
