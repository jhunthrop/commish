/**
 * Every tunable this phase reads. The spec asks for `src/config/integrity.ts`; this repo puts a
 * `config.ts` beside the module that consumes it (22 of them today) and this is the 23rd — the
 * spec's actual requirement is one documented home with no inline magic numbers, which this
 * satisfies without forking the convention. Plans B, C and D add FIELDS here, never new files.
 */
export const INTEGRITY_CONFIG = {
  chain: {
    /** Only sha256 is implemented. Named so the hashed `hashVersion` below has a meaning. */
    hashAlgorithm: "sha256",
    /**
     * Part of the hashed bytes, and stored on every row. An audit chain is the one structure
     * where you can never change the algorithm without a way to tell old rows from new ones,
     * and one integer bought at the start is cheaper than a migration that cannot be written.
     * The verifier refuses a row whose version is not this one rather than guessing.
     */
    hashVersion: 1,
    /**
     * The first `previousEventHash` in every chain. `sha256("commish:audit:chain:v1")`, NOT a
     * run of zeros: a column that defaulted to zeros, or an uninitialised buffer, must not
     * accidentally validate as "this is the first event".
     */
    genesisHash: "3899de638fb205d16aa18269aaecee607dafe3eea5e9218004f5d1cb2e91343f",
    /**
     * The scope id for events with no league: a sign-in, a profile edit, a review removal, a
     * platform-level admin action. A reserved word rather than a uuid so it is legible in a
     * query, and no league id can ever collide with it (league ids are `crypto.randomUUID()`).
     */
    platformScope: "platform",
  },
  verification: {
    /**
     * Rows per query during a chain walk. The full walk is unbounded by definition, so it pages;
     * loading a million-row chain into memory to verify it is the same class of mistake as
     * re-hashing it on every run.
     */
    batchSize: 500,
    /**
     * The spec's `AUDIT_FULL_VERIFY_INTERVAL_HOURS`. Nothing reads it today: the full walk is
     * invoked by `scripts/verify-audit-chain.ts`, run by hand. It is the number a production
     * scheduler is configured with, and **Phase 2 Plan D** is the plan that has one — spelled out
     * in full because "Plan D" alone is ambiguous across two phases.
     *
     * IT IS NOT THE WHOLE REQUIREMENT, and a reader who takes it for one will size the risk
     * wrong. This is how often an ALREADY-PROTECTED chain is re-walked. A chain is undetectably
     * rewindable until its FIRST verification freezes a checkpoint for it, so what actually
     * matters for a new league is the latency from its first append to its first verification,
     * not the interval between later ones. See `docs/decisions/audit-and-integrity.md` section 9,
     * "The floor inside tier 1", and the operator runbook line in the script's own docblock.
     */
    fullVerifyIntervalHours: 24,
  },
  /** The member-facing activity feed. */
  activity: { pageSize: 50 },
  notices: {
    /** How many of a member's own notices the inbox holds. Bounded on purpose — see ruling 22. */
    inboxSize: 20,
    /**
     * Words a notice may never contain. A notice explains what the platform did; it never
     * suggests the member did something wrong. Enforced by a test over `NOTICE_TEMPLATES`
     * (Task 7), because a rule about copy is only real if something checks the copy.
     */
    accusatoryTerms: ["violation", "violated", "suspected", "abuse", "cheating", "broke the rules", "illegal", "penalty", "offense"],
    /**
     * Passive constructions the founder rule (active voice) bans a notice from using — "was
     * made", "was removed", "is kept" all hide who did the thing, and the answer is always "we
     * did". Mechanical, same shape as `accusatoryTerms` above and enforced the same way
     * (`notices.test.ts`): a rule about copy is only real if something checks the copy, and a
     * denylist is the version of that check a review alone cannot regress.
     */
    passiveConstructions: ["was made", "was removed", "is kept", "was kept", "were made", "were removed"],
    /**
     * 30 requests per 60 seconds, restored.
     *
     * THE STOPGAP IS OVER. Plan C raised this to 120 from an observed cost of two `GET /api/notices`
     * per client-side navigation (the mount fetch, plus the refcounted stream's `open` refetch after
     * it reopened), and wrote the arithmetic here so the number would be honest rather than
     * comfortable. Phase 3 Plan D removed the cause: `NoticesProvider` lives in the root layout,
     * survives every navigation, and holds one stream and one page of notices for the life of the
     * tab.
     *
     * THE NEW ARITHMETIC, from the new cost:
     *
     *     1 GET per SESSION            (the first subscriber's mount fetch)
     *   + 1 GET per real reconnection  (the stream's `open`, which now fires only when the browser
     *                                   actually reconnects, not on every page change)
     *   + 1 GET per notice received    (`notice.created` still refetches, ruling 13)
     *   + 1 POST /api/notices/read per bell-open with unread notices
     *
     * A member receiving a notice every four seconds for a minute, opening the bell each time, spends
     * 30. That is not browsing, it is a stress case, and it is the ceiling. The old 30 was reachable
     * in FIFTEEN navigations; the new 30 is not reachable by navigation at all.
     */
    rateLimit: { maxRequests: 30, windowMs: 60_000 },
  },
  moderation: {
    /**
     * `resolveFlag`'s cap on an operator's own words (`Task 3`). The same order of magnitude as
     * `REVIEW_CONFIG.removalReason.maxLength` (200), widened because a resolution note is free
     * prose an operator writes to explain a real decision — not a short pick from a fixed reason
     * list — and it is quoted to the member VERBATIM (`operator_warning`'s blockquote), so it
     * needs room to actually explain something. Enforced in `resolveFlag` itself, the same "the
     * service is the real boundary, not only the schema" discipline `removeReview` uses.
     */
    noteMaxLength: 500,
    /** `POST /api/admin/flags/[flagId]/resolve`'s ceiling — keyed per operator id, an
     *  authenticated write with an irreversible consequence (Task 5). */
    resolveRateLimit: { maxRequests: 30, windowMs: 60_000 },
  },
  /** The queue's own read model (Task 5): `listPendingFlags`. */
  queue: {
    pageSize: 20,
    /** The league chain's own contribution to an account-pair flag's trail — bounded, the same
     *  "derive over a bounded set" discipline `INTEGRITY_CONFIG.notices.inboxSize` uses. */
    trailLimit: 20,
  },
  /**
   * Task 7 seeded this with only what `session_signals` needs to exist (`weights.ip`,
   * `signals.maxUserAgentLength`, `signals.maxAcceptLanguageLength`). Task 8 adds the rest —
   * `flagThreshold`, `weights.device`, `weights.behavioral`, `signals.cadenceToleranceSeconds`,
   * `signals.minActionsForBehavioral`, `signals.maxSignaturesPerAccount` — as fields on this SAME
   * object, never a second one. `src/integrity/similarity.ts` (Task 8) is the only reader of
   * `weights`/`flagThreshold`/`cadenceToleranceSeconds`/`minActionsForBehavioral`; Task 9 is the
   * only caller of the heuristics themselves.
   */
  multiAccount: {
    /**
     * THE IP WEIGHT IS ZERO AND STAYS ZERO. This is a release gate, recorded in
     * `docs/decisions/operators-and-moderation.md` and in the phase overview's founder-gated
     * bucket, not a tuning choice: every address this product can see today comes from
     * `X-Forwarded-For`, which is caller-controlled until a trusted proxy overwrites it. A rate
     * limiter keyed on a forgeable header loses a speed bump. A MULTI-ACCOUNT FLAG keyed on one
     * lets an attacker manufacture suspicion against somebody else's account.
     *
     * Flipping it needs two things together, and `session_signals.ip_source` is why the second is
     * mechanical: (1) Fly's proxy overwriting the header (Phase 2 Plan D), and (2) the heuristic
     * counting only rows stamped `platform_verified`, which `ipCorrelation` already does.
     */
    weights: { device: 0.6, ip: 0, behavioral: 0.4 },
    /** The spec's MULTI_ACCOUNT_FLAG_THRESHOLD. Reachable on device plus behavioral alone, by design. */
    flagThreshold: 0.75,
    signals: {
      /** `behavioralSimilarity`'s tolerance, in seconds, for how far apart two accounts' median
       *  pick time can sit before the signal stops counting them as alike at all. */
      cadenceToleranceSeconds: 60,
      /** `behavioralSimilarity`'s sample floor. Below this many actions a median is noise, not a
       *  measurement, and the heuristic answers 0 rather than guess. */
      minActionsForBehavioral: 5,
      /**
       * A `User-Agent` is caller-controlled and unbounded — storing one unbounded string per
       * sign-in is a growth question this config answers with a number instead of inheriting.
       * Real UA strings top out well under this; anything past it is padding, not signal.
       */
      maxUserAgentLength: 512,
      /** Real `Accept-Language` headers are a short list of tags and weights (`"en-US,en;q=0.9"`)
       *  — an order of magnitude under this, so the cap only ever bites a caller-supplied outlier. */
      maxAcceptLanguageLength: 128,
      /** The same growth-question discipline as `maxUserAgentLength`, applied to how many distinct
       *  client signatures Task 9 will fold into one account's `DeviceProfile`. */
      maxSignaturesPerAccount: 50,
    },
  },
  /**
   * The trade-fairness axis, in points per week — the SAME scale `ADVISOR_CONFIG.evenDelta` (3)
   * and `.lopsidedDelta` (12) sit on, because `tradeBalance` is one function and its delta has
   * one unit. Four thresholds now live on that axis and `src/integrity/config.test.ts` orders
   * all four; the spec asks for an invariant between two.
   */
  trade: {
    /**
     * The spec's `TRADE_FAIRNESS_FLAG_THRESHOLD`. A COMPLETED trade whose per-week gap reaches
     * this raises a `trade_fairness` flag into the operator queue. Deliberately above
     * `lopsidedDelta` (12): the advisor calls a 13-point gap lopsided to a member's face, and
     * every one of those reaching an operator would be a queue full of ordinary bad trades.
     * A flag is a question about collusion, not a review of somebody's judgment.
     */
    fairnessFlagThreshold: 20,
    /**
     * The spec's `TRADE_AUTO_HOLD_THRESHOLD`. Plan C left this `null` (no trade ever held) and
     * shipped only the seam: `evaluateTradeBeforeExecute` already read this field and already had
     * the hold branch, waiting on a number. Plan D (Task 5) is that number.
     *
     * **35.** Above `fairnessFlagThreshold` (20) by the same "reachable, not trivial" logic that
     * separates `fairnessFlagThreshold` from `ADVISOR_CONFIG.lopsidedDelta` (12) one step down:
     * a 20-point gap is a fairness QUESTION worth an operator's queue, but flagging every trade
     * that crosses it and freezing it outright would hold the same trades the advisor calls
     * merely "lopsided" to a member's face. A hold is not a question — it is a trade that does
     * not happen until an operator says so — so its bar sits well past the flag's own, at a gap
     * `src/trades/fairness.test.ts`'s own fixtures show as genuinely one-sided rather than a
     * shrewd-but-defensible offer. `INTEGRITY_CONFIG.trade`'s own test orders all four thresholds
     * on one axis and this is the number that keeps `fairnessFlagThreshold <= autoHoldThreshold`
     * true.
     */
    autoHoldThreshold: 35 as number | null,
    /** `sweepUnflaggedTrades`' page size — the manual re-run for a trade whose after-commit flag
     *  write did not land (Task 6). Bounded for the same reason `INTEGRITY_CONFIG.queue.pageSize`
     *  is: an operator script that reads an unbounded set is a script nobody runs twice. */
    sweepBatchSize: 100,
  },
  /**
   * The third meaning of "tier" (`@/participation`) reads its two cutoffs from here, never from a
   * hardcoded number of its own — `participationTierFor`/`isVerifiedPlayer` both take the cutoff
   * as a parameter for exactly the reason `crossesFairnessThreshold` does: a test proves changing
   * the config changes the outcome with no code change.
   */
  participation: {
    /**
     * The spec's `EXPERIENCE_TIER_CONTEST_COUNT_CUTOFF`. Completed seasons at or past this and an
     * account is a `veteran` for public-league segregation.
     *
     * THREE (founder decision #7's default, a conservative single-digit number). It is deliberately
     * NOT any state's statutory figure: Tennessee separates under-51 from 500-plus contests and
     * Mississippi marks 1,000-plus, and strategy §4.1 asks for one platform-wide default rather
     * than a state toggle. Those numbers count CONTESTS (a daily-fantasy entry); this product's
     * unit is a season-long league, and three finished seasons is a real fantasy history by any
     * reading. It is config-driven for exactly the reason the spec says: this is the number most
     * likely to need tuning once the platform has a history to tune against.
     *
     * THE GRANDFATHERING RULE IS STRUCTURAL, NOT A SPECIAL CASE. Segregation is enforced at the
     * JOIN, and nowhere else, so nobody already sitting in a league is ever reclassified out of it.
     * No league on this platform has completed a season yet, which means every account is a
     * `newcomer` today and no join is blocked today. That is the mechanism being CORRECT and not
     * yet firing.
     */
    veteranSeasonCutoff: 3,
    /**
     * Founder decision #8's default: one completed season in one league is what the review feed's
     * "verified" badge claims, and the badge's own tooltip says so in those words
     * (`VERIFIED_BADGE_TOOLTIP`, `@/participation/verified`). Necessarily at or below
     * `veteranSeasonCutoff` — an account cannot be experienced enough to segregate and too
     * inexperienced to have played here.
     */
    verifiedSeasonCutoff: 1,
    /**
     * Step 6's rollback, as the spec words it: "tier computed but inert." `false` leaves every
     * label, filter and badge exactly as they are and stops the join gate refusing anybody. Not
     * yet read by any join gate — Task 1 only computes the tier; the gate that reads this switch
     * is a later task's.
     */
    enforceTierSegregation: true,
  },
} as const;
