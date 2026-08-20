/** Tunables for identity. Nothing in `src/identity/**` may inline one of these. */
export const IDENTITY_CONFIG = {
  displayName: { minLength: 2, maxLength: 40 },
  avatar: {
    /** The stored-value prefix that marks a built-in preset. */
    presetPrefix: "preset:",
    /**
     * Custom avatar UPLOAD needs an object store, which is Plan D's table (phase overview:
     * "Step 15's custom avatar upload needs an object store"). The ref scheme is what makes
     * turning it on a new `AvatarRef` case and a new writer, not a schema change: an uploaded
     * avatar is stored as its https URL, which `parseAvatarRef` already renders today.
     */
    uploads: false,
    /** The only URL scheme ever rendered into an `<img src>`. See `parseAvatarRef`. */
    allowedUrlPrefix: "https://",
  },
  /** `PATCH /api/profile`'s ceiling — keyed per user id, see `profileRateLimited`. */
  profileRateLimit: { maxRequests: 10, windowMs: 60_000 },
  /**
   * `PATCH /api/preferences`'s ceiling — keyed per user id, sibling parity with the profile
   * write above. Both are authenticated per-user writes and this one opens a three-statement
   * transaction per call, so it is the LESS defensible of the two to leave unlimited. Roomier
   * than the profile's, because the draft-room tour's fire-and-forget dismissal shares this
   * route with the help-level control and a manager should never hit a ceiling by playing.
   */
  preferencesRateLimit: { maxRequests: 30, windowMs: 60_000 },
} as const;

/**
 * The one copy vocabulary for `experienceTier`, shared by every surface that shows it:
 * `PublicLeagueList` (a stranger sizing up an open league) and `ProfileForm` (the same manager
 * choosing their own). Copy, not enum values — `"New to fantasy"` / `"Played before"` say more
 * than `"beginner"` / `"experienced"` would, and a single map is what stops the two surfaces
 * from ever describing the same tier differently.
 */
export const EXPERIENCE_TIER_LABEL: Readonly<Record<string, string>> = {
  beginner: "New to fantasy",
  experienced: "Played before",
};

/**
 * The one copy vocabulary for `helpLevel`, the same way `EXPERIENCE_TIER_LABEL` is for the tier.
 * Plain words for what the setting does, not the stored enum: nobody picks "guided" off a menu,
 * they pick more help or fewer words.
 */
export const HELP_LEVEL_LABEL: Readonly<Record<string, string>> = {
  guided: "More help",
  standard: "The basics",
};
