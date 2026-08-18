/** Every tunable the league room's client components need. No component may inline one of these. */
export const LEAGUE_ROOM_CONFIG = {
  /** How long the matchup-win / clinch highlight stays up, ms — mirrors `DRAFT_ROOM_CONFIG.celebrationMs`. */
  celebrationMs: 3_200,
} as const;
