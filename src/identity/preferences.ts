import type { ExperienceTier } from "@/domain/user";

/**
 * "guided" shows the extra explanation (glossary hints, the draft-room tour, Task 5's advisor
 * fork copy); "standard" doesn't. Two levels, not a slider: every surface that reads this asks
 * one yes/no question ("show the help?"), and a slider would only add states nothing consumes.
 */
export type HelpLevel = "guided" | "standard";

/**
 * The two preferences this product actually reads, per user. Nothing else belongs here — see
 * `@research/db/schema`'s `userPreferences` docblock for why the notification channel is not a third
 * field.
 */
export interface PreferenceState {
  readonly helpLevel: HelpLevel;
  /** ISO timestamp, or null if the draft-room tour has never been dismissed. */
  readonly draftTourDismissedAt: string | null;
}

/**
 * The column default (`guided`, `@research/db/schema`) is a floor, not the answer: the row is seeded
 * from what the user told us about themselves at sign-up (`experienceTier`), so guidance is on
 * for the person who needs it without them finding a setting first, and off for the person who
 * would find it patronizing.
 */
export function defaultPreferences(user: { readonly experienceTier: ExperienceTier }): PreferenceState {
  return {
    helpLevel: user.experienceTier === "beginner" ? "guided" : "standard",
    draftTourDismissedAt: null,
  };
}

export function isDraftTourDismissed(prefs: PreferenceState): boolean {
  return prefs.draftTourDismissedAt !== null;
}
