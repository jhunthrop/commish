import { z } from "zod";
import { AVATAR_PRESETS, IDENTITY_CONFIG } from "@/identity";

const PRESET_KEYS = AVATAR_PRESETS.map((preset) => preset.key) as [string, ...string[]];

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(IDENTITY_CONFIG.displayName.minLength, "Your name needs at least 2 characters.")
    .max(IDENTITY_CONFIG.displayName.maxLength, "Your name can be at most 40 characters."),
  experienceTier: z.enum(["beginner", "experienced"]),
  /** A preset KEY or null. Never a URL: see `updateProfile`'s docblock. */
  avatarPreset: z.enum(PRESET_KEYS).nullable(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
