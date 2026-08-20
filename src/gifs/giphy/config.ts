/**
 * Every tunable the Giphy adapter has.
 */
export const GIPHY_CONFIG = {
  baseUrl: "https://api.giphy.com/v1/gifs/search",
  /**
   * A REQUEST PARAM sent on every search, never a client-side filter applied after the fact —
   * the same reasoning `CHAT_CONFIG`'s closed reaction set documents. An unrated GIF search in a
   * league chat is a moderation surface this phase has no answer for, so upstream is asked to
   * never offer one in the first place rather than trusting this adapter to filter one out.
   */
  rating: "pg-13",
  envVars: {
    apiKey: "GIPHY_API_KEY",
  },
} as const;
