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
    /** One retry on a 429 or 5xx, matching the free-tier throttle note in the spec's own
     *  AMENDED paragraph — a 429'd capsule stays on its template until the next sweep rather
     *  than spinning here. */
    retry: { maxAttempts: 2, baseDelayMs: 1_500 },
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
      maxTokens: 900,
    },
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
  sweepGenerationBudget: 40,
  /** Pause between players inside one sweep. The gateway rate-limits per minute, and the first
   *  live sweep proved a burst (two calls per player, back to back) throttles everything after
   *  the first player into the template floor (2026-09-05). A nightly job has no latency budget
   *  to protect; fifteen seconds a player clears any per-minute cap with room. */
  sweepPacingMs: 15_000,
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
