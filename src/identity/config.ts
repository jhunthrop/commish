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
} as const;
