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
     * scheduler is configured with, and Plan D is the plan that has one.
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
  },
} as const;
