/** Tunables for identity. Nothing in `src/identity/**` may inline one of these. */
export const IDENTITY_CONFIG = {
  displayName: { minLength: 2, maxLength: 40 },
  avatar: {
    /** The stored-value prefix that marks a built-in preset. */
    presetPrefix: "preset:",
    /**
     * Custom avatar UPLOAD needs an object store, which is Phase 2 Plan D's table (phase
     * overview: "Step 15's custom avatar upload needs an object store"; spelled out in full
     * because "Plan D" alone is ambiguous across two phases). The ref scheme is what makes
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
 * `OpenLeagueShelf`'s row and card forms (a stranger sizing up an open league) and `ProfileForm` (the same manager
 * choosing their own). Copy, not enum values — `"New to fantasy"` / `"Played before"` say more
 * than `"beginner"` / `"experienced"` would, and a single map is what stops the two surfaces
 * from ever describing the same tier differently.
 */
export const EXPERIENCE_TIER_LABEL: Readonly<Record<string, string>> = {
  beginner: "New to fantasy",
  experienced: "Played before",
};

/**
 * The SAME `experienceTier` values, said about a LEAGUE rather than about a person — the words a
 * commissioner reads while choosing who their league is for (`CreateLeagueForm`,
 * `@/league-room/components/create-league-form`).
 *
 * A SECOND map and not a second spelling of the first, because the subject genuinely differs.
 * `EXPERIENCE_TIER_LABEL` above answers "how much fantasy football has this PERSON played", which
 * is why a profile select reads "Played before". A league is not experienced; a league is OPEN to
 * people or RESERVED for some of them, and that is the decision the creation gate enforces
 * (`tierJoinPrecondition`, `@/league-service/enforcement`). Telling a commissioner their league is
 * "Played before" would describe nobody.
 *
 * THE ORDER MATTERS AND IS FIXED BY THE GATE. `experienced` is the choice that refuses nobody, so
 * it leads the control and is its default: a veteran picking the default creates a league
 * successfully, and only a deliberate choice of `beginner` can reach
 * `ENFORCEMENT_REFUSALS.create`. Before this control existed that refusal named a remedy the form
 * had no way to carry out.
 *
 * PHASE 3.5, TASK 9. The control this map feeds shipped correct but findable only by a
 * commissioner who opened a nested "Advanced settings" disclosure that never named it in its own
 * summary — the re-review's own words, "sound but collapsed". `CreateLeagueForm` now renders it
 * (beside `VISIBILITIES`' own "Who can join", which decides first) directly under the league
 * name, no disclosure in the way. This map's words and order are unchanged; only where the form
 * puts them moved.
 */
export const LEAGUE_EXPERIENCE_TIER_LABEL: Readonly<Record<string, string>> = {
  experienced: "Open to everyone",
  beginner: "Reserved for players newer to Commish",
};

/** The sentence under that control, saying what the reserved choice actually does. Named here
 *  beside its own labels for the reason every other copy constant in this file is: one place
 *  decides the words, and the copy sweeps read that place. */
export const LEAGUE_EXPERIENCE_TIER_HINT = "A reserved league only accepts managers who are newer to Commish. Open leagues accept everyone.";

/**
 * The one copy vocabulary for `helpLevel`, the same way `EXPERIENCE_TIER_LABEL` is for the tier.
 * Plain words for what the setting does, not the stored enum: nobody picks "guided" off a menu,
 * they pick more help or fewer words.
 */
export const HELP_LEVEL_LABEL: Readonly<Record<string, string>> = {
  guided: "More help",
  standard: "The basics",
};
