/**
 * EVERY CAPSULE TUNABLE, in one place — the config-over-hardcoding rule this product keeps
 * everywhere else (`TANK01_CONFIG`, `DRAFT_ADVANCE_CONFIG`, ...). Spec: `docs/superpowers/specs/
 * 2026-09-04-draft-hq-design.md` §9's AMENDED paragraph, plus five founder live-fire corrections
 * the same night (register vocabulary, empty-completion handling, "implying"/"implied" for a
 * market-anchor number, and the two-size "Read" upgrade — see `write.ts`/`validate.ts`/
 * `render.ts` for where each one lands).
 */
export const CAPSULE_MODEL = "zai/glm-5.3-flash";

/** The gateway's measured ceiling, in calls a minute — see `CAPSULE_CONFIG.gateway.callsPerMinute`
 *  for the measurement. Stated above the config object because the pacing below is derived from it
 *  and a constant cannot read its own object while it is being built. */
const GATEWAY_CALLS_PER_MINUTE = 12;

/** The gap between any two gateway calls that holds the ceiling above. */
const MIN_CALL_SPACING_MS = Math.round(60_000 / GATEWAY_CALLS_PER_MINUTE);

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
    /**
     * THE GATEWAY'S OWN CEILING, AS MEASURED (acceptance round, task 10): a 100-player live run at
     * five-second pacing threw 16 throttles. That run made three calls a player with no pause
     * between them, roughly 36 calls a minute, so the limit sits below that. 20 a minute is the
     * rate every caller here now paces to, which is under the observed failure point with room for
     * the retries a rejected capsule spends.
     *
     * TWENTY WAS STILL TOO FAST (iteration 2: six of thirty players throttled even with the burst
     * gone). Twelve a minute is the rate that answered, and it is what a nightly sweep of 35
     * players costs nine minutes of wall clock at, which is nothing to a job that runs at four in
     * the morning across as many ticks as it needs.
     *
     * It is a MEASURED CEILING, not a published one: the gateway states no number, so this is the
     * fastest rate observed to answer reliably, and the 429 backoff track remains the guard for
     * whatever it turns out to be on a different night.
     */
    callsPerMinute: GATEWAY_CALLS_PER_MINUTE,
    /** `callsPerMinute` as the gap `write.ts` actually enforces between two calls. */
    minCallSpacingMs: MIN_CALL_SPACING_MS,
    /**
     * THE WRITER DOES NOT THINK BEFORE IT WRITES (task 11, founder's question: should this be a
     * non-reasoning model?).
     *
     * Measured on dev, same prompts, same validator, same rate limiter, the model the only thing
     * that moved:
     *
     *   glm-5.3-flash, reasoning on   67% written (56 of 84 answered), 16-20% throttled,
     *                                 $0.00239 a player, call latency p50 6.6s p90 12.7s
     *   glm-5.3-flash, reasoning OFF  80% written (48 of 60 answered over two runs), 0% throttled,
     *                                 $0.00153 a player, call latency p50 3.4s p90 6.4s
     *   glm-5.2-fast                  0% written (10 of 10 throttled), and it billed $0.09 a
     *                                 player anyway. It is not a non-reasoning model: a one-word
     *                                 probe spent 99 reasoning tokens at twenty times the price.
     *
     * The prose is the other half and it is not worse: five players read side by side (the ledger
     * carries them) show the same voice, with the reasoning-off reads finishing their sentences
     * where the reasoning-on ones twice ran out of budget mid-clause and once fell to template.
     * The thinking was being spent on the length and the framing rules, then run out of, which is
     * exactly what the reasoning-on failures looked like.
     *
     * Reasoning stays SELECTABLE (`CapsuleWriterDeps.thinking`, `--no-thinking`'s own inverse) so
     * the comparison can be re-run against a future model without a code change.
     */
    thinking: false,
  },
  /** The two sizes a capsule ships in — same facts, same writer/validator machinery, two prompts
   *  and two length bands (founder, live-fire review: "a competitor's player readout set the
   *  quality bar"). `compact` is the peek's own capsule; `full` ("The Read") is the player page's. */
  sizes: {
    compact: {
      // THE BAND IS WHERE THE MODEL ACTUALLY LANDS (acceptance round, task 10). 60-110 was chosen
      // from the founder's own sense of the length, and 69 of a hundred players were failing the
      // two bands, most of them by a handful of words on prose that was otherwise honest and in
      // voice. Measured on dev with the length-correction retry in place: compact accepted p10 92 p90 105 (min 78, max 109), rejected at 35 and 115; full accepted p10 259 p90 277 (min 250, max 280), rejected at 282, 283 and 291.
      // These are that observation's own p10 to p90, rounded outward to whole tens: a read is
      // human length, not a fixed box, and the correction retry pulls in the genuine outliers.
      minWords: 75,
      maxWords: 120,
      /** `glm-5.3-flash` is a REASONING model: it spends completion tokens thinking before
       *  prose, observed 18-90 reasoning tokens on a 40-word capsule in a live probe. A tight
       *  cap returns EMPTY content while still billing — `write.ts` treats that as a generation
       *  failure, never as a blank capsule — so this is sized generously above the word band. */
      maxTokens: 500,
    },
    full: {
      minWords: 240,
      maxWords: 300,
      // 1600, not 900 (live-fire 2026-09-05): glm-5.3-flash is a reasoning model, and the
      // longer Read prompt can spend most of a tight cap thinking, returning a near-empty
      // completion that reads as a validation failure instead of the truncation it is.
      maxTokens: 1600,
    },
  },
  /**
   * THE ONE CALL PER PLAYER (refrains round, 2026-09-07) — the compact read, the full read and the
   * narrative slots in one JSON object (`bundle.ts`). The prose itself is about 120 plus 300 plus
   * 400 words, roughly 1,100 tokens with the JSON around it; the cap sits well above that for the
   * same reason the per-size caps below do: a reasoning model that runs out of budget returns an
   * empty body and bills for it. The per-size `maxTokens` above still govern a part's own
   * correction call, which returns that one part as plain text.
   */
  bundle: {
    maxTokens: 3000,
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
    /**
     * THE BOARD-LEVEL SAMENESS MEASURE (refrains round, 2026-09-07). The founder read the
     * production peeks and said almost every write-up read the same: "Buy X, the price is wrong.
     * The stat that sells me is this. The honest worry is availability. Draft him with a plan
     * behind him." The whole-sentence check above cannot see that, because a refrain with a
     * different name or number in it is a different sentence to it. `sameness.ts` measures three
     * things the reader actually notices, each as a share of the llm-written board:
     *
     *   (a) OPENER FAMILIES: the first `openerWords` words of a read with names and numbers
     *       masked. Two of three reads from the 2026-09-07 regeneration opened "Let's talk about
     *       X, because", so the line is a tenth of the board: past that, a reader opening two
     *       peeks in a row hears the same voice clear its throat twice.
     *   (b) REFRAINS: `refrainStems`, counted as the share of capsules carrying each anywhere in
     *       the compact read, the full read or a narrative slot. Same line, same reason.
     *   (c) SHEET-TOURING: the share of reads citing all three usage shares with their ranks. A
     *       quarter, not a tenth, because a genuine three-down back's case sometimes IS all three
     *       shares, and the rule is "cite what decides the case", not "never cite usage".
     *
     * MEASURED BEFORE THE CHANGE (40 players on dev, the prior prompt, three calls a player):
     * see `.superpowers/sdd/dossier-voice/progress.md`, "Refrains and one call", for the baseline
     * and the after; the stems below were kept only where that baseline showed them.
     */
    openerWords: 4,
    maxOpenerFamilyShare: 0.1,
    maxRefrainShare: 0.1,
    maxSheetTouringShare: 0.25,
    /**
     * THE STOCK STEMS, DERIVED FROM THE BOARD. Compared after `sameness.ts`'s own normalisation
     * (case folded, punctuation dropped), so an apostrophe or a comma never hides a stem.
     *
     * The first group is the founder's own reading of the production peeks ("Buy X, the price is
     * wrong ... The stat that sells me ... Draft him with a plan behind him") and the three reads
     * quoted from the 2026-09-07 regeneration ("Let's talk about X", "So the call is a fade"). The
     * second group is what a 3-to-5 word scan of the 40-player baseline on dev (the prior prompt,
     * 25 written) found on more than a tenth of the board and is a FRAME rather than a fact: the
     * share it carried is beside each. Sheet echoes that are the fact itself ("weekly median in",
     * "one spot behind") are deliberately not here: a read has to cite facts, and the sheet-touring
     * measure is the check on citing too many. The third group is the trading register the same
     * night's ruling banned outright, kept here so the board's share of it stays a number.
     */
    refrainStems: [
      "the price is wrong",
      "the stat that sells me",
      "the honest worry",
      "with a plan behind him",
      "let's talk about",
      "so the call",
      "so my call",
      "the band says",
      "the volume case",
      "not a talent read",
      // From the baseline scan (share of the 25 written):
      "the books hang", // 80%, the sheet's own props sentence read back
      "at the bottom he's", // 72%, the two-outcomes close the old instructions asked for
      // NOT "have historically" (68% on the baseline, 48% on the first one-call run): it is how the
      // ADP anchor fact is stated ("clear of what receivers drafted at pick 3 have historically
      // given back"), the fact itself rather than a frame, and the reads that carry it vary the
      // sentence around it. It is the same kind of phrase as "one spot behind" and is left to the
      // sheet-touring rule's spirit: cite it when it decides the case.
      "our number says", // 64%
      "the honest hesitation", // 60%, the validator's own rule wording read back
      "at the top he's", // 60%
      "the engine of", // 56%, the old instructions' own example verb
      "makes the case", // 44%
      "most seasons land", // 44%, the sheet's own band sentence read back
      "the books set", // 36%
      // The trading register (founder ruling, 2026-09-07), 84%, 44% and 40% on the baseline:
      "the market",
      "i'm buying",
      "he's a buy",
    ],
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
  // is the half of that budget that buys nothing once the throttle is gone.
  //
  // ZERO, BECAUSE THE RATE IS HELD ONE LEVEL DOWN NOW (acceptance round, task 10). A per-player
  // pause never described what the gateway sees: a player's three calls fire concurrently, so the
  // gateway got a burst of three, a pause, a burst of three, and a per-minute limit cares about
  // the burst. `write.ts` now spaces EVERY call at `gateway.minCallSpacingMs`, which paces the
  // sweep by construction and paces anything else that talks to the gateway in the same process.
  // A second pause on top would only halve the throughput of a rate that is already held.
  sweepPacingMs: 0,
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
/** The lab-report register, plus "implying"/"implied" (see above). The prompt names these too. */
export const LAB_REPORT_TERMS: readonly string[] = [
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
];

/** NOT A BARE "ever" (acceptance round, iteration 3): the guard exists for an all-time CLAIM, and
 *  a bare word caught "if he ever gets the goal-line work", which claims nothing at all. The
 *  superlative shapes are what the ruling is about. */
export const ALL_TIME_TERMS: readonly string[] = [
  "best ever",
  "greatest ever",
  "ever seen",
  "ever played",
  "ever had",
  "all-time",
  "all time",
  "in nfl history",
  "greatest of all time",
  "goat",
];

/**
 * THE TRADING REGISTER (founder ruling, 2026-09-07: "we say market everywhere like this is a stock
 * trading app, it's a fantasy football app"). A capsule talks about ADP, picks and rounds, reaches
 * and steals, sleepers and busts, letting a player fall or drafting him. `render.ts` states the
 * sheet's own ADP facts in those words for the same reason it never says "p10", the prompt teaches
 * the fantasy words and names these as never to write, and this list refuses the paraphrase that
 * brings the trading floor back. Single words are matched whole with their plain inflections
 * ("priced", "selling", "fading"); "upside"/"downside" are not here because they are fantasy words
 * too when tied to an outcome, which the prompt asks for. Held in its own constant so the prompt
 * can name the group without carrying the words as literals of its own (the repo's source guard,
 * `src/integrity/copy-rules.ts`, sweeps the prompt module for exactly these words).
 */
export const TRADING_TERMS: readonly string[] = [
  "market",
  "price",
  "priced",
  "buy",
  "sell",
  "fade",
  "trade at",
  "trades at",
  "trading at",
  "undervalued",
  "overvalued",
  "premium",
  "discount",
  "dividend",
  "return on",
];

export const BANNED_VOCABULARY: readonly string[] = [...LAB_REPORT_TERMS, ...ALL_TIME_TERMS, ...TRADING_TERMS];

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
