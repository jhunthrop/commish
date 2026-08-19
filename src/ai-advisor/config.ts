/** Every tunable the advisor has. No prompt, service or route may inline one of these. */
export const ADVISOR_CONFIG = {
  /**
   * How many completed weeks of form the context carries per player. Bounded because an
   * unbounded stat read is both a slow query and a prompt that grows all season — three weeks
   * is what a human analyst actually cites as "recent form".
   */
  trendWeeks: 3,
  /**
   * Ceiling on the model call. Far longer than the draft moderator's 2s: nobody is on a clock
   * here, and an advisor that thinks for a moment is expected. Past this we answer from the
   * deterministic baseline instead of hanging.
   */
  llmTimeoutMs: 8_000,
  /** Enough for a recommendation plus its reasoning, not an essay. */
  maxTokens: 700,
  /** Longest free-text question accepted from a manager. */
  maxQuestionLength: 300,
  /** Most players one side of a trade may name. */
  maxPlayersPerSide: 5,
  /** Points-per-week gap within which a trade is called even. */
  evenDelta: 3,
  /** Points-per-week gap past which a trade is called lopsided rather than merely favouring somebody. */
  lopsidedDelta: 12,
  /**
   * Advisor requests one member may make per window, and the window (ms). Both advisor routes
   * share one budget per user: each request costs a full context assembly plus one model call
   * at `maxTokens`, so without a ceiling an authenticated member is an unbounded spend channel.
   * Sized well above honest use — nobody asks twenty lineup questions in a minute — because
   * this is a blast-radius bound, not a quota anybody should feel.
   *
   * The DURABLE, budget-accounted spend ceiling (distributed, across instances) remains Phase
   * 6's; the in-process limiter this configures is the interim bound.
   */
  maxRequestsPerWindow: 20,
  rateLimitWindowMs: 60_000,
} as const;
