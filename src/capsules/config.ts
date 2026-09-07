/**
 * EVERY CAPSULE TUNABLE, in one place — the config-over-hardcoding rule this product keeps
 * everywhere else (`TANK01_CONFIG`, `DRAFT_ADVANCE_CONFIG`, ...). Spec: `docs/superpowers/specs/
 * 2026-09-04-draft-hq-design.md` §9's AMENDED paragraph, plus five founder live-fire corrections
 * the same night (register vocabulary, empty-completion handling, "implying"/"implied" for a
 * market-anchor number, and the two-size "Read" upgrade — see `write.ts`/`validate.ts`/
 * `render.ts` for where each one lands).
 */
export const CAPSULE_MODEL = "zai/glm-5.3-flash";

export const CAPSULE_CONFIG = {
  /** Vercel AI Gateway, OpenAI-compatible. Never printed, never committed — the key lives at
   *  `envVars.apiKey` and is read once, at call time, by `write.ts`. */
  gateway: {
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    envVars: { apiKey: "AI_GATEWAY_API_KEY" },
    timeoutMs: 20_000,
    /**
     * TWO SEPARATE RETRY BUDGETS (sweep resilience, color v2, Task 4, 2026-09-05: the live
     * gateway kept returning 429 even at fifteen-second sweep pacing) — a 429 gets its OWN,
     * longer exponential backoff; every other transport failure (5xx, a network error, an
     * unparseable body, an empty completion) keeps the original one-retry budget, since those are
     * ordinary transient weather rather than a known, structured throttle.
     *
     * `maxAttempts`/`baseDelayMs` govern the non-429 track exactly as before (one retry, linear
     * backoff). `rateLimitBackoffMs` is 429-ONLY: three retries (four attempts total), the delay
     * doubling each time starting at twenty seconds, so a genuinely saturated minute on the
     * gateway's own side has real room to clear before this player's write gives up and the
     * sweep's template floor takes over for this run.
     */
    retry: { maxAttempts: 2, baseDelayMs: 1_500, rateLimitBackoffMs: [20_000, 40_000, 80_000] },
  },
  /** The two sizes a capsule ships in — same facts, same writer/validator machinery, two prompts
   *  and two length bands (founder, live-fire review: "a competitor's player readout set the
   *  quality bar"). `compact` is the peek's own capsule; `full` ("The Read") is the player page's. */
  sizes: {
    compact: {
      minWords: 60,
      maxWords: 110,
      /** `glm-5.3-flash` is a REASONING model: it spends completion tokens thinking before
       *  prose, observed 18-90 reasoning tokens on a 40-word capsule in a live probe. A tight
       *  cap returns EMPTY content while still billing — `write.ts` treats that as a generation
       *  failure, never as a blank capsule — so this is sized generously above the word band. */
      maxTokens: 500,
    },
    full: {
      minWords: 180,
      maxWords: 280,
      // 1600, not 900 (live-fire 2026-09-05): glm-5.3-flash is a reasoning model, and the
      // longer Read prompt can spend most of a tight cap thinking, returning a near-empty
      // completion that reads as a validation failure instead of the truncation it is.
      maxTokens: 1600,
    },
  },
  /**
   * THE NARRATIVE CALL (founder amendment 2026-09-07) — one call per player for the whole object
   * of slots. Sized generously above the prose it returns for the same reason the two reads are:
   * `glm-5.3-flash` spends completion tokens thinking, and a tight cap returns an empty body while
   * still billing. A dozen slots of at most forty words is roughly 400 words of JSON.
   */
  narrative: {
    maxTokens: 2000,
  },
  /**
   * A SENTENCE ON MORE THAN THIS SHARE OF THE BOARD IS STOCK, not voice (founder amendment
   * 2026-09-07: "alive, not stock"). Two percent of a 659 player board is thirteen players saying
   * the same thing, which is the point at which a reader who opens two pages sees the seam. The
   * sweep flags every sentence over it, queues those players for regeneration, and quotes the
   * sentence into the next run's prompt as one not to write again.
   */
  repetition: {
    maxShare: 0.02,
    /** How many flagged sentences the prompt quotes. A prompt that lists fifty sentences not to
     *  write is a prompt about sentences not to write; the worst offenders carry the signal. */
    maxQuotedSentences: 8,
  },
  /** A law group's own `|netEffectPoints|` at or above this reads as a real, citable downside —
   *  below it is noise a capsule need not dwell on. The mandated-tension check (`validate.ts`)
   *  requires the STRONGEST such group's own number be cited before the call, on every capsule
   *  whose facts carry one — a one-sided rave on genuinely mixed evidence is a validation
   *  failure, not a style choice. */
  tensionThresholdPoints: 0.5,
  /** Per-sweep-run cap on fresh generations (two gateway calls each) — the spreading mechanism
   *  that lets a full board's first run clear the free-tier throttle across several nightly
   *  sweeps rather than exhausting it in one run. Generous, per the base-product ruling (spec
   *  §15.1): no paywall gates capsule coverage, only pacing against the gateway. */
  // 35 A NIGHT, ACROSS AS MANY TICKS AS IT TAKES (dossier-voice round §3.2, corrected by the
  // review's C1). The number that binds is NOT the sweep job's own 480s `timeoutMs`: the runner
  // caps a claimed attempt at whatever is left of the TICK budget
  // (`JOBS_CONFIG.vercelTickBudgetMsDefault`, 50 seconds), so no single attempt was ever going to
  // write 35 players at 5s pacing plus 7-20s of generation each. The sweep stops before the
  // deadline it is handed and enqueues a continuation carrying the rest of this number, so 35 is
  // the per-NIGHT ceiling rather than a per-attempt promise, and a tick writes the two or three
  // players it has room for.
  //
  // THE COST, STATED: about $0.0022 a player for the two reads (the measured rate behind the
  // spec's "roughly a dollar" for 460 players) and about a third again for the narrative call, so
  // roughly $0.0033 a player and about 12 cents a night at this batch, under $4 a month. The
  // one-time backlog regeneration the spec calls for is a separate, larger spend the coordinator
  // runs deliberately; this constant only has to keep the board from drifting back.
  sweepGenerationBudget: 35,
  /** Pause between players inside one sweep. The gateway rate-limits per minute, and the first
   *  live sweep proved a burst (two calls per player, back to back) throttles everything after
   *  the first player into the template floor (2026-09-05). Fifteen seconds a player was the
   *  first fix and still was not enough against a live gateway that kept 429-ing anyway (color v2,
   *  Task 4, same night): raised to forty-five seconds, paired with the 429-only backoff above, so
   *  a real per-minute cap has room to reset between players as well as between one player's own
   *  retries. */
  // Back to 15s (2026-09-05): prepaid credits lifted the free-tier throttle, and the 429
  // backoff track handles the rare residual limit. 45s was the throttled-era setting.
  //
  // 5s (dossier-voice round): the raised batch above has to fit the same job timeout, and pacing
  // is the half of that budget that buys nothing once the throttle is gone. The 429 track (three
  // backoff retries doubling from twenty seconds) is what actually handles a live rate limit, and
  // it is untouched — if a night starts throttling again, that track absorbs it and the sweep's
  // own carryover finishes the board on the next run.
  sweepPacingMs: 5_000,
} as const;

/**
 * WORDS A CAPSULE MAY NEVER USE. Two families, both from founder live-fire review of real
 * gateway output:
 *
 * - LAB-REPORT REGISTER ("p10 to p90 range", "evidence projection", "measured young-age edge")
 *   leaking straight from this engine's own internal fact vocabulary into fan-facing prose —
 *   `render.ts` exists specifically so the model never sees these words in the first place, and
 *   this list is the mechanical backstop for the rare paraphrase that reintroduces one anyway.
 * - "implying"/"implied" for a market-anchor number specifically: `marketPoints` is the FITTED
 *   REALIZATION curve — what players taken at that draft slot HISTORICALLY RETURNED, busts and
 *   injuries pooled (`src/projections/market/curve.ts`) — never what drafters expect, so a
 *   capsule may never phrase it as an implication.
 * - ALL-TIME SUPERLATIVES ("ever", "all-time", "in NFL history", "greatest of all time", "GOAT"):
 *   this engine holds no all-time historical-context tables, so no output may claim one —
 *   deferred, not faked (spec's own honesty rule, §12).
 *
 * Checked case-insensitively, whole-word (or whole-phrase) in `validate.ts`.
 */
export const BANNED_VOCABULARY: readonly string[] = [
  "p10",
  "p90",
  "percentile",
  "projection",
  "evidence",
  "measured",
  "effect size",
  "coefficient",
  "standard deviation",
  "implying",
  "implied",
  "ever",
  "all-time",
  "all time",
  "in nfl history",
  "greatest of all time",
  "goat",
];

/** Rival fantasy products — a capsule voices this product's own case, never a comparison to
 *  where else a manager could be reading it. Checked case-insensitively, substring. */
export const COMPETITOR_NAMES: readonly string[] = [
  "espn",
  "yahoo",
  "sleeper",
  "cbs sports",
  "nfl.com",
  "ffpc",
  "underdog",
  "draftkings",
  "fanduel",
  "apex fantasy",
  "rtsports",
];

export const EM_DASH = "—";
/** Founder law, 2026-09-05, extending the em-dash rule: a semicolon never appears in analysis
 *  prose. People do not talk in semicolons. Two sentences beat one stitched one. */
export const SEMICOLON = ";";
