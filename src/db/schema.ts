import {
  pgTable,
  pgEnum,
  text,
  char,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  bigserial,
  bigint,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@research-ts/domain/roster";
import { AUDIT_EVENT_TYPES, type JsonObject } from "@/domain/audit";
import type { GradeComponents } from "@/draft-service/grades/engine";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { MONEY_ACCOUNT_KINDS } from "@/money/accounts";
import type { MoneyPostingDirection } from "@/money/posting";
import type { PrizeTable } from "@/money/prize-table";
import type { TransferIntent } from "@/payments-provider/contract";
import type { PeekFactsRow } from "@/league-service/peek/peek-facts-row";
import type { PeekDocument, PeekDocumentBasis } from "@/league-service/peek/peek-document-row";
import type { TradeAsset } from "@/trades/assets";
import { players } from "@research-ts/db/schema";

/**
 * THE LEAGUE APP'S TABLES. The research tables (players, the observation archives, the boards, the
 * capsules, the register) are the research core's, in `@research-ts/db/schema`; the tables here
 * reference them and never the other way round. Both live in one database until cutover, so the
 * league app's drizzle config reads both files (`drizzle.config.ts`).
 */
export const experienceTierEnum = pgEnum("experience_tier", ["beginner", "experienced"]);
export const draftFormatEnum = pgEnum("draft_format", ["snake", "auction"]);
/**
 * `"dissolved"` (Phase 4, Task 9, migration 0040) added to the END, on `0039`'s own precedent: a
 * value `ALTER TYPE ... ADD VALUE`s onto an existing Postgres enum can only ever append, never
 * insert — `@research-ts/domain/draft`'s own `DraftStatus` docblock carries the full reasoning for what this
 * value means and where it is (and is not) read.
 */
export const draftStatusEnum = pgEnum("draft_status", ["scheduled", "in_progress", "complete", "dissolved"]);
/**
 * Phase 3.5, Task 7 (the sit-and-go trigger): which of the two ways this draft's `kickoff_at`
 * came to be set. `'scheduled'` is a time a commissioner chose; `'when_full'` is a time
 * `fireWhenFullInTx` wrote the instant the league's last seat filled. Lives beside
 * `kickoff_at` on `drafts` for the same reason `kickoff_at` itself does — it answers a question
 * about THIS draft's schedule, not about the league's identity. Authored here, in migration
 * 0031, alongside Task 6's slot-preference table (the binding controller ruling for that
 * migration: an applied migration is never edited, so both tasks' schema needs are authored
 * together, in the one migration file, even though Task 7's own read/write code lands later).
 */
export const draftStartTriggerEnum = pgEnum("draft_start_trigger", ["scheduled", "when_full"]);
/** `TeamGrade.letter`'s own closed vocabulary (`@/draft-service/grades/engine`) — no `F`, by that
 *  module's own quartile rule: the bottom quartile already carries the worst word the copy law
 *  allows. */
export const draftGradeLetterEnum = pgEnum("draft_grade_letter", ["A", "B", "C", "D"]);
export const helpLevelEnum = pgEnum("help_level", ["guided", "standard"]);
/**
 * Phase 3 declared the vocabulary fixed ("no later migration ever runs `ALTER TYPE … ADD VALUE`")
 * and Phase 3.6 honored that via payload outcomes (its ruling 25). Phase 4's ruling 2 is the ONE
 * phase-level decision that grows it — money's ten events are a new event CLASS, not an outcome
 * of an existing one — shipped as `drizzle/0036_money_audit_events.sql`, a migration of its own
 * because an added enum value must not be used by the migration that adds it. Contrast
 * `member_notices.notice_type`, which every later plan extends casually and is therefore `text`.
 */
export const auditEventTypeEnum = pgEnum("audit_event_type", AUDIT_EVENT_TYPES);
export const auditActorTypeEnum = pgEnum("audit_actor_type", ["user", "system"]);
/**
 * A GIF is a `chat.message`, not a second event type (ruling 17): this is the ONE thing that
 * distinguishes the two rows shapes rather than inferring it from `gif_url` being non-null, so a
 * row can never be ambiguous mid-migration or under a future third kind.
 */
export const chatMessageKindEnum = pgEnum("chat_message_kind", ["text", "gif"]);

/** Phase 4, Task 2 (migration 0035). Derived from the money vocabulary (`@/money/accounts`), the
 *  `AUDIT_EVENT_TYPES` shape: the pg enum and the union are one list, never two to keep in step. */
export const moneyAccountKindEnum = pgEnum("money_account_kind", MONEY_ACCOUNT_KINDS);
/**
 * Every way a money transaction can come to exist — one per door money walks through, external
 * (Seam A: deposits, withdrawals and their async reversals/failures) and internal (entry fees,
 * refunds, settlement, collusion-hold outcomes, receivable recovery). Declared here rather than
 * in `@/money`: `MoneyPosting` is the browser-safe vocabulary; which KINDS of transaction exist
 * is a fact about the ledger's own writers (`src/money-service/**`), all server-side.
 *
 * `satisfies` pins each member to the plan's list; the `money_txn_kind` enum below is the same
 * runtime tuple, so the database can never accept a kind this union does not name.
 */
export const MONEY_TXN_KINDS = [
  "deposit",
  "deposit_return",
  "withdrawal_request",
  "withdrawal_complete",
  "withdrawal_return",
  "withdrawal_fail",
  "entry_fee",
  "entry_fee_refund",
  "settlement",
  "hold_release",
  "hold_confiscation",
  "receivable_settlement",
] as const;
export type MoneyTxnKind = (typeof MONEY_TXN_KINDS)[number];
export const moneyTxnKindEnum = pgEnum("money_txn_kind", MONEY_TXN_KINDS);
/** The runtime tuple for `@/money/posting`'s `MoneyPostingDirection` — `satisfies` holds the two
 *  to the same pair of words, so the pure vocabulary and the pg enum cannot drift. */
export const MONEY_DIRECTIONS = ["debit", "credit"] as const satisfies readonly MoneyPostingDirection[];
export const moneyDirectionEnum = pgEnum("money_direction", MONEY_DIRECTIONS);
/** Which way an EXTERNAL transfer moves money (Seam A's `TransferIntent.direction`), for the
 *  intent store below — `satisfies` pins the tuple to the seam's own union, so the pg enum and
 *  the contract cannot drift. Distinct from `money_direction`: that pair is double-entry
 *  vocabulary, this pair is which side of the bank the money starts on. */
export const TRANSFER_DIRECTIONS = ["deposit", "withdrawal"] as const satisfies readonly TransferIntent["direction"][];
export type TransferDirection = (typeof TRANSFER_DIRECTIONS)[number];
export const transferDirectionEnum = pgEnum("transfer_direction", TRANSFER_DIRECTIONS);
/** `none → pending → verified | failed`, written only by the KYC callback path (Task 7) — one-way
 *  except an operator reset. `none` is the default every existing and future row starts at. */
export const KYC_STATUSES = ["none", "pending", "verified", "failed"] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];
export const kycStatusEnum = pgEnum("kyc_status", KYC_STATUSES);

/**
 * Phase 4.5, Task 2 (migration 0041). `MOCK_CONFIG.modes` (`@/mock-draft/config`) IS the runtime
 * tuple — no second list respelled here, matching `moneyAccountKindEnum`'s own precedent of
 * building the pg enum directly off the pure vocabulary's own array rather than a copy that could
 * drift from it. `mock_rooms.mode` below is the only column that reads it.
 */
export const mockModeEnum = pgEnum("mock_mode", MOCK_CONFIG.modes);

// Identity (credentials, sessions, MFA, OAuth) is owned by WorkOS AuthKit. This table is
// the app's own profile row for a WorkOS user — `id` IS the WorkOS user id — holding the
// fields WorkOS doesn't know about (experience tier, avatar) and giving teams/leagues an FK.
// Rows are upserted from the AuthKit callback on every sign-in.
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    experienceTier: experienceTierEnum("experience_tier").notNull().default("beginner"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * The product's first authority beyond league membership, and deliberately the smallest one
     * that can exist: a boolean, not a role, not a permission set, not an RBAC framework (the
     * spec's own out-of-scope list forbids one). An operator can read every pending flag on the
     * platform and record one decision on each. They cannot restrict an account, because nothing
     * in this product can (founder decision 5, ruling 2).
     *
     * There is NO in-product path that writes this column: `scripts/grant-admin.ts` is the only
     * writer, and it runs against the database host, not through a session (ruling 15). A
     * privilege escalation bug therefore has to be a bug in Postgres access control rather than a
     * bug here.
     */
    isAdmin: boolean("is_admin").notNull().default(false),
    /**
     * Phase 4, Task 2 (migration 0035). `none` until the member ever starts verification; written
     * only by the KYC callback path (Task 7's `KycProvider` seam) — `none → pending → verified |
     * failed`, one-way except an operator reset. Read by `moneyGates` (Task 5): no deposit and no
     * paid join while this is anything but `verified`, which is the dossier's §4.2 federal-rules
     * gate as a column rather than a promise.
     */
    kycStatus: kycStatusEnum("kyc_status").notNull().default("none"),
    /**
     * Phase 4, Task 2 (migration 0035). Self-exclusion is a ONE-WAY STAMP in the
     * `reviews.removed_at` family, set once by the member's own exclusion action
     * (`setSelfExclusion`, `@/money-service/exclusion`) — from the MEMBER's side it is an
     * endpoint, never an in-product toggle a member flips back themselves. Task 7 corrects this
     * comment's earlier claim that nothing in the product ever clears it: an OPERATOR can, from
     * the admin room (`clearSelfExclusion`, same module), audited as `self_exclusion_cleared` —
     * the member's own "I closed this" stays one-way, but a support conversation that convinces an
     * operator to reopen it is a real, built, audited path, not a hypothetical one. `moneyGates`
     * refuses every money door while this is non-null; free play is untouched.
     */
    selfExcludedAt: timestamp("self_excluded_at", { withTimezone: true }),
    /**
     * Phase 4.5, Task 2 (migration 0041). `true` for exactly the seeded practice-opponent roster
     * (`MOCK_CONFIG.botRoster`, `@/mock-draft/config`) `ensureMockBotRoster` upserts
     * (`@/data/seed/bot-roster.ts`) — never set by any other writer, and never flipped back. A
     * bot row holds no session (WorkOS never issues one for a `bot_*` id), no `user_preferences`
     * row, no review, no chat message and no audit `actor_id` — the mock lane's own carve-out
     * (ruling 2) means a bot is never the actor of anything this column's readers care about, so
     * this flag exists for exactly one reason: the nudge scheduler's "never talk to a bot" guard
     * (Task 4) and the seat draw's "never seat a human's row as a bot" defense both need ONE
     * indexed fact rather than a `LIKE 'bot_%'` string match on `id`.
     */
    isBot: boolean("is_bot").notNull().default(false),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

/**
 * One row per user, holding only the preferences this product actually reads. It is created
 * lazily on first read rather than at sign-up, seeded from `defaultPreferences`, so a user who
 * never opens a setting still gets the right default and there is no backfill to write.
 *
 * There is deliberately NO notification-channel column here. The catalog in
 * `src/identity/notifications.ts` describes what the product tells you about; email delivery is
 * Phase 2 Plan D's, and a stored preference for a channel with no sender is a switch wired to
 * nothing. The day the sender exists, this table gains the column and the surface gains the
 * toggles.
 */
export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  helpLevel: helpLevelEnum("help_level").notNull().default("guided"),
  /** Null until the tour is dismissed. A timestamp, not a boolean, so "when" survives for Phase 3. */
  draftTourDismissedAt: timestamp("draft_tour_dismissed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leagues = pgTable(
  "leagues",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    format: draftFormatEnum("format").notNull(),
    teamCount: integer("team_count").notNull(),
    stakeTier: integer("stake_tier").notNull().default(0),
    isPublicMatchmade: boolean("is_public_matchmade").notNull().default(false),
    /**
     * Which managers this league is FOR, as advertised on the public browse page. A league-level
     * fact, not a mirror of the commissioner's own `users.experience_tier`: deriving it from a
     * person would leak that person into an unauthenticated read and would silently re-tier every
     * league they run the moment they updated their own profile.
     */
    experienceTier: experienceTierEnum("experience_tier").notNull().default("beginner"),
    /**
     * Nullable since Phase 3.5's house-leagues addendum (Task 12, rulings 28-33): `NULL` means
     * exactly one thing, the platform commissions this league, the same sentence
     * `audit_events.actor_id` already tells (`@/domain/audit`'s own "Null only when `actorType`
     * is `"system"`" invariant). `leagues_house_commissioner_ck` below is what makes that true at
     * the only layer that could make it false — a row where this is null and `houseRung` is also
     * null does not commit, so `NULL` can never mean "we forgot" or "the row is half written".
     * `@/league-service/authority.ts`'s `leagueAuthority`/`isCommissionerOf` are the only
     * sanctioned way to read this column; nothing compares it directly to a user id anymore.
     */
    commissionerUserId: text("commissioner_user_id").references(() => users.id),
    /**
     * Which catalog rung a house league came from (Task 13's `HOUSE_CATALOG`), or `null` for an
     * ordinary member league. Tied to `commissionerUserId`'s null-ness by the CHECK below rather
     * than left as a second, independently-settable fact — a `created_by_house` boolean would
     * encode the same thing twice and be free to disagree with it.
     */
    houseRung: text("house_rung"),
    /** The league's roster shape. The draft reads this to know its rounds and slot rules. */
    rosterSlots: jsonb("roster_slots").$type<readonly RosterSlotConfig[]>().notNull().default([...STANDARD_ROSTER_SLOTS]),
    /**
     * The league median game (Phase 3.5, Task 2): every team also plays the league's own median
     * score each week, and that result counts a real win/loss/tie in the ONE record alongside
     * the head-to-head result — no second matchup row, because the schema's FK/PK shape (one
     * row per `(league_id, week_number, home_team_id)`) has no room for a pseudo-opponent.
     *
     * Lives here, on `leagues`, and NOT on `scoring_settings`: a median game is a season
     * STRUCTURE choice (does a week produce one result per team or two), never a scoring
     * weight — `scoring_settings` is fifteen `real` columns that answer "what is a catch
     * worth", and `describeScoring` derives its label from exactly those, unaffected by this.
     */
    medianGame: boolean("median_game").notNull().default(false),
    /**
     * THE IDENTITY OF THIS LEAGUE'S RULE SET (peek document design §3.2, 2026-09-07):
     * `scoringHashOf(its scoring_settings row)`, stored here so the peek's one statement can join
     * straight to `player_peek_documents` without reading the settings table and recomputing a
     * digest on the request path.
     *
     * IT IS A CACHE OF `scoring_settings`, NOT A SECOND SOURCE OF TRUTH. The settings write path
     * rewrites it in the same transaction that moves a weight, and `backfillLeagueScoringHashes`
     * (`@/league-service/scoring-hash`) recomputes every league's from its own row and writes only
     * the ones that disagree.
     *
     * NULLABLE, and null means exactly one thing: nobody has computed it for this league yet (a row
     * written before this column existed, or a fresh restore). The peek reads a null hash as a MISS
     * and takes the miss path, which is the pre-round cost and never a wrong answer. It is not
     * defaulted to a preset's hash, because a default would be a claim about a rule set nobody read.
     */
    scoringHash: text("scoring_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Stamped ONCE, by `stampSeasonCompleteInTx` (`@/league-service/participation`), inside the
     * same transaction as the write that scores the league's LAST week (`finalizeWeekInTx`,
     * `@/stats-pipeline/finalize`) — never computed at read time by scanning `matchups`, which is
     * what makes "how many seasons has this account finished?" a bounded, indexed count instead
     * of an anti-join over every matchup in the product.
     *
     * Nullable, no default, no backfill: a league that finished its season before this column
     * existed does not exist, because no league on this platform has finished one yet. A
     * ONE-WAY STAMP, matching `reviews.removed_at` and `integrity_flags.resolved_at` — the guard
     * against re-stamping lives in the UPDATE's own `WHERE season_completed_at IS NULL`, not in a
     * prior read, so a correction to an already-settled week (`correctSettledWeek`, weeks later)
     * leaves the original date alone.
     */
    seasonCompletedAt: timestamp("season_completed_at", { withTimezone: true }),
    /**
     * Phase 4, Task 2 (migration 0035). What one seat costs, in cents, fixed at creation —
     * `0` IS the free league, and the ONLY kind that can exist until the founder names a launch
     * state with counsel (`MONEY_STATES.enabled` ships empty, founder decision 7). A paid join
     * collects exactly this into `league_escrow` (Task 8); bounded at creation by
     * `MONEY_CONFIG.entryFee` ($500 ceiling, founder decision 8 — config, never a constant here).
     */
    entryFeeCents: integer("entry_fee_cents").notNull().default(0),
    /**
     * Phase 4, Task 2 (migration 0035). The platform's fixed per-entry fee in cents, published
     * beside the prize table and NEVER percent-of-pool (founder decision 10, the UIGEA posture).
     * Collected into `platform_rake` at settlement's sweep (Task 10), not skimmed en route.
     */
    platformFeeCents: integer("platform_fee_cents").notNull().default(0),
    /**
     * Phase 4, Task 2 (migration 0035). The published prize table (`@/money/prize-table`), fixed
     * in advance — no proration ever (founder decision 9). `NULL` for a free league; for a paid
     * one, `prizeTableInvariant` holds sum(prizes) + rake to the pot exactly, at creation AND
     * again at settlement, browser and server enforcing the one rule from the one module.
     */
    payoutTable: jsonb("payout_table").$type<PrizeTable>(),
    /**
     * Phase 4.5, Task 2 (migration 0041). THE architecture call: a mock is a league row, not a
     * parallel table set, because `drafts`/`teams`/the store/the ticker/SSE/the whole room UI all
     * key off `leagues` already (`docs/superpowers/plans/2026-08-25-phase4p5-mock-drafts.md`'s own
     * architecture section walks every consumer). `false` for every league that exists before this
     * column and every league a commissioner ever creates by hand; `true` only for a row
     * `createMockRoom` (`@/mock-draft-service/creation`, a later task) writes, always alongside a
     * `mock_rooms` sidecar carrying the mock-only facts this column does not.
     *
     * EXCLUSION IS MECHANISM, NOT A PROMISE: every mock ships `is_public_matchmade = false`, so
     * `ENFORCED_LEAGUE_SQL` (`@/league-service/enforcement`) already keeps a mock off browse, the
     * wire's three per-league queries and the proof strip's 48h/next-draft reads BY CONSTRUCTION —
     * this column exists for the one aggregate that deliberately counts private leagues too
     * (`leaguesFilledQuery`, `@/league-service/proof`, gains `NOT is_mock` here) and for
     * `myLeaguesOverview` (`@/league-service/read`), which scopes by membership rather than by
     * `is_public_matchmade` and so needs its own predicate to keep the locker room a room of real
     * leagues.
     */
    isMock: boolean("is_mock").notNull().default(false),
    /**
     * Task 9 (Draft HQ, spec §9): the per-league opt-out for the `draft_grades_ready` notice
     * (ruling 3) — `draft-grades-job.ts` still WRITES every team's `draft_grades` row regardless
     * of this flag (a commissioner who flips it back on later should not find last draft's
     * grades missing), it only gates whether the job tells anyone. `true` by default: every
     * league before this column existed, and every league a commissioner creates today, keeps
     * getting told when its draft's grades are ready unless it opts out.
     */
    draftGradesVisible: boolean("draft_grades_visible").notNull().default(true),
  },
  (t) => [
    /**
     * PARTIAL, on purpose. `is_public_matchmade` is false for the overwhelming majority of
     * leagues (a league is private unless a commissioner opts in), and the only query that
     * reads this column reads `= true`. A partial index on `created_at` over just those rows is
     * therefore the smallest index that serves the `WHERE is_public_matchmade` filter without a
     * sequential scan of `leagues`.
     *
     * It does NOT let the browse `LIMIT` stop early on its own, and it never has: `browseQuery`
     * groups by league (for the fill-count `HAVING`) before it orders, and the measured plan is
     * `Limit -> Sort (top-N heapsort) -> HashAggregate -> ...` — the `HashAggregate` destroys
     * whatever order the index scan produced, so the ORDER BY re-sorts afterward regardless of
     * what it sorts by. Phase 3.5, Task 8, Step 4 changed that sort key from `created_at` alone
     * to seats-remaining-ASC-then-`created_at`-ASC (§4.1's liquidity doctrine: fill leagues, don't
     * just list them oldest-first) and this index's payoff is UNCHANGED by that — it was always
     * entirely the filter, never the order, verified in `src/db/index-plans.test.ts`.
     *
     * There is deliberately NO index on `commissioner_user_id`: every read of it goes through
     * `@/league-service/authority.ts`'s `leagueAuthority`/`isCommissionerOf`, applied to a league
     * already fetched by primary key (`src/lib/leagues/membership.ts`, `src/league-service/
     * read.ts`), never filtered on directly. An index on a column nothing filters on is
     * maintenance cost with no read to pay for it. Add one the day a "leagues I commission"
     * query exists.
     */
    index("leagues_public_browse_idx").on(t.createdAt).where(sql`${t.isPublicMatchmade}`),
    /**
     * PARTIAL on the same rows the column itself is rare for — a handful of completed leagues
     * against every league the platform holds. Written BY HAND, not `drizzle-kit generate`
     * (`drizzle/0028_season_completion.sql`): Plan B ruling 17's `INCLUDE` trap already proved
     * that generated DDL can silently drop a clause, and a partial index that quietly became a
     * full one is a bigger table nobody notices. `src/db/index-plans.test.ts` reads the catalog
     * definition back out of `pg_indexes` rather than trusting this declaration.
     */
    index("leagues_season_completed_idx").on(t.id).where(sql`${t.seasonCompletedAt} is not null`),
    /**
     * PARTIAL for the identical reason `leagues_public_browse_idx` is: `house_rung` is null for
     * the overwhelming majority of leagues forever. Carries `created_at` as its second column
     * because the reconciler's count (Task 13, `openHouseLeaguesQuery`) reads house rows in
     * creation order to assign each new spawn the next stagger slot.
     *
     * The shelf itself (Task 14, `houseShelfQuery`, `@/league-service/browse.ts`) does NOT read
     * this second column for its own ordering — an earlier draft of this note assumed creation
     * order and the shelf's soonest-draft order would coincide, true only WITHIN one rung
     * (`houseKickoffFor`'s own stagger), never ACROSS rungs that could stagger on independent
     * clocks. (Founder directive 2026-08-26: every rung is `when_full` today, so no rung staggers
     * at all right now — the general argument against relying on creation order still holds.) The
     * shelf orders on `drafts.kickoff_at` instead, a `Sort` measured after this index's own scan
     * in `src/db/index-plans.test.ts` rather than served by the index directly. This index still
     * serves the shelf query's `WHERE house_rung IS NOT NULL` predicate — that half of the plan,
     * never the order.
     */
    index("leagues_house_rung_idx").on(t.houseRung, t.createdAt).where(sql`${t.houseRung} is not null`),
    /**
     * The CHECK that makes a nullable `commissionerUserId` safe (Phase 3.5 addendum, Task 12,
     * ruling 28): `house_rung` is null exactly when `commissioner_user_id` is NOT null, and vice
     * versa. A row in neither state, or in both, does not commit — see `commissionerUserId`'s own
     * docblock above for what that buys. Hand-written in `drizzle/0032_house_leagues.sql`, the one
     * non-additive statement Phase 3.5 writes: it is also the one statement here that scans every
     * existing row, because Postgres validates a CHECK before accepting it. The deploy-era form
     * (`ADD CONSTRAINT ... NOT VALID` then a separate `VALIDATE CONSTRAINT`) is documented in
     * `docs/conventions.md`'s migration section — today's database holds seed rows only, so the
     * scan is trivial and the deploy-era split is not needed here.
     */
    check("leagues_house_commissioner_ck", sql`(${t.houseRung} IS NULL) = (${t.commissionerUserId} IS NOT NULL)`),
    /**
     * Phase 4.5, Task 2 review (HIGH, fix round 1): `isMock`'s own docblock above states "every
     * mock ships `is_public_matchmade = false`" as the load-bearing fact that lets `ENFORCED_
     * LEAGUE_SQL` exclude a mock from browse, the wire and the proof strip's 48h/next-draft reads
     * BY CONSTRUCTION — but until this CHECK existed, that fact was conventional, upheld only by
     * every writer remembering to set both columns in step. A future mock writer that set
     * `is_public_matchmade: true` (a copy-paste off `createLeague`'s own default, or a new lobby
     * feature that seats a mock into the public shelf "just this once") would silently leak into
     * every `ENFORCED_LEAGUE_SQL` consumer with no test anywhere failing, because none of those
     * consumers know a mock exists — they trust the predicate they already have. The same
     * `leagues_house_commissioner_ck` precedent immediately above: an invariant load-bearing
     * enough to sit in prose belongs in the DDL, not in a writer's discipline. `NOT is_mock`
     * reads "this row is not a mock" — the CHECK holds trivially for every non-mock league
     * (`is_mock` false makes the left side true regardless of `is_public_matchmade`) and for a
     * mock row demands `is_public_matchmade = false` explicitly.
     */
    check("leagues_mock_private_ck", sql`NOT ${t.isMock} OR ${t.isPublicMatchmade} = false`),
  ],
);

/**
 * The mock-only sidecar (Phase 4.5, Task 2, migration 0041) — one row per mock `leagues.id`,
 * carrying the facts a mock room needs that a real league never does: which of the three
 * founder-required modes it is, its practice pick clock, the seed its bot brain replays from,
 * the code strangers or friends claim a seat with, and when the fill window (or the solo/early
 * grace) fires. Everything else a mock room needs already lives on `leagues`/`drafts`/`teams` —
 * this table is the sidecar half of "one column, one sidecar, not a parallel machine."
 *
 * `leagueId` IS the primary key, not a separate id: a mock room has exactly one league, always
 * (`createMockRoom` writes both in the same transaction), so a second identity for this row would
 * only ever be able to disagree with the league it describes. `ON DELETE CASCADE` is what makes
 * the retention sweep (Task 6) a clean `DELETE FROM leagues WHERE id = ...` — legal only because
 * the mock lane's audit carve-out (ruling 2) means a mock never writes a row the audit spine's
 * append-only triggers would refuse to lose.
 */
export const mockRooms = pgTable(
  "mock_rooms",
  {
    leagueId: text("league_id")
      .primaryKey()
      .references(() => leagues.id, { onDelete: "cascade" }),
    hostUserId: text("host_user_id")
      .notNull()
      .references(() => users.id),
    mode: mockModeEnum("mode").notNull(),
    pickSeconds: integer("pick_seconds").notNull(),
    /** The seed `rngFor` (`@/mock-draft/rng`) derives every bot's own stream from — drawn once at
     *  creation and stored, never re-drawn, so a draft's bot behavior replays exactly from this
     *  one number for a bug report or a test. */
    botSeed: integer("bot_seed").notNull(),
    /** The short code a lobby listing or a `link` invite is claimed by (`/api/mock-drafts/
     *  [code]`, a later task) — UNIQUE, not the primary key: unlike `league_invites.code`, this
     *  table's own identity is the league it describes, and a code is one more fact about that
     *  league rather than the row's own address. */
    shareCode: text("share_code").notNull(),
    /** The fill-window deadline: when the ticker's due scan (Task 6) may top up bots and start
     *  this room regardless of how many humans have claimed a seat. A solo room stamps `now` at
     *  creation (it starts itself in the same call, Task 5); `claimMockSeat` (Task 5) pulls this
     *  forward to `now + earlyStartGraceSeconds` the instant every human seat is claimed. */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mock_rooms_share_code_idx").on(t.shareCode),
    /**
     * THE ticker's due scan (Task 6's `dueMockRoomsQuery`: due-to-start rooms, `starts_at <=
     * now()`) and the retention sweep (Task 6's `sweepExpiredMocks`: expired rooms by the same
     * column against a per-status retention window) — both scan this table by `starts_at` alone,
     * never by `leagueId` (already served by the primary key) or by any other column. No partial
     * predicate: unlike `leagues_public_browse_idx`, every row in this table is mock-room-shaped
     * by construction (the table holds nothing else), so there is no rare-versus-common split to
     * carve a partial index around.
     */
    index("mock_rooms_starts_at_idx").on(t.startsAt),
    check("mock_rooms_pick_seconds_positive_ck", sql`${t.pickSeconds} > 0`),
  ],
);

export const teams = pgTable(
  "teams",
  {
    id: text("id").primaryKey(),
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    /** Waivers v1 (roadmap item 4): lower wins the tie for a waivered player; a successful award
     *  moves the winner to last (max+1), never resets. 0 = never awarded, best claim. */
    waiverPriority: integer("waiver_priority").notNull().default(0),
  },
  (t) => [
    index("teams_league_id_idx").on(t.leagueId),
    index("teams_user_id_idx").on(t.userId),
    uniqueIndex("teams_league_user_idx").on(t.leagueId, t.userId),
  ],
);

/**
 * A shareable way into a league: the short code IS the primary key, so the link
 * (`/app/join/<code>`) and the code a commissioner reads aloud are the same thing rather
 * than two artifacts to keep in step. Bounded on purpose — an invite expires and can be used
 * a limited number of times, because a permanent unbounded link into a money league is a
 * standing invitation to whoever forwards it.
 */
export const leagueInvites = pgTable(
  "league_invites",
  {
    code: text("code").primaryKey(),
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    maxUses: integer("max_uses").notNull(),
    uses: integer("uses").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("league_invites_league_id_idx").on(t.leagueId)],
);

/**
 * Who a team STARTED in a given week. Distinct from `roster_slots`, which says who they own:
 * a matchup page for week 3 must render week 3's lineup beside week 3's stored score, and a
 * single un-versioned roster cannot do that honestly. Absent rows are normal, not an error —
 * `defaultLineup()` derives a legal week from the roster for anyone who never opened the
 * editor.
 */
export const lineupSlots = pgTable(
  "lineup_slots",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    weekNumber: integer("week_number").notNull(),
    slot: text("slot").notNull(),
    slotIndex: integer("slot_index").notNull(),
    playerId: text("player_id"),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.weekNumber, t.slot, t.slotIndex] }),
    /**
     * THE inverted index the live-scoring pipeline needs, maintained by the database rather than
     * by a second copy in Redis that could drift from this table. A stat change for one player
     * resolves to the teams that started that player in that week by an index range scan, which
     * is what keeps a tick O(changed players) instead of O(leagues x teams x starters). The
     * column order is (player, week) and not (week, player) because the worker always knows the
     * week and asks about a set of players: the players are the selective half.
     */
    index("lineup_slots_player_week_idx").on(t.playerId, t.weekNumber),
  ],
);

export const scoringSettings = pgTable("scoring_settings", {
  leagueId: text("league_id")
    .primaryKey()
    .references(() => leagues.id, { onDelete: "cascade" }),
  pointsPerPassingYard: real("points_per_passing_yard").notNull(),
  pointsPerPassingTouchdown: real("points_per_passing_touchdown").notNull(),
  pointsPerInterception: real("points_per_interception").notNull(),
  pointsPerRushingYard: real("points_per_rushing_yard").notNull(),
  pointsPerRushingTouchdown: real("points_per_rushing_touchdown").notNull(),
  pointsPerReceivingYard: real("points_per_receiving_yard").notNull(),
  pointsPerReceivingTouchdown: real("points_per_receiving_touchdown").notNull(),
  pointsPerReception: real("points_per_reception").notNull(),
  pointsPerFumbleLost: real("points_per_fumble_lost").notNull(),
  teReceptionBonus: real("te_reception_bonus").notNull().default(0),
  pointsPerFieldGoal: real("points_per_field_goal").notNull(),
  pointsPerExtraPoint: real("points_per_extra_point").notNull(),
  pointsPerSack: real("points_per_sack").notNull(),
  pointsPerDefensiveInterception: real("points_per_defensive_interception").notNull(),
  pointsPerDefensiveTouchdown: real("points_per_defensive_touchdown").notNull(),
  // The scoring-vocabulary widening (2026-08-30). Defaults are the incumbent-standard values so
  // every existing league's sheet gains them without a data migration beyond the DDL default.
  pointsPerTwoPointConversion: real("points_per_two_point_conversion").notNull().default(2),
  pointsPerFieldGoalMissed: real("points_per_field_goal_missed").notNull().default(-1),
  pointsPerExtraPointMissed: real("points_per_extra_point_missed").notNull().default(0),
  pointsPerReturnTouchdown: real("points_per_return_touchdown").notNull().default(6),
  pointsPerDefensiveFumbleRecovery: real("points_per_defensive_fumble_recovery").notNull().default(2),
  pointsPerSafety: real("points_per_safety").notNull().default(2),
});

/**
 * INJURED RESERVE membership (engine-gap roadmap item 3, 2026-08-30). A membership TABLE, not a
 * roster slot type: placing a player here DELETES his `roster_slots` row — which is what frees
 * real roster capacity for a claim, with zero changes to slot arithmetic — and activation
 * assigns him back through `assignSlot`, refusing when the roster is full. Ownership of an IR'd
 * player is this row; every "is he on a roster here" read that feeds the free-agent pool must
 * check BOTH tables.
 */
/**
 * WAIVERS v1 (engine-gap roadmap item 4, 2026-08-30). A dropped player sits on waivers for a
 * fixed window; claims filed during it are BIDS, resolved when the window closes — by waiver
 * priority, winner moves to last. `league_waivers` is the window (one row per waivered player
 * per league); `waiver_claims` are the bids. Processing is LAZY — `processWaivers` runs at the
 * top of every pool read and claim, so a cleared window resolves on the next touch with no cron
 * to fail silently.
 */
export const leagueWaivers = pgTable(
  "league_waivers",
  {
    leagueId: text("league_id").notNull().references(() => leagues.id, { onDelete: "cascade" }),
    playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    until: timestamp("until", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.playerId] })],
);

export const waiverClaims = pgTable(
  "waiver_claims",
  {
    id: text("id").primaryKey(),
    leagueId: text("league_id").notNull().references(() => leagues.id, { onDelete: "cascade" }),
    teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    addPlayerId: text("add_player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    dropPlayerId: text("drop_player_id"),
    status: text("status", { enum: ["pending", "won", "lost"] }).notNull().default("pending"),
    /** Why a lost claim lost, in the words the loser reads ("Outbid by waiver priority", a refusal). */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("waiver_claims_league_player_idx").on(t.leagueId, t.addPlayerId)],
);

/** Trade governance (roadmap item 5): one veto vote per member per trade under review. */
export const tradeVetoes = pgTable(
  "trade_vetoes",
  {
    tradeId: text("trade_id").notNull().references(() => tradeProposals.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    castAt: timestamp("cast_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tradeId, t.userId] })],
);

export const injuredReserve = pgTable(
  "injured_reserve",
  {
    teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    /** His designation when placed ("O", "IR") — the fact that justified the placement, kept
     *  even after the feed moves on. */
    designationAtPlacement: text("designation_at_placement").notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.playerId] })],
);

export const rosterSlots = pgTable(
  "roster_slots",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    slot: text("slot").notNull(),
    slotIndex: integer("slot_index").notNull(),
    playerId: text("player_id"),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.slot, t.slotIndex] }),
    /**
     * The fallback half. `getLineup` derives a legal lineup from the roster for any team whose
     * manager never opened the editor, so a changed player can affect a team with no
     * `lineup_slots` row for the week at all. No week column, because a roster is not versioned
     * by week.
     */
    index("roster_slots_player_idx").on(t.playerId),
  ],
);

export const drafts = pgTable(
  "drafts",
  {
    id: text("id").primaryKey(),
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    format: draftFormatEnum("format").notNull(),
    status: draftStatusEnum("status").notNull().default("scheduled"),
    kickoffAt: timestamp("kickoff_at", { withTimezone: true }).notNull(),
    auctionBudget: integer("auction_budget"),
    /** Task 7. Defaults `'scheduled'` — every draft before this column existed, and every
     *  draft a commissioner schedules by hand today, keeps that default. */
    startTrigger: draftStartTriggerEnum("start_trigger").notNull().default("scheduled"),
    /**
     * Phase 3.6, Task 7 (migration 0034): how many times `rollUnfilledDraftInTx`
     * (`@/league-service/roll`) has pushed a `'scheduled'` draft's `kickoff_at` forward because
     * its room was not full at its target time — the founder's "roll until full" ruling made a
     * column. Written only by the roll's own guarded `UPDATE`; read by `PublicLeagueSummary`'s
     * `kickoffRolls` (`@/matchmaking/contract`), `DraftScheduleBody.kickoffRolls`
     * (`@/league-room/contract`), the waiting room and the browse card
     * (`rollNoticeSentence`, `@/matchmaking/roll`), and the `draft_kickoff_rolled` notice. Never
     * decremented and never capped — the ruling is that the time slips until the last seat
     * fills, and Task 8's seat release is the pressure valve, not a ceiling here.
     */
    kickoffRolls: integer("kickoff_rolls").notNull().default(0),
    /**
     * Phase 3.6, Task 7 (migration 0034): the instant `fireWhenFullInTx` last stamped this
     * draft's kickoff for a genuinely full room, or `null` before that has ever happened.
     * Replaces the notice-existence check `fireWhenFullInTx` used to guard its own repeat-fire
     * refusal with (`FILL_TRIGGER_REFUSALS.alreadyFired`) — a notice is audit-anchored and
     * nothing ever deletes one, so once a released seat can genuinely UN-fill a league during its
     * grace window, a notice-shaped guard would refuse to fire a second time forever.
     * `fireWhenFullInTx` (Task 7) is this column's own writer, stamping it the moment it fires.
     * THE CLEARER EXISTS: Phase 3.6, Task 8's `releaseSeat` (`@/league-service/release`) clears it
     * back to `null` whenever a released seat un-fills a league that had already fired, landed in
     * the same commit as the `startDraft` pool-read move its own binding precondition named
     * (`DraftActionSource`'s own docblock, `@/draft-service/store`) — so a league that fills,
     * loses a seated member, and fills again fires its `draft_fill_triggered`/`house_league_filled`
     * notices a second time, exactly as this column was always meant to allow.
     */
    fillFiredAt: timestamp("fill_fired_at", { withTimezone: true }),
  },
  (t) => [
    // UNIQUE, not a plain index: nothing else in the schema enforces "one draft per league",
    // and two live call sites already assume it — browse.ts's innerJoin (a second draft row
    // duplicates the league card and burns two of the browse LIMIT slots) and join.ts's
    // leftJoin + single-row read (an arbitrary draft row decides whether a join is accepted).
    // This converts that invariant-by-convention into an invariant-by-constraint before any
    // Phase 1 data exists to violate it.
    uniqueIndex("drafts_league_id_idx").on(t.leagueId),
    // TWO READERS, BOTH MEASURED (Phase 3 Plan D, Task 7 review fix round 1, F3, plus the final
    // review's F16 — which caught this comment claiming a measurement for the first reader that
    // did not exist yet, and was answered by taking it rather than softening the verb). Both
    // assertions live in src/db/index-plans.test.ts's "hot read paths" over `seedRealisticCorpus`
    // (`@/db/test-corpus`), and both EXPLAIN the real exported builder rather than a hand copy.
    // The ticker's expiry scan (`liveDraftsQuery`, `ticker.ts`) reads `status = 'in_progress'`
    // alone, which a leading `status` column serves identically whether or not a second column
    // follows it — measured by "the ticker's expiry scan still seeks on the leading status column
    // alone". `autoStartDueDrafts`'s (`@/draft-service/auto-start`) due-kickoff scan reads
    // `status = 'scheduled' AND kickoff_at <= now()`, every tick, on every instance, whether or
    // not any draft is actually due — with `status` alone, that scan's own EXPLAIN measured a
    // real, unbounded-with-growth cost: a bitmap heap fetch across the WHOLE `scheduled`
    // population (91% of it discarded by a `kickoff_at` filter applied AFTER the fetch, in this
    // corpus) that a `LIMIT` cannot short-circuit, because `ORDER BY id` sorts the join's full
    // result before the limit ever applies. `kickoff_at` appended as the index's second column
    // lets that same scan seek straight to the due rows instead, at zero cost to the first
    // reader — the measurement `drizzle/0029_draft_due_scan_index.sql` records is what decided
    // this rather than reasoning about it in the abstract.
    index("drafts_status_idx").on(t.status, t.kickoffAt),
  ],
);

/**
 * Phase 3.5, Task 6: NFFC's Kentucky Derby System. One row per team that has ranked the draft
 * slots it wants, keyed by `(draft_id, team_id)` — a TABLE, not a `SET_QUEUE`-style draft
 * action (ruling 27, the same reason the player pool is a table): a ranking is an *input* to
 * the one-time draw `assignDraftSlots` (`@/draft-service/order`) runs at `START_DRAFT`, and the
 * draw's *output* is what gets snapshotted into that action's own `draftOrder` — replay
 * determinism lives in the snapshot, never in this row, so editing or deleting a preference
 * after the draw cannot change history, and a preference may be read with an ordinary query
 * instead of a replay.
 *
 * `ranking` is a JSON array of 1-based slot numbers, most-wanted first — partial and even empty
 * (mind either way) are both valid: most managers care about two slots, not twelve.
 */
export const draftSlotPreferences = pgTable(
  "draft_slot_preferences",
  {
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    ranking: jsonb("ranking").$type<readonly number[]>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.draftId, t.teamId] })],
);

// Durable, replay-based draft action log — the source of truth for in-progress
// draft state. Materialized state is a cache derived by replaying this table
// through the DraftEngine reducer, never the other way around.
export const draftActions = pgTable(
  "draft_actions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    /**
     * 1-based position in this draft's action log. The unique index below is the database's
     * own backstop against two writers appending at the same position — a bug in the
     * in-process lock can then cost a rejected action, never a double-drafted player.
     */
    sequence: integer("sequence").notNull(),
    action: jsonb("action").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("draft_actions_draft_id_id_idx").on(t.draftId, t.id),
    uniqueIndex("draft_actions_draft_sequence_idx").on(t.draftId, t.sequence),
  ],
);

/**
 * One row per nudge the moderator has already sent, keyed by the draft and the PICK the nudge
 * was for. This is what makes "we already nudged this turn" DURABLE: a process restart, or a
 * second app instance, both lose an in-memory set — they cannot lose a committed row.
 *
 * Keyed on `pick_number`, not on the action `sequence`: `sequence` counts accepted actions, and
 * a SET_QUEUE by any manager deliberately does NOT start a new turn while still bumping it. So
 * a sequence-keyed claim released mid-turn, letting the moderator speak again for the same turn
 * — duplicate nudges to the team on the clock, and one manager able to drive another's nudges
 * (and the model spend) by editing their own queue. `pick_number` advances exactly once per
 * turn in both formats, so one turn is exactly one row.
 */
export const draftNudges = pgTable(
  "draft_nudges",
  {
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    pickNumber: integer("pick_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.draftId, t.pickNumber] })],
);

/**
 * THE ROOM'S FACTS FOR ITS CURRENT LOG SEQUENCE (the batched bots round, 2026-09-25): the
 * advisor's odds table, tier standings and collapses for one draft state, in the wire form
 * `serializeRoomFacts` writes (`@/draft-service/assistant/facts-store`). ONE row per draft,
 * replaced whenever a newer sequence is computed: the facts for a sequence the room has moved
 * past can never be asked for again, so keeping them would only grow the table. Written by the
 * invocation that landed the pick (its own follow-through, after its response), read by every
 * viewer's `/assistant` request on any function, which is what makes the dock ready when the
 * human's turn begins without a second process ever simulating. Replaces the Redis facts store
 * and its compute lock: a row is durable, needs no TTL, and its writer never needs to be waited
 * on, because a viewer who finds no row for the sequence simply computes (a miss's honest cost).
 */
export const draftRoomFacts = pgTable("draft_room_facts", {
  draftId: text("draft_id")
    .primaryKey()
    .references(() => drafts.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  facts: text("facts").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const draftPicks = pgTable(
  "draft_picks",
  {
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id),
    playerId: text("player_id").notNull(),
    round: integer("round").notNull(),
    pickNumber: integer("pick_number").notNull(),
    price: integer("price"),
  },
  (t) => [
    primaryKey({ columns: [t.draftId, t.pickNumber] }),
    uniqueIndex("draft_picks_draft_player_idx").on(t.draftId, t.playerId),
  ],
);

/**
 * THE STORED GRADE (Task 9, spec §9) — one row per team per REAL completed draft, written once by
 * `draft-grades-job.ts` at draft completion (`src/draft-service/store.ts`'s post-commit block,
 * beside `sweepQuietly`). A mock draft never reaches this table: `store.ts` enqueues the writing
 * job only for a `!isMock` completion, so `draftId` here always names a draft whose league is a
 * real one — Task 11's mock debrief calls the same pure `gradeDraft` engine at READ time instead,
 * and stores nothing.
 *
 * `letter`/`components`/`projectedRank` are exactly `TeamGrade`'s own three facts
 * (`@/draft-service/grades/engine`), stored rather than recomputed on every read: a real draft's
 * picks and rosters never change once committed, so the grade is a fact about a fixed history,
 * not a live computation. `boardGeneration` is the evidence board's own `asOf` stamp the job fed
 * `gradeDraft` (`evidencePoolFor`'s own return, `@/draft-service/sim/evidence`) — carried so a
 * later reader can see exactly what evidence a grade was computed against (ruling R-4), the
 * identical honesty `sim_runs.board_generation` already keeps for a sim run.
 *
 * `bigserial` id, not `(draftId, teamId)` as the primary key directly: the unique index below
 * enforces the one-row-per-team invariant, and a surrogate id is what lets the job's own upsert
 * (`onConflictDoUpdate` on that unique key) restate every non-key column through `excludedSetFor`
 * without a composite key's extra ceremony — the identical shape `adp_snapshots` already uses for
 * a job-written, upsert-idempotent table.
 */
export const draftGrades = pgTable(
  "draft_grades",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    letter: draftGradeLetterEnum("letter").notNull(),
    components: jsonb("components").$type<GradeComponents>().notNull(),
    projectedRank: integer("projected_rank").notNull(),
    boardGeneration: text("board_generation").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One grade per team per draft — the job's own upsert conflict target, and what makes a
     *  re-run of the job (a retried job attempt, an operator re-enqueue) idempotent by construction. */
    uniqueIndex("draft_grades_draft_team_idx").on(t.draftId, t.teamId),
    /** The debrief page's own read: every team's grade for one draft, in one indexed scan. */
    index("draft_grades_draft_idx").on(t.draftId),
  ],
);

export const weeks = pgTable(
  "weeks",
  {
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    weekNumber: integer("week_number").notNull(),
    /**
     * The league's median score for this week, written by `finalizeWeekInTx`
     * (`@/stats-pipeline/finalize`) in the SAME transaction as the matchup scores it was
     * computed from — null for a league with `leagues.median_game` off, and for a week not yet
     * settled. An OVERWRITE, not a one-way stamp like `leagues.season_completed_at`: a stat
     * correction (`correctSettledWeek`) re-settles a week's scores and must re-derive its median
     * too, or this column would describe a week that no longer exists.
     *
     * `weeks`' primary key is already `(league_id, week_number)` — one row per league week is
     * exactly the cardinality of one median per league week, so no new table is needed for it.
     */
    medianScore: real("median_score"),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.weekNumber] })],
);

export const matchups = pgTable(
  "matchups",
  {
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    weekNumber: integer("week_number").notNull(),
    homeTeamId: text("home_team_id")
      .notNull()
      .references(() => teams.id),
    awayTeamId: text("away_team_id")
      .notNull()
      .references(() => teams.id),
    homeScore: real("home_score"),
    awayScore: real("away_score"),
  },
  (t) => [
    primaryKey({ columns: [t.leagueId, t.weekNumber, t.homeTeamId] }),
    /**
     * The ingestion worker's late-settlement catch-up (`settleMissedWeeks`,
     * `src/stats-pipeline/worker.ts`) asks, on EVERY tick, "which leagues have an unscored matchup
     * in a week that is already final?" — `week_number IN (...) AND home_score IS NULL`. Neither
     * predicate can use the primary key, which leads with `league_id`, so without this the query
     * is a sequential scan of every matchup in the product every thirty minutes on the background
     * pool.
     *
     * PARTIAL, on the null-score predicate, because the answer is almost always the empty set: a
     * settled matchup has both scores, so the index holds only rows that are genuinely waiting to
     * be settled — normally a handful, and zero for a fully caught-up product. That makes it a few
     * pages rather than a copy of the table, and it keeps the write cost of settling a week to
     * REMOVING an entry rather than updating one. `(week_number, league_id)` in that order matches
     * both the `IN` predicate and the query's `ORDER BY`.
     */
    index("matchups_unsettled_idx").on(t.weekNumber, t.leagueId).where(sql`${t.homeScore} is null`),
  ],
);

/**
 * League chat. Keyed on the LEAGUE, not on a draft: the draft room and the league room mount
 * the same conversation, so the trash talk from draft night is still there in week 9 rather
 * than dying with the room it was said in.
 *
 * `id` is a bigserial because it is also the page cursor — a monotonic integer orders the
 * history with no timestamp tie to break, and `(league_id, id)` makes one page an index range
 * scan rather than a sort of the whole league's history.
 *
 * Removal is a stamp, never a delete (Task 6, mirroring `reviews`' own convention exactly): the
 * row keeps its author, its body, who removed it and why. It DIVERGES from `reviews` at the
 * read, not at the write — a removed review vanishes from its feed, but a removed message
 * renders IN PLACE (ruling 18): a conversation with a hole in it is a conversation everybody
 * misreads, and the members who saw it before it went already know it existed. `removed_by_
 * user_id` is deliberately NOT on `ChatMessageView` — which operator removed a message is an
 * operator fact, not a member-facing one. Neither is `removal_reason` (final review, HIGH 1):
 * the wire-bound `ChatMessageRemoval` is `{ at }`, so the reason reaches the author's private
 * notice and nobody else.
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    // Additive, all nullable (0017_chat_message_gifs.sql) — explicit columns rather than a jsonb
    // blob, because the shape is fixed and small and a blob is unvalidatable at the database.
    // `kind` alone says which shape a row is; the gif_* columns are populated together or not at
    // all (chat-service/chat.ts's postMessage writes both in one insert).
    kind: chatMessageKindEnum("kind").notNull().default("text"),
    gifUrl: text("gif_url"),
    gifPreviewUrl: text("gif_preview_url"),
    gifAlt: text("gif_alt"),
    gifWidth: integer("gif_width"),
    gifHeight: integer("gif_height"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Additive, all nullable (0024_chat_moderation.sql) — the removal stamp. A GIF needs no
    // second code path: a GIF is one `chat_messages` row (ruling 17), so this stamp covers it by
    // construction.
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedByUserId: text("removed_by_user_id").references(() => users.id),
    removalReason: text("removal_reason"),
  },
  // `(league_id, id)` and nothing else, which is now the WHOLE physical index too. It carried
  // `INCLUDE (body, ...)` from 0018 through 0024; `drizzle/0026_measured_index_shapes.sql`
  // dropped that list after measuring it inert — `chatPageQuery` (`@/chat-service/chat`) selects
  // eleven more columns than the list carried and joins two tables, so it can never be an
  // Index-Only Scan, and the covering columns bought 2.7x the index size for nothing. This
  // definition and the physical index finally agree, so a `db:generate` recreation of it is no
  // longer a silent loss (`src/db/index-plans.test.ts` still reads it back out of `pg_indexes`).
  (t) => [index("chat_messages_league_id_idx").on(t.leagueId, t.id)],
);

/**
 * A report is in-product moderation SIGNAL, not moderation ACTION (ruling 12: a member never
 * aims a flag directly). One row per reporter per message — the primary key is the pair, copying
 * `review_reports` exactly, so reporting twice is a no-op upsert (`onConflictDoNothing`) rather
 * than a duplicate or an error: reporting the same message again is the same report, not a
 * second one. A GIF needs no second report table either, for the identical reason the removal
 * stamp above needs no second column set: a GIF is one `chat_messages` row.
 */
export const chatMessageReports = pgTable(
  "chat_message_reports",
  {
    messageId: bigint("message_id", { mode: "number" })
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    reporterUserId: text("reporter_user_id").notNull().references(() => users.id),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.reporterUserId] })],
);

/**
 * One row per person per emoji per message — the pair IS the identity, so a reaction is a
 * toggle (delete-or-insert) rather than a counter two writers can disagree about. There is no
 * count column anywhere: every count in the product is derived from these rows.
 */
export const chatReactions = pgTable(
  "chat_reactions",
  {
    messageId: bigint("message_id", { mode: "number" })
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
);

/**
 * One review per person, edited rather than duplicated: `user_id` is UNIQUE, so "I already wrote
 * one" is a database fact and not a count the service has to get right.
 *
 * Removal is a stamp, never a delete. A removed review keeps its author, its text, who removed it
 * and why, because the alternative is that a product with an unfiltered review feed can make a
 * review disappear leaving nothing behind. `audit_events` below (Phase 3, Plan A) is the real
 * audit log; `removeReview` records a `review_removed` event there in the same transaction as
 * this stamp, and this row stays the interim record the review feed itself reads, not a second
 * system to reconcile against the chain.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedByUserId: text("removed_by_user_id").references(() => users.id),
    removalReason: text("removal_reason"),
  },
  (t) => [
    uniqueIndex("reviews_user_idx").on(t.userId),
    /** The feed's only ordering. Partial on visibility, because the feed never reads removed rows. */
    index("reviews_feed_idx").on(t.createdAt).where(sql`${t.removedAt} is null`),
  ],
);

/**
 * A report is in-product moderation SIGNAL, not moderation ACTION (Phase 2 ruling 18) — a member
 * never acts on their own report; it raises (or confirms) a `review_report` flag in
 * `integrity_flags` for an operator to act on instead (Phase 3 Plan B,
 * `docs/decisions/operators-and-moderation.md` §3). One row per reporter per review — the primary
 * key is the pair, so reporting twice is a no-op upsert (`onConflictDoNothing`) rather than a
 * duplicate or an error: reporting the same review again is the same report, not a second one.
 */
export const reviewReports = pgTable(
  "review_reports",
  {
    reviewId: text("review_id").notNull().references(() => reviews.id, { onDelete: "cascade" }),
    reporterUserId: text("reporter_user_id").notNull().references(() => users.id),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.reviewId, t.reporterUserId] })],
);

/**
 * THE audit log. Append-only in three independent ways, because one of them being wrong is the
 * whole failure mode: `AuditLogger` exposes no update or delete (Task 3), the database rejects
 * UPDATE and DELETE with a trigger even from a raw client (`0019`), and every row carries the
 * hash of the row before it so an edit that got past both is still detectable (Task 4).
 *
 * NO FOREIGN KEYS, deliberately, and this is the one table in the schema where that is true.
 * `leagues` cascades to nine tables; a cascade is a DELETE, so an FK to `leagues` would either be
 * rejected by the append-only trigger (making a league undeletable) or, without the trigger,
 * would let deleting a league silently delete the record of what happened in it. The audit trail
 * of a deleted league is exactly the audit trail you want to still have. `actor_id` is the same
 * argument for `users`. Referential integrity here is the hash chain's job, not the planner's.
 *
 * `chain_scope` is the league id, or `INTEGRITY_CONFIG.chain.platformScope` for an event with no
 * league. One chain per scope: see `docs/decisions/audit-and-integrity.md` for the contention
 * math that ruled against a single global chain.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    eventId: text("event_id").primaryKey(),
    chainScope: text("chain_scope").notNull(),
    sequence: integer("sequence").notNull(),
    eventType: auditEventTypeEnum("event_type").notNull(),
    actorId: text("actor_id"),
    actorType: auditActorTypeEnum("actor_type").notNull(),
    leagueId: text("league_id"),
    payload: jsonb("payload").$type<JsonObject>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    previousEventHash: text("previous_event_hash").notNull(),
    eventHash: text("event_hash").notNull(),
    hashVersion: integer("hash_version").notNull(),
  },
  (t) => [
    /**
     * The `draft_actions_draft_sequence_idx` pattern, for the same reason: the anchor row lock
     * is what serializes appends, and this is the database's own backstop if that lock is ever
     * wrong. A bug then costs a rejected append, never a forked chain. It is also the index the
     * verifier and the activity feed both read by, since both walk one scope in sequence order.
     */
    uniqueIndex("audit_events_scope_sequence_idx").on(t.chainScope, t.sequence),
    /** The scaling review's first composite (C5): the per-league, time-ranged read. */
    index("audit_events_league_occurred_idx").on(t.leagueId, t.occurredAt),
    /** The scaling review's second: Plan B's per-actor, per-type behavioral read. */
    index("audit_events_actor_type_occurred_idx").on(t.actorId, t.eventType, t.occurredAt),
    /**
     * Migration 0038 — a cross-lane carry from the design lane's Task 8 review (MEDIUM: unproven
     * index coverage). The design lane's wire (`@/league-service/wire.ts`, `main`, not present in
     * this worktree) reads `WHERE event_type = 'member_joined' AND occurred_at BETWEEN ...`,
     * INNER JOINed to `leagues` with no `league_id` EQUALITY anywhere in its own `WHERE` — the
     * join supplies `league_id` per outer row, never as one literal value the two indexes above
     * could seek on. Measured (`src/db/index-plans.test.ts`) against migration 0037: neither
     * composite above serves this shape, and the planner fell back to a Bitmap Index Scan across
     * the WHOLE `audit_events_league_occurred_idx` (every league, not just the outer join's own),
     * discarding 4 of every 5 candidate rows via a `Filter` on `event_type` applied after the
     * heap fetch. Partial rather than a full `(event_type, occurred_at)` composite: `member_
     * joined` is the one event type this shape ever filters on (every other `event_type` reader
     * in the codebase already supplies a `league_id` or `actor_id` equality the two indexes above
     * serve), so a full composite would index all sixteen `AUDIT_EVENT_TYPES` to serve a read that
     * only ever wants one of them — the same "narrower than a full composite, same seek" choice
     * `trade_proposals_open_fingerprint_idx`, `leagues_house_rung_idx` and `reviews_feed_idx`
     * above already make for their own single-value predicates.
     */
    index("audit_events_member_joined_occurred_idx").on(t.occurredAt).where(sql`${t.eventType} = 'member_joined'`),
  ],
);

/**
 * SIDELINE (P5: "reactions attach to all of them"). One row per person per emoji per EVENT, the
 * identical shape and identical reasoning as `chat_reactions` above: the triple is the identity,
 * so a reaction is a toggle rather than a counter two writers can disagree about, and no count
 * column exists anywhere.
 *
 * Keyed on `audit_events.event_id` because the stream's events ARE audit events — the row a
 * member reacts to is the one `listLeagueActivity` rendered, so there is no second id space and
 * no way to react to something that never happened. NOT `ON DELETE CASCADE`, unlike its chat
 * twin: an audit event is never deleted (that is the whole point of the chain), so a cascade
 * would describe a transition that cannot occur, and a plain reference keeps a stray reaction
 * from ever outliving the fact it is about.
 *
 * The league is NOT denormalized onto this row. `audit_events.league_id` already carries it, and
 * the one read (`reactionsForEvents`) and the one write (`toggleEventReaction`) both join through
 * it, so a reaction cannot be attached to an event in a league the actor cannot see and there is
 * no second copy of the scope to drift.
 */
export const eventReactions = pgTable(
  "event_reactions",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => auditEvents.eventId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId, t.emoji] })],
);

/**
 * One row per chain: its head, and the lock every append to that chain takes.
 *
 * This IS the rollup `docs/decisions/data-layer-hardening.md` requires. `head_sequence` is the
 * count of events in the chain and `head_hash` is the link the next one attaches to, both
 * advanced in the SAME transaction as the append they summarize — never after it, never in a
 * job. `audit_events` remains the reconciliation source: `verifyChainIntegrity` and
 * `verifyFullChainIntegrity` both re-derive this row's two values by walking the events and
 * REFUSE the chain when what they derive disagrees with what is stored here (`anchor_mismatch`).
 * That reconciliation is the only reason deletion is detectable at all: the rows that are gone
 * leave no trace in the rows that remain, and this row is the chain's own sworn statement about
 * how many there should be.
 *
 * There is deliberately no separate `event_count` column: `head_sequence` already is it, and a
 * second copy of one number is a second thing that can disagree.
 */
export const auditChains = pgTable("audit_chains", {
  scope: text("scope").primaryKey(),
  headSequence: integer("head_sequence").notNull().default(0),
  headHash: text("head_hash").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Verification's own state, in its OWN table rather than as columns on `audit_chains`.
 *
 * If the checkpoint lived on the anchor row, advancing it would take a row lock on the row every
 * append is waiting for, so a chain walk would block every write to that league for its whole
 * duration. Two tables cost one more row and buy the property that the verifier and the writer
 * never contend at all.
 *
 * FORWARD-ONLY, enforced by triggers (migration `0021`), because this row is a DETECTOR and a
 * detector an adversary can quietly delete or rewind is not one. It is the third account of how
 * many events a chain holds, and the only one that survives an adversary who deletes the tail of
 * `audit_events` and rewinds `audit_chains` to match: a checkpoint that froze five verified
 * events while the anchor now claims three is the rewind, stated in the chain's own records.
 * DELETE is refused outright; UPDATE is refused unless it moves `verified_through_sequence`
 * forward or leaves it where it is, which is every write the verifier itself ever makes.
 */
export const auditChainCheckpoints = pgTable("audit_chain_checkpoints", {
  scope: text("scope").primaryKey().references(() => auditChains.scope),
  verifiedThroughSequence: integer("verified_through_sequence").notNull().default(0),
  verifiedThroughHash: text("verified_through_hash").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * What the platform told one member it did, and when they read it.
 *
 * The row stores the RENDERED copy, not only the type and the context (ruling 12). What a person
 * was told is a historical fact: if a template is reworded next month, the notice they already
 * read must not silently become different words. `context` is kept beside it so a later reader
 * can see what it was rendered from, which is also what makes a template change auditable.
 *
 * `league_id` is nullable, because not every automated action happens inside a league: a review
 * removal does not. Unlike `audit_events` this table DOES carry foreign keys with cascade: it is
 * a delivery record, not the record, and a deleted user's undelivered notices are noise.
 *
 * `notice_type` is TEXT and not a pg enum, unlike `audit_event_type`. The audit vocabulary is
 * fixed and fully declared today; notice types are added by Plans B, C and D, and `ALTER TYPE …
 * ADD VALUE` inside drizzle-kit's transaction-wrapped migration is a trap (the new value cannot
 * be used in the same transaction). `NoticeType` plus `NOTICE_TEMPLATES` is the vocabulary, and
 * `notify.test.ts` asserts every stored value is one of its keys.
 */
export const memberNotices = pgTable(
  "member_notices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    leagueId: text("league_id").references(() => leagues.id, { onDelete: "cascade" }),
    noticeType: text("notice_type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    context: jsonb("context").$type<JsonObject>().notNull(),
    /** The audit event this notice explains. No FK, for the same reason `audit_events` has none. */
    auditEventId: text("audit_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    /**
     * The inbox's only ordering. `(user_id, created_at)` and not a partial index on unread: the
     * inbox reads a member's most recent notices whether or not they are read, and the unread
     * count is a `count(*)` over that same bounded page rather than a rollup — the balance-as-
     * rollup convention's own threshold (derive over a bounded set, roll up over an unbounded
     * one), and a member's recent notices are bounded by `INTEGRITY_CONFIG.notices.inboxSize`.
     */
    index("member_notices_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/**
 * One row per open question a human has to answer. ONE table for every detector rather than one
 * per detector (ruling 28): the queue read, the detail view and the resolution are one workflow,
 * and three copies of it is how three of them drift.
 *
 * The row carries what was true WHEN IT WAS RAISED and nothing else. A review's report count is
 * derived at read time from `review_reports`, because a report count per review is bounded and
 * `docs/decisions/data-layer-hardening.md` says to derive over a bounded set and roll up only
 * over an unbounded one (ruling 5). `evidence` is for facts a later read cannot recover: the
 * similarity scores that crossed the threshold, computed against session data that will have
 * moved on by the time an operator looks.
 *
 * Resolution is a STAMP with the no-re-stamp guard in the UPDATE's own WHERE, exactly as `reviews`
 * removal is (ruling 4). The immutable record of the decision is the `flag_resolved` audit event;
 * this row is the queue's index into it.
 */
export const integrityFlags = pgTable(
  "integrity_flags",
  {
    id: text("id").primaryKey(),
    flagType: text("flag_type").notNull(),
    subjectType: text("subject_type").notNull(),
    /** The reviewed thing. For `account_pair`, the two user ids joined low-id-first so the pair is canonical. */
    subjectId: text("subject_id").notNull(),
    /** Where it happened. NOT a chain scope: this row is not an audit event (ruling 1). */
    leagueId: text("league_id").references(() => leagues.id, { onDelete: "cascade" }),
    evidence: jsonb("evidence").$type<JsonObject>().notNull(),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: text("resolved_by_user_id").references(() => users.id),
    resolution: text("resolution"),
    resolutionNote: text("resolution_note"),
  },
  (t) => [
    /**
     * At most one OPEN flag per subject. A second report of the same message, or a second sweep
     * finding the same pair, is confirmation rather than a duplicate — the same property
     * `review_reports`' composite primary key already gives one reporter, lifted to the subject.
     * Partial on `resolved_at IS NULL` so a resolved flag never blocks a later one about the same
     * subject: content reported again after a `no_action` is a new question, not the old one.
     */
    uniqueIndex("integrity_flags_open_subject_idx")
      .on(t.subjectType, t.subjectId)
      .where(sql`${t.resolvedAt} is null`),
    /**
     * The queue's only ordering: oldest first, open only (ruling 30). BOTH keys, because
     * `pendingFlagQuery`'s keyset cursor seeks on `(raised_at, id)` as a row comparison — with
     * `raised_at` alone that comparison plans as a Filter and every page re-walks from the
     * oldest open flag (`drizzle/0026_measured_index_shapes.sql` carries the measurement).
     */
    index("integrity_flags_queue_idx").on(t.raisedAt, t.id).where(sql`${t.resolvedAt} is null`),
  ],
);

/**
 * What the server observed about the client at a sign-in. NOT an audit event, on purpose
 * (ruling 7): `audit_events` refuses UPDATE and DELETE and carries no foreign keys, which is
 * right for a record of what happened and wrong for a person's device and network. This table
 * cascades from `users`, so deleting an account erases them.
 *
 * NO CLIENT BEACON FEEDS THIS (ruling 9). Three server-observed values: the User-Agent and
 * Accept-Language headers, and a hash of the request address. Screen dimensions and a timezone
 * would need a browser round trip reporting numbers the browser chooses, which is a new surface
 * for a signal already ruled untrustworthy alone.
 *
 * `ip_source` is the release gate in a column. `INTEGRITY_CONFIG.multiAccount.weights.ip` is 0
 * and stays 0 until Fly's proxy overwrites X-Forwarded-For (Phase 2 Plan D); this column is what
 * lets the heuristic then use only the rows written after that, rather than trusting a history
 * any caller could have written (ruling 8).
 */
export const sessionSignals = pgTable(
  "session_signals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    acceptLanguage: text("accept_language"),
    /** sha256(salt + address). Correlation needs equality; it never needs the address. */
    ipHash: text("ip_hash"),
    ipSource: text("ip_source").notNull(),
  },
  // `user_id` alone. The name keeps its `occurred_at` half for continuity with the migration
  // that created it, but the column is gone: the sole reader (`signalsForUsers`) orders
  // GLOBALLY across every requested user, so a per-user `occurred_at` ordering cannot serve it
  // (`drizzle/0026_measured_index_shapes.sql` carries the measurement).
  (t) => [index("session_signals_user_occurred_idx").on(t.userId)],
);

/**
 * One row per offer. The FIRST record in this product of two managers negotiating, and the
 * first thing `roster_slots` has ever moved for other than a draft.
 *
 * `status` is a guarded one-way stamp, not a field a caller sets after reading it: every
 * transition is an `UPDATE … WHERE id = $1 AND status = 'open'` and the branch that acts is
 * chosen from `RETURNING`, which is the same discipline `reviews.removed_at`,
 * `integrity_flags.resolved_at` and `toggleReaction` all use, and the reason two managers
 * clicking at the same instant produce one decision rather than two.
 *
 * `reversed_at` is deliberately NOT a status. An operator undoing a trade does not un-happen the
 * acceptance: `trade_accepted` is on the league chain and nothing may edit it, so a status that
 * erased the acceptance would make this row and the chain disagree about the same afternoon.
 *
 * Assets are `jsonb` rather than a `trade_assets` child table. The set is bounded at
 * `TRADE_CONFIG.maxAssetsPerSide` (5) per side, it is never queried by member (`assetPlayerIds`
 * is applied in TypeScript over a bounded list), and it is a DISCRIMINATED UNION Phase 9 adds an
 * arm to, which a normalized child table would model as a nullable column per arm. Derive over a
 * bounded set — `docs/decisions/data-layer-hardening.md`, read the way it applies to shape rather
 * than to totals.
 */
export const tradeProposals = pgTable(
  "trade_proposals",
  {
    id: text("id").primaryKey(),
    leagueId: text("league_id").notNull().references(() => leagues.id, { onDelete: "cascade" }),
    proposerTeamId: text("proposer_team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    counterpartyTeamId: text("counterparty_team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    /**
     * The week this proposal is VALUED at. ALWAYS SERVER-DERIVED, never a caller's to name (final
     * review, CRITICAL 1): `currentWeekOf` (`@/league-service/schedule`) answers it from the
     * league's own `matchups`, at propose time, and `acceptTrade` RE-STAMPS it to the current week
     * at the moment of the yes — a 72-hour offer can straddle a week boundary, and the week that
     * governs an execution is the one the rosters actually moved in. So an accepted row names the
     * week the trade happened in, which is what `sweepUnflaggedTrades` re-derives its own
     * valuation at. Kept so a re-read months later can explain the verdict a manager saw, the same
     * "what was true when it was raised" discipline `integrity_flags.evidence` follows.
     */
    weekNumber: integer("week_number").notNull(),
    proposerAssets: jsonb("proposer_assets").$type<readonly TradeAsset[]>().notNull(),
    counterpartyAssets: jsonb("counterparty_assets").$type<readonly TradeAsset[]>().notNull(),
    /** sha256 over the league, the ordered team pair and both sorted asset lists. The index below
     *  is what makes "the same offer, twice" one question. */
    fingerprint: text("fingerprint").notNull(),
    note: text("note"),
    status: text("status").notNull(),
    proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    settledByUserId: text("settled_by_user_id").references(() => users.id),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    /** Trade governance (roadmap item 5): when review ends and an unvetoed trade executes. Set
     *  when acceptance stamps `under_review`; null on every other status. */
    reviewEndsAt: timestamp("review_ends_at", { withTimezone: true }),
    /** The `integrity_flags.id` whose resolution ordered the reversal. No foreign key, matching
     *  `member_notices.audit_event_id`'s own reasoning: this column is provenance, and a FK here
     *  would take a lock on `integrity_flags` inside a transaction that already holds a chain
     *  anchor. */
    reversedByFlagId: text("reversed_by_flag_id"),
  },
  (t) => [
    /** The same offer twice is one question; a different package to the same manager is two.
     *  Partial on open, so a settled package may be offered again. */
    uniqueIndex("trade_proposals_open_fingerprint_idx").on(t.fingerprint).where(sql`${t.status} = 'open'`),
    /** The inbox read: "what has been offered to my team", newest first. Partial on open,
     *  because the inbox is a to-do list and a settled offer is history. */
    index("trade_proposals_inbox_idx").on(t.counterpartyTeamId, t.proposedAt).where(sql`${t.status} = 'open'`),
    /** The outbox read, and the open-cap count. Same shape, other side. */
    index("trade_proposals_outbox_idx").on(t.proposerTeamId, t.proposedAt).where(sql`${t.status} = 'open'`),
    /** The league's trade history, and the supersede sweep's scan. NOT partial: history is the
     *  settled rows. */
    index("trade_proposals_league_idx").on(t.leagueId, t.proposedAt),
  ],
);

/**
 * Phase 3.6, Task 6: a seat reserved for a visitor who is not signed in yet, keyed by an opaque
 * `token` and NOTHING ELSE — no user id, because a hold exists to survive the trip to WorkOS and
 * back, and there is no user to name until that trip completes (`claimSeatHold`,
 * `@/league-service/seat-hold.ts`).
 *
 * NOT REDIS, and NOT A LOCK. A seat is capacity, capacity is a correctness question, and Postgres
 * is authoritative here by the codebase's own rule; PgBouncer forbids `pg_advisory_lock`, so
 * exclusion comes from the write itself, guarded by the SAME `leagues FOR UPDATE` every capacity
 * writer in this file already takes first. See `claimSeatHold`'s own docblock for the full
 * reasoning and the FK lock enumeration.
 *
 * `expiresAt` is read by a PREDICATE (`expires_at > now`), never swept by a deletion job — level-
 * triggered, exactly like the house reconciler and `houseKickoffStillAhead`: a hold that only
 * expired when a sweeper ran would be a seat held hostage by an unrelated outage.
 */
export const seatHolds = pgTable(
  "seat_holds",
  {
    token: text("token").primaryKey(),
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set once, by `consumeSeatHoldInTx`, the moment the holder actually joins — a ONE-WAY
     *  stamp matching `reviews.removed_at`/`leagues.season_completed_at`. Null forever for a hold
     *  that simply expires unused; nothing ever deletes that row, the same "the record outlives
     *  the event" discipline `trade_proposals.status = 'open'` follows. */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [
    /** The live-hold read (`liveHoldsFor`): partial on unconsumed rows, the same reasoning
     *  `leagues_season_completed_idx`'s own docblock gives for a column that is rare on the
     *  timescale that matters — a hold spends ten minutes unconsumed and then is either consumed
     *  or simply stops mattering, never revisited by this index again. */
    index("seat_holds_live_idx").on(t.leagueId, t.expiresAt).where(sql`${t.consumedAt} is null`),
  ],
);

/**
 * Phase 4, Task 2 (migration 0035): the money ledger's rollup rows — one per account the
 * double-entry book posts against, keyed by the vocabulary's own id string (`accountIdFor`,
 * `@/money/accounts`: `"user_available:usr_x"`, or the bare kind for a singleton), so the id IS
 * the fact and a join to look it up never exists.
 *
 * The row exists SOLELY to be `SELECT … FOR UPDATE`d: `balance_cents` is the rollup
 * `docs/decisions/data-layer-hardening.md` requires over the unbounded `money_entries` history,
 * advanced in the SAME transaction as the entries it summarizes (Task 3's `postMoneyTransaction`,
 * the one writer), and its row lock is what serializes concurrent postings against one account —
 * PgBouncer forbids advisory locks, so exclusion is this row lock and nothing else. `audit_chains`
 * is the shape being copied, deliberately: mutable rollup over an append-only record, reconciled
 * by re-derivation (`reconcileMoney`, Task 4), never trusted as the record itself.
 *
 * The CHECK is ruling 5's floor: no player-facing liability ever goes negative — the
 * sufficient-balance refusal happens in code under the row lock, and this is the database's own
 * backstop when that code is ever wrong. The three kinds exempted are exactly the accounts the
 * ACH-return failure model swings below zero legitimately: the pool an already-spent deposit
 * reverses out of, the clearing account mid-flight, and the receivable that CARRIES the shortfall
 * (which is why the shortfall goes there instead of to any member's balance).
 */
export const moneyAccounts = pgTable(
  "money_accounts",
  {
    id: text("id").primaryKey(),
    kind: moneyAccountKindEnum("kind").notNull(),
    /** The user or league this account belongs to; NULL for the platform-wide singletons —
     *  redundant with the id's own suffix by construction, queryable without parsing it. */
    ownerId: text("owner_id"),
    balanceCents: bigint("balance_cents", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "money_accounts_balance_floor_ck",
      sql`${t.balanceCents} >= 0 OR ${t.kind} IN ('fbo_pool', 'provider_clearing', 'platform_receivable')`,
    ),
  ],
);

/**
 * Phase 4, Task 2 (migration 0035): one row per money EVENT — the thing a set of balanced
 * `money_entries` legs belongs to. Append-only by trigger, exactly as `money_entries` is: the
 * transaction row names what happened and the entries are its arithmetic, and history that can
 * be edited at either level is not history.
 *
 * `league_id` carries NO foreign key — the audit chain's own ruling-7 precedent, restated for
 * money: `leagues` cascades to nine tables, a cascade is a DELETE, and the money trail of a
 * deleted league is exactly the trail an auditor (or a member owed a refund) most needs to still
 * have. Money history must survive anything, including the league it happened in.
 *
 * `idempotency_key` is nullable and UNIQUE: a provider webhook retrying a settled transfer, or a
 * double-submitted deposit, collides here and becomes a no-op instead of a double posting.
 * Internal postings (entry fee inside a join transaction) are serialized by their own row locks
 * and carry NULL, which Postgres's UNIQUE treats as always-distinct — exactly right.
 */
export const moneyTransactions = pgTable(
  "money_transactions",
  {
    id: text("id").primaryKey(),
    kind: moneyTxnKindEnum("kind").notNull(),
    leagueId: text("league_id"),
    /** The provider's own reference for an external transfer (Seam A), NULL for an internal
     *  posting — provenance, the `member_notices.audit_event_id` class: never a join key. */
    providerTransferRef: text("provider_transfer_ref"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("money_transactions_idempotency_key_idx").on(t.idempotencyKey),
    /** The league money history read: every fee, refund and payout a league's money door ever
     *  produced — dissolution (Task 9) and settlement (Task 10) both walk it. */
    index("money_transactions_league_idx").on(t.leagueId),
  ],
);

/**
 * Phase 4, Task 2 (migration 0035): THE BOOK OF RECORD (founder decision 1) — one row per
 * double-entry leg, append-only by trigger (`0019`/`0021`'s precedent, applied to money), written
 * ONLY by `postMoneyTransaction` (Task 3) in balanced sets `balancedOrRefuse` has already passed.
 *
 * `state_of_entry` and `tax_year` are NOT NULL on EVERY row — founder decision 6, and the whole
 * of what Phase 5's tax stack assumes: the 1099 threshold query is answerable by index over these
 * two columns alone, with no backfill and no row ever grandfathered out. `tax_year` is derived
 * from the writer's own `Clock` at the write and stored, never recomputed from `created_at` later
 * (a posting written at 23:59 on Dec 31 belongs to the year the writer's clock said, forever).
 *
 * `amount_cents` is strictly positive by CHECK: direction lives in `direction` alone, so an
 * amount can never encode it a second, disagreeing time. Whole cents only — the vocabulary's
 * `balancedOrRefuse` refuses fractions in code, and `bigint` refuses them at the database.
 */
export const moneyEntries = pgTable(
  "money_entries",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => moneyTransactions.id),
    accountId: text("account_id")
      .notNull()
      .references(() => moneyAccounts.id),
    direction: moneyDirectionEnum("direction").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    stateOfEntry: char("state_of_entry", { length: 2 }).notNull(),
    taxYear: integer("tax_year").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("money_entries_amount_positive_ck", sql`${t.amountCents} > 0`),
    /** The account statement read (`walletSummary`/`accountBalance` reconciliation, Task 3's
     *  `read.ts`): one account's history in time order, an index range scan however large the
     *  book grows. */
    index("money_entries_account_created_idx").on(t.accountId, t.createdAt),
    /** THE Phase 5 guarantee (founder decision 6): the 1099 threshold query — every entry for a
     *  tax year, grouped by state — seeks here instead of scanning the whole book each January. */
    index("money_entries_tax_year_state_idx").on(t.taxYear, t.stateOfEntry),
  ],
);

/**
 * Phase 4, Task 5 (migration 0037): what a provider callback cannot say for itself. A
 * `PaymentsEvent` (Seam A's `ingest.ts`) carries only `{type, ref, amountCents}` — the provider
 * speaks its own vocabulary and knows nothing of our users — so the initiation writer
 * (`initiateDeposit`, `@/money-service/deposits`) records here WHOSE transfer a ref names, the
 * state they attested at the door (decision 6: every eventual entry row needs it, and the
 * completion callback arrives days after the attestation), and the amount the provider accepted,
 * for the disagreement alarm. This is the "stores the intent" half of the deposits brief:
 * pending money is the bank's, not the book's, so an intent is deliberately NOT a
 * `money_transactions` row — no ledger rows exist until the completion event posts them.
 *
 * NOT append-only-triggered and NOT FK'd to `users`, both on the money tables' own reasoning:
 * it is provenance beside the book rather than the book itself (the rollup/`session_signals`
 * class), and money history must survive anything (ruling 7 — `money_transactions.league_id`
 * carries no FK for the same reason). Insert-only by usage: status is never stored here because
 * the book itself answers it (a `deposit`-kind transaction with this ref means completed; a
 * `deposit_return` means returned), and a second place to say so would be a place to drift.
 */
export const paymentTransferIntents = pgTable(
  "payment_transfer_intents",
  {
    /** The provider's own reference — opaque, and the one join key a callback carries. */
    providerTransferRef: text("provider_transfer_ref").primaryKey(),
    direction: transferDirectionEnum("direction").notNull(),
    userId: text("user_id").notNull(),
    /** Integer cents the provider accepted — the disagreement alarm compares callbacks to this. */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    /** The deposit rail chosen (`bank`/`card`); NULL for a withdrawal (bank only, permanently). */
    method: text("method"),
    /** Self-attested at the door this phase (Task 5 Step 2); Phase 5 replaces the producer. */
    stateOfEntry: char("state_of_entry", { length: 2 }).notNull(),
    /** The namespaced key this product handed the provider — provenance, never a join key. */
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("payment_transfer_intents_amount_positive_ck", sql`${t.amountCents} > 0`),
    /** One intent per initiation: a double-submit resolves at the provider into the SAME ref,
     *  and this index is the database's backstop for the same fact on our side. */
    uniqueIndex("payment_transfer_intents_idempotency_key_idx").on(t.idempotencyKey),
    /** The wallet's "your pending deposits" read, and Task 11's reconcile sweep: one user's
     *  intents in time order. */
    index("payment_transfer_intents_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/**
 * THE DURABLE JOB SYSTEM (job-system round, 2026-09-02). Postgres-backed queue we own, worked by
 * a thin runner seam: the local always-on runner during the data year, Vercel Cron tick endpoints
 * when deployed. See docs/superpowers/specs/2026-09-02-job-system-design.md.
 *
 * `failed` and `abandoned` are TERMINAL dead-letter states, loud by construction: the admin jobs
 * page lists them first and the runner prints a DEAD-LETTER banner when one is reached. `failed`
 * means the job itself said no (a terminal refusal, or retryable errors exhausting max_attempts);
 * `abandoned` means the process working it died (stale heartbeat) with no attempts left.
 */
export const jobStatusEnum = pgEnum("job_status", ["pending", "running", "succeeded", "failed", "abandoned"]);

/**
 * THE QUEUE ROW — the one MUTABLE row per job. Every transition here is a claim about "now"
 * (pending -> running -> back to pending with backoff, or a terminal state); history lives in
 * `job_runs`/`job_run_steps`, which are append-only and trigger-enforced (migration 0068).
 */
export const jobs = pgTable(
  "jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Registry key (`src/jobs/registry.ts`). The definition — steps, timeout, backoff — lives in
     *  code; the row carries only what the queue needs to schedule and report it. */
    name: text("name").notNull(),
    /** What makes a double enqueue harmless. Schedule-born jobs use `<schedule>@<fireInstant>`,
     *  so a double tick (two runners, a retried Vercel cron) inserts once; operator re-runs mint
     *  a fresh key on purpose. */
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").$type<JsonObject>().notNull(),
    status: jobStatusEnum("status").notNull().default("pending"),
    /** STARTED attempts (incremented by the claim itself, so a crash mid-run still counts). */
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    /** When this job is next eligible: enqueue instant at first, then `now + backoff(attempt)`
     *  after each retryable failure. The claim scan's leading filter. */
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    /** Which worker holds the current claim, null when not running. */
    claimedBy: text("claimed_by"),
    /** Refreshed by the executor while running; a reclaim pass returns any running job whose
     *  heartbeat has gone stale to `pending` (attempts remaining) or `abandoned` (exhausted). */
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    /** For schedule-born jobs: which code-defined schedule fired, and the fire instant it fired
     *  for. Nullable — an operator enqueue has neither. This IS the fire history (the spec's
     *  cursor-over-history call): no second table to disagree with. */
    scheduleName: text("schedule_name"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    /** The most recent attempt's error, denormalized for the admin list. The authoritative record
     *  is the run row's own `error`; this is a pointer-sized convenience, overwritten per attempt,
     *  never the history itself. Stored pre-scrubbed: nothing writes env values into it. */
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("jobs_idempotency_key_idx").on(t.idempotencyKey),
    /** The claim scan: `status = 'pending' AND run_at <= now ORDER BY run_at, id`. */
    index("jobs_status_run_at_idx").on(t.status, t.runAt),
  ],
);

/**
 * APPEND-ONLY ATTEMPT HISTORY — one row per attempt at a job. The current attempt's row may
 * finish itself exactly once (`running` -> a terminal status); a finished row is immutable and
 * DELETE is never permitted, both enforced by trigger (0068, the 0019 audit-spine precedent).
 */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: bigint("job_id", { mode: "number" })
      .notNull()
      .references(() => jobs.id, { onDelete: "restrict" }),
    /** Which attempt this was, 1-based — matches `jobs.attempts` at claim time. */
    attempt: integer("attempt").notNull(),
    status: jobStatusEnum("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** What went wrong, in stored-scrubbed text (never raw env, never a secret). */
    error: text("error"),
    /** `retryable | terminal | timeout | crash` — how the failure was classified, so the admin
     *  page can say WHY a job died without re-parsing error prose. */
    errorKind: text("error_kind"),
    claimedBy: text("claimed_by").notNull(),
  },
  (t) => [
    uniqueIndex("job_runs_attempt_idx").on(t.jobId, t.attempt),
    /** The admin read: recent runs, newest first. */
    index("job_runs_started_idx").on(t.startedAt),
  ],
);

/**
 * THE CHECKPOINT LOG — one row per COMPLETED step of a job, appended the moment the step
 * finishes. Unique per `(job_id, step)`: a completed step is completed for the JOB, across
 * attempts and across bounded Vercel ticks, which is what lets a retry or a resume skip straight
 * to the first unrecorded step. Append-only by trigger, like `job_runs`.
 */
export const jobRunSteps = pgTable(
  "job_run_steps",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: bigint("job_id", { mode: "number" })
      .notNull()
      .references(() => jobs.id, { onDelete: "restrict" }),
    /** The run that actually completed the step — attribution, not identity. */
    runId: bigint("run_id", { mode: "number" })
      .notNull()
      .references(() => jobRuns.id, { onDelete: "restrict" }),
    step: text("step").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    /** What the step reported (a season-week step's summary and detail lines). Display data for
     *  the admin page, never re-read by the executor's skip logic. */
    detail: jsonb("detail").$type<JsonObject>(),
  },
  (t) => [uniqueIndex("job_run_steps_job_step_idx").on(t.jobId, t.step)],
);

/**
 * SCHEDULE CURSORS — one bookmark per code-defined schedule (`src/jobs/schedules.ts`): the
 * instant up to which its cron expression has been evaluated. The catch-up walk enqueues every
 * fire in `(last_evaluated_at, now]` (bounded by the config's catch-up window) and moves the
 * bookmark forward — which is how a laptop that slept through Tuesday 08:00 still runs Tuesday's
 * cadence when it wakes. A cursor is a bookmark, not history; the fire history is on `jobs`.
 */
export const scheduleCursors = pgTable("schedule_cursors", {
  scheduleName: text("schedule_name").primaryKey(),
  lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }).notNull(),
});

/**
 * DRAFT HQ'S SHEET STORE (spec §10, phase 1) — the persistent cheat sheet, server-side, so it can
 * follow a manager into every room rather than living only in one browser's `localStorage` the
 * way `src/draft-room/quilt/state/sheet.ts`'s `CheatSheet` does today.
 *
 * ONE ROW PER SHEET, not per (user, league): the spec's own "one per (user, league) plus a
 * default sheet" plus My Sheet's multi-sheet picker (duplicate/rename/delete) both need more than
 * one sheet per user to exist at once, so a sheet is its own row with an owner and an OPTIONAL
 * league, never a singleton keyed by the pair. `leagueId` null is the format-default sheet (spec
 * §4: "a format-default sheet"); non-null scopes a sheet to one league's own rules.
 *
 * `draftSheetTagEnum` — TARGET / AVOID-EARLY / NEVER-DRAFT, spec §4's three tags, worded as
 * `avoid`/`never` in the enum (the UI's own hyphenated labels are a presentation choice, not a
 * stored fact) so a future fourth tag is one enum value, not a schema migration plus a rename.
 */
export const draftSheetTagEnum = pgEnum("draft_sheet_tag", ["target", "avoid", "never"]);

export const draftSheets = pgTable(
  "draft_sheets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Null is the format-default sheet; non-null scopes this sheet to one league's own rules
     *  and gates every read/write on that league's membership (`@/lib/leagues/membership.ts`). */
    leagueId: text("league_id").references(() => leagues.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** The sheet picker's own read: every sheet a user owns, newest first — bounded to one
     *  person's own sheets, never scanned across the table. */
    index("draft_sheets_user_idx").on(t.userId, t.createdAt),
  ],
);

export const draftSheetEntries = pgTable(
  "draft_sheet_entries",
  {
    id: text("id").primaryKey(),
    sheetId: text("sheet_id")
      .notNull()
      .references(() => draftSheets.id, { onDelete: "cascade" }),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    /** The manager's own 1-based order within this sheet — the sheet's whole reason to exist
     *  (spec §4: "manual order always beats the board's"). Reassigned in full on every reorder
     *  write rather than stored as a float/gap sequence: a sheet tops out at a few hundred rows,
     *  so a full rewrite costs one small transaction and never accumulates float-precision drift. */
    rank: integer("rank").notNull(),
    /** A user-named tier header ("My tier 1"), or null for an entry with no tier band of its
     *  own — spec §4's "custom tiers with user-named headers." */
    tierLabel: text("tier_label"),
    note: text("note"),
    tag: draftSheetTagEnum("tag"),
  },
  (t) => [
    /** One row per player per sheet — re-ranking a player already on the sheet is an UPDATE,
     *  never a second row for the same man. */
    uniqueIndex("draft_sheet_entries_sheet_player_idx").on(t.sheetId, t.playerId),
    /** The sheet's own read: every entry in rank order, bounded to one sheet. */
    index("draft_sheet_entries_sheet_rank_idx").on(t.sheetId, t.rank),
  ],
);

/**
 * THE SIMULATOR'S OWN REPORTS (Draft HQ phase 2, spec §5, §10) — one row per requested sim, from
 * the moment a user (or the sync fast path) asks for one through its finished summary. Reuses
 * `jobStatusEnum` (`pending | running | succeeded | failed | abandoned`) rather than a second,
 * near-identical enum: a sim run's own lifecycle IS a job's lifecycle (`src/jobs/defs/sim-job.ts`
 * drives the transitions for every run above the sync-run threshold; the sync fast path writes
 * `succeeded` directly, skipping `pending`/`running` entirely since nothing else observes it
 * mid-flight).
 *
 * `configHash` is what makes a repeat request cheap: `src/draft-service/sim/store.ts`'s cache
 * lookup is `(user_id, config_hash, board_generation)` — SCOPED TO THE REQUESTING USER, a
 * deliberately narrower cache than a global one keyed on config alone. A sim's own numbers carry
 * no per-user fact (every input is league settings plus the shared evidence board), so a global
 * cache would be equally correct and would serve more repeats; the narrower scope was chosen so
 * a user's own "my recent sims" list (`sim_runs_user_idx`) and its cache hits are the same query
 * shape, and is recorded here as a real, if not maximal, choice rather than an oversight.
 */
export const simRuns = pgTable(
  "sim_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Null for a sim run against the generic (no-league) default settings — the same "generic"
     *  option `@research-ts/board/service`'s own board picker already offers. */
    leagueId: text("league_id").references(() => leagues.id, { onDelete: "cascade" }),
    /** The exact `SimConfig` this run was asked to compute (`@/draft-service/sim/types.ts`) —
     *  persisted so a stored run can be replayed byte-for-byte and so `configHash` below is
     *  always re-derivable from a row already in hand. */
    config: jsonb("config").$type<JsonObject>().notNull(),
    /** A stable hash of `config`, the cache key's first half. */
    configHash: text("config_hash").notNull(),
    /** The evidence board's own generation this run was computed against (`PreseasonProjectionRow.asOf`,
     *  ISO string) — the cache key's second half, so a board refresh naturally invalidates a stale
     *  cached run without a separate expiry policy. */
    boardGeneration: text("board_generation").notNull(),
    status: jobStatusEnum("status").notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** The computed `SimSummary` (`@/draft-service/sim/types.ts`) once `status` reaches
     *  `succeeded`; null before then and for a run that never finished. */
    summary: jsonb("summary").$type<JsonObject>(),
    /** Scrubbed failure text, mirroring `job_runs.error` — set only when `status` is `failed`. */
    error: text("error"),
  },
  (t) => [
    /** The cache lookup and "my recent sims" list share this index: newest first, scoped to one
     *  user, narrowed further by an equality filter on `configHash`/`boardGeneration` at query
     *  time for the cache path. */
    index("sim_runs_user_idx").on(t.userId, t.requestedAt),
    index("sim_runs_cache_idx").on(t.userId, t.configHash, t.boardGeneration),
    /**
     * Fix round 1, MEDIUM 1 — closes the check-then-act race `service.ts`'s own docblock now
     * names: two concurrent identical requests could both pass `findCachedRun` (nothing succeeded
     * yet) and `countInFlightSimRuns` (both read the budget before either's insert lands), and
     * both would create a genuinely duplicate in-flight run for the same work. AT MOST ONE
     * pending-or-running row may exist per `(user_id, config_hash, board_generation)` — the exact
     * "at most one OPEN X" shape `trade_proposals_open_fingerprint_idx` already uses for an open
     * trade proposal, applied here to an in-flight sim. The loser's insert raises a unique
     * violation `store.ts`'s `createSimRun` catches (`isUniqueViolation`, `@research-ts/db/errors`) and
     * answers with the WINNER's own row — a concurrent duplicate request joins the run already in
     * flight rather than erroring or starting a second one.
     */
    uniqueIndex("sim_runs_inflight_idx").on(t.userId, t.configHash, t.boardGeneration).where(sql`${t.status} in ('pending', 'running')`),
  ],
);

/**
 * THE PRECOMPUTED PEEK ROW (peek-facts design, 2026-09-07) — everything a player peek needs about a
 * player's position peers, stored once by the job that already computes it rather than recomputed
 * on every click.
 *
 * WHY A STORED ANSWER AND NOT A VIEW. A view is a saved query, and the population aggregation would
 * still run per open. The facts that cost the time are about LAST season (immutable once it ended)
 * and about THIS season's played weeks (they move once a week, when stats finalize). Those are the
 * two moments the job system already fires on, so the answer is computed by a job and stored, with
 * the `as_of`/`computed_at` stamps the point-in-time discipline needs and a materialized refresh
 * could not carry per row.
 *
 * WHAT IT COST BEFORE. Measured on production 2026-09-07 with the exact server function the peek
 * calls: 13.8 s and 73 queries for a receiver, 15.7 s and 69 for a back, because the peer population
 * handed to the color reads was the whole historical universe (3,293 receivers back to 1999) and the
 * reads under it were chunked `IN` lists over `player_week_observations`.
 *
 * ABSENCE IS A REAL ANSWER. A player with no row here (a new signing, or a fresh deploy before the
 * first sweep) renders his dossier as ABSENT, exactly as a player the board never ranked already
 * does. Nothing on this table is ever a stale or guessed stand-in for a fact that has not been
 * computed yet.
 *
 * KEYED ON THE PRODUCT PLAYER ID, not the nflverse one: the peek asks in the product's own id space
 * and this table is a product surface's cache, not an engine store. The crosswalk join stays where
 * it already is, inside the writer.
 */
export const playerPeekFacts = pgTable(
  "player_peek_facts",
  {
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    /** The product season these facts are FOR. The color facts inside describe the season before it,
     *  which `basis.priorSeason` states rather than leaves to arithmetic. */
    season: integer("season").notNull(),
    /** Everything the peek's dossier renders. See `PeekFactsRow.dossier` for why it is one blob. */
    dossier: jsonb("dossier").$type<PeekFactsRow["dossier"]>().notNull(),
    /** A PROJECTION of `dossier.lastSeasonStory.touchesRank`, promoted so an operator can ask this
     *  table how many players actually have a touches rank without opening every blob. Both halves
     *  are written by one function and pinned to agree by a test. `null` is the refusal: no touches
     *  evidence for him, or a population the writer would have had to invent to rank him against. */
    touchesRank: integer("touches_rank"),
    touchesQualifierCount: integer("touches_qualifier_count"),
    /** Which of the recent seasons the store holds at least one week of for him, newest first —
     *  what replaced the peek's three serial "does a prior season exist" round trips. */
    priorSeasonsHeld: integer("prior_seasons_held").array().notNull(),
    lastSeasonLine: jsonb("last_season_line").$type<PeekFactsRow["lastSeasonLine"]>(),
    /** Source keys, peer population size and every refusal, so no number on this row is a figure a
     *  reader has to take on faith. Never nullable. */
    basis: jsonb("basis").$type<PeekFactsRow["basis"]>().notNull(),
    /** THE STAMP: the moment these facts were knowable. Never `defaultNow()`, for the reason every
     *  other stamp in this engine is not. The peek reads the latest row with `as_of <= now`. */
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    /** When the pass ran. Operational only, never a filter. */
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    /** `PEEK_FACTS_SOURCE`. A later shape writes under a new one rather than overwriting rows a
     *  reader is already serving. */
    source: text("source").notNull(),
  },
  (t) => [
    /**
     * Identity of the fact: this player's peek facts for this season, as computed at this moment.
     * Re-running the writer at the same moment is a no-op rather than a duplicate.
     *
     * IT IS ALSO THE READ INDEX, deliberately, and there is no second one beside it. The peek's own
     * query is "this player, this season, newest `as_of` at or before now, limit one", whose
     * leading columns are exactly this key's — a separate non-unique index on the same three
     * columns in the same order would be a duplicate structure to maintain on every write and would
     * never be chosen over this one.
     */
    uniqueIndex("player_peek_facts_fact_idx").on(t.playerId, t.season, t.asOf),
  ],
);

/**
 * THE FINISHED PEEK DOCUMENT (peek document design §3.1, 2026-09-07) — one row per (season,
 * scoring hash, player, `as_of`), holding everything a player peek and the full player page draw
 * except the facts one league contributes live.
 *
 * WHY IT IS KEYED ON A SCORING HASH AND NOT ON A LEAGUE. A fantasy point is a property of a player
 * inside a rule set, so the only league-specific thing about these numbers is the rules that scored
 * them. Most leagues run one of a few presets, so a document keyed by `scoringHashOf(rules)` serves
 * every league that shares them: one shared build instead of one copy per league per player.
 *
 * WHAT IS DELIBERATELY NOT IN HERE, because it is joined at read time: the roster holder (a trade
 * changes no document), whether the room is a mock, and the league's own schedule length. The
 * reader's one statement applies all three.
 */
export const playerPeekDocuments = pgTable(
  "player_peek_documents",
  {
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    /** The product season this document is FOR. It carries EVERY season it can answer for inside
     *  `document.seasons`, so a season switch in the peek is a client-side flip with no fetch. */
    season: integer("season").notNull(),
    /** `scoringHashOf(the league's rules)` — see `leagues.scoring_hash`, which is what the peek's
     *  one statement joins on. */
    scoringHash: text("scoring_hash").notNull(),
    /** The complete body minus the live league facts. See `PeekDocument`. */
    document: jsonb("document").$type<PeekDocument>().notNull(),
    /** Which inputs and which of their stamps produced this document, promoted out of the blob so
     *  an operator can ask the table what a generation was built from without opening every row.
     *  Both halves are written by one function. Never nullable. */
    basis: jsonb("basis").$type<PeekDocumentBasis>().notNull(),
    /** THE STAMP: the moment these facts were knowable. Never `defaultNow()`, for the reason every
     *  other stamp in this engine is not. The peek reads the latest row with `as_of <= now`. */
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    /** When the build ran. Operational only, never a filter. */
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    /** `PEEK_DOCUMENT_SOURCE`. A later document shape writes under a new one rather than
     *  overwriting rows a reader is already serving. */
    source: text("source").notNull(),
  },
  (t) => [
    /**
     * Identity of the document, and ALSO the read index, exactly as `player_peek_facts` has it. The
     * peek's own query equals on the first three columns and takes the newest `as_of` at or before
     * now, whose leading columns are this key's in this order, so a second non-unique index beside
     * it would be a duplicate structure maintained on every write and never chosen over this one.
     */
    uniqueIndex("player_peek_documents_document_idx").on(t.season, t.scoringHash, t.playerId, t.asOf),
  ],
);
