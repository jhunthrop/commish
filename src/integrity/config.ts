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
     * `GET /api/notices` and `POST /api/notices/read`'s shared ceiling — sibling parity with
     * `advisorRateLimited`'s "one budget across both routes" (`src/app/api/leagues/[leagueId]/
     * advisor/_shared.ts`): both spend the same scarce resource, a Postgres round trip for this
     * user's own notices, so splitting the ceiling per route would double what a single caller
     * can spend for no product reason.
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
   * Task 7 seeds this with only what `session_signals` needs to exist; Task 8 adds the rest
   * (`flagThreshold`, `weights.device`, `weights.behavioral`, and the remaining `signals` caps
   * the three heuristics read) as fields on this SAME object, never a second one.
   */
  multiAccount: {
    /**
     * THE IP WEIGHT IS ZERO AND STAYS ZERO. This is a release gate, not a tuning choice: every
     * address this product can see today comes from `X-Forwarded-For`, which is caller-
     * controlled until a trusted proxy overwrites it. A rate limiter keyed on a forgeable header
     * loses a speed bump. A MULTI-ACCOUNT FLAG keyed on one lets an attacker manufacture
     * suspicion against somebody else's account — and the flag names a PAIR, so the manufactured
     * suspicion lands on a real person who did nothing.
     *
     * Flipping it needs two things together, and `session_signals.ip_source` is why the second
     * is mechanical: (1) Fly's proxy overwriting the header (Phase 2 Plan D), and (2) the
     * heuristic counting only rows stamped `platform_verified`.
     */
    weights: { ip: 0 },
    signals: {
      /**
       * A `User-Agent` is caller-controlled and unbounded — storing one unbounded string per
       * sign-in is a growth question this config answers with a number instead of inheriting.
       * Real UA strings top out well under this; anything past it is padding, not signal.
       */
      maxUserAgentLength: 512,
      /** Real `Accept-Language` headers are a short list of tags and weights (`"en-US,en;q=0.9"`)
       *  — an order of magnitude under this, so the cap only ever bites a caller-supplied outlier. */
      maxAcceptLanguageLength: 128,
    },
  },
} as const;
