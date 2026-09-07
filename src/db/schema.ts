import {
  pgTable,
  pgEnum,
  text,
  char,
  integer,
  real,
  doublePrecision,
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
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import { AUDIT_EVENT_TYPES, type JsonObject } from "@/domain/audit";
import type { GradeComponents } from "@/draft-service/grades/engine";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { MONEY_ACCOUNT_KINDS } from "@/money/accounts";
import type { MoneyPostingDirection } from "@/money/posting";
import type { PrizeTable } from "@/money/prize-table";
import type { TransferIntent } from "@/payments-provider/contract";
import type { TradeAsset } from "@/trades/assets";

export const experienceTierEnum = pgEnum("experience_tier", ["beginner", "experienced"]);
export const draftFormatEnum = pgEnum("draft_format", ["snake", "auction"]);
/**
 * `"dissolved"` (Phase 4, Task 9, migration 0040) added to the END, on `0039`'s own precedent: a
 * value `ALTER TYPE ... ADD VALUE`s onto an existing Postgres enum can only ever append, never
 * insert — `@/domain/draft`'s own `DraftStatus` docblock carries the full reasoning for what this
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
export const playerPositionEnum = pgEnum("player_position", ["QB", "RB", "WR", "TE", "K", "DEF"]);
export const weekStatusEnum = pgEnum("week_status", ["scheduled", "in_progress", "final"]);
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
/**
 * Live-board round, Task 2, fix round (M8). `projections/preseason/source.ts`'s `BoardMoment` is a
 * closed, two-value discriminated union by design — not a vocabulary any later plan is expected to
 * extend casually the way `member_notices.notice_type` is (see that enum's own contrasting note) —
 * so it gets a real Postgres enum rather than the bare `text` column Task 2 originally shipped with
 * no value constraint at all. `preseason_projections.moment_kind` is its one consumer today.
 */
export const boardMomentKindEnum = pgEnum("board_moment_kind", ["replay", "live"]);

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

export const players = pgTable(
  "players",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    position: playerPositionEnum("position").notNull(),
    nflTeam: text("nfl_team").notNull(),
    /**
     * Average Draft Position from the configured stats provider's ADP feed (`listAdp`), written
     * by `ingestAdp` (`src/stats-pipeline/adp.ts`), never by the seed. NULLABLE and null by
     * default: a player the feed does not rank has no ADP, and `rankedPlayers`
     * (`src/draft-service/pool.ts`) sorts null-ADP players after every ranked one — which is the
     * industry meaning (lower ADP = drafted earlier) and what sinks fabricated demo players below
     * real NFL players when a real feed is configured. `real`, not `integer`: feeds publish
     * fractional positions ("1.6", "12.8").
     */
    adp: real("adp"),
    /** The market's position rank as the ADP feed words it ("RB1") — harvest widening 2026-08-30.
     *  Same single writer as `adp` (`ingestAdp`); NULL until that feed has spoken. */
    posAdp: text("pos_adp"),
    /**
     * Migration 0045 (founder directive 2026-08-26: "why aren't we showing the players picture?
     * we have the link don't we?"). Tank01's `/getNFLPlayerList` carries `espnHeadshot` per
     * player — `mapPlayerList` (`src/stats/tank01/map.ts`) reads it into this column, an ESPN CDN
     * `https://` URL. NULLABLE and null by default: a team defense has no headshot (there is no
     * "player" to photograph), and a player the feed doesn't carry a photo for renders the same
     * `Avatar` initials fallback every avatarless person in this product already gets — a missing
     * face is never a broken image. Refreshed, not excluded, on every seed re-run (see
     * `seed-players.ts`'s upsert set): unlike `adp`, this column has exactly one upstream source of
     * truth and no in-product writer of its own, so a stale or newly-added URL should always win.
     */
    headshotUrl: text("headshot_url"),
  },
  (t) => [index("players_position_idx").on(t.position)],
);

export const playerStatLines = pgTable(
  "player_stat_lines",
  {
    playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    week: integer("week").notNull(),
    passingYards: integer("passing_yards").notNull().default(0),
    passingTouchdowns: integer("passing_touchdowns").notNull().default(0),
    interceptions: integer("interceptions").notNull().default(0),
    rushingYards: integer("rushing_yards").notNull().default(0),
    rushingTouchdowns: integer("rushing_touchdowns").notNull().default(0),
    receivingYards: integer("receiving_yards").notNull().default(0),
    receivingTouchdowns: integer("receiving_touchdowns").notNull().default(0),
    receptions: integer("receptions").notNull().default(0),
    fumblesLost: integer("fumbles_lost").notNull().default(0),
    fieldGoalsMade: integer("field_goals_made").notNull().default(0),
    extraPointsMade: integer("extra_points_made").notNull().default(0),
    sacks: real("sacks").notNull().default(0),
    defensiveInterceptions: integer("defensive_interceptions").notNull().default(0),
    defensiveTouchdowns: integer("defensive_touchdowns").notNull().default(0),
    // The harvest block (2026-08-30): usage/context detail, 0 = not recorded (the mock dataset
    // and every row written before the widening). Scoring reads none of these yet.
    targets: integer("targets").notNull().default(0),
    carries: integer("carries").notNull().default(0),
    passAttempts: integer("pass_attempts").notNull().default(0),
    passCompletions: integer("pass_completions").notNull().default(0),
    fieldGoalsAttempted: integer("field_goals_attempted").notNull().default(0),
    pointsAllowed: integer("points_allowed").notNull().default(0),
    offensiveSnaps: integer("offensive_snaps").notNull().default(0),
    offensiveSnapShare: real("offensive_snap_share").notNull().default(0),
    // The scoring-vocabulary block (2026-08-30): every category ESPN's default sheet scores
    // that the box score carries directly. 0 = not recorded, same contract as the harvest block.
    twoPointConversions: integer("two_point_conversions").notNull().default(0),
    fieldGoalsMissed: integer("field_goals_missed").notNull().default(0),
    extraPointsMissed: integer("extra_points_missed").notNull().default(0),
    kickReturnTouchdowns: integer("kick_return_touchdowns").notNull().default(0),
    puntReturnTouchdowns: integer("punt_return_touchdowns").notNull().default(0),
    yardsAllowed: integer("yards_allowed").notNull().default(0),
    defensiveFumblesRecovered: integer("defensive_fumbles_recovered").notNull().default(0),
    safeties: integer("safeties").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.week] }), index("player_stat_lines_week_idx").on(t.week)],
);

/**
 * The NFL schedule, one row per fixture (founder, 2026-08-30: "why don't we have the schedule?
 * that's a core component"). `/getNFLGamesForWeek` was always fetched — the stats pipeline used
 * it to enumerate box scores, then threw the fixtures away. This table is where they now land,
 * so the product can say "@ KC · Sun 4:05 PM" beside a player instead of nothing.
 *
 * `gameDate` (YYYYMMDD) and `kickoffEt` ("4:05p") are kept in the source's own spelling rather
 * than a computed timestamp: NFL kickoffs are published in Eastern time, and a raw pair cannot
 * carry a timezone-conversion bug. Formatting is the display layer's job. Either may be empty
 * when the source omits it (the mock provider's derived fixtures, an unannounced flex game).
 */
export const nflGames = pgTable(
  "nfl_games",
  {
    /** Tank01's composite `YYYYMMDD_AWAY@HOME`, or the mock provider's deterministic id. */
    gameId: text("game_id").primaryKey(),
    week: integer("week").notNull(),
    /** NFL team abbreviations, matching `players.nfl_team`. */
    homeNflTeam: text("home_nfl_team").notNull(),
    awayNflTeam: text("away_nfl_team").notNull(),
    /** YYYYMMDD, as published; empty when the source did not say. */
    gameDate: text("game_date").notNull().default(""),
    /** Kickoff in Eastern, as published (e.g. "4:05p"); empty when the source did not say. */
    kickoffEt: text("kickoff_et").notNull().default(""),
    status: text("status", { enum: ["scheduled", "in_progress", "final"] }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("nfl_games_week_idx").on(t.week)],
);

/**
 * The ingestion state of record for one NFL week. One row per week, not per league: a week is
 * final when the NFL's games are over, which is a fact about the world rather than about any
 * league. Phase 1 already conflates league week number with NFL week number (`weeks.week_number`
 * indexes into `player_stat_lines.week` directly) and this table inherits that; a phase that runs
 * leagues on offset calendars is the phase that changes it.
 *
 * `version` is the rollup this table exists for, in the sense `docs/decisions/data-layer-
 * hardening.md` means: it is advanced in the SAME transaction as the stat-line writes it
 * summarizes, never after them and never on a schedule. It is what the computed-score cache keys
 * its freshness on, so a cache entry written against version 7 is discarded the instant version 8
 * commits. A version that could be advanced separately from its stat lines is a version that can
 * disagree with them, and a score cache that disagrees with the stats under it is worse than no
 * cache at all.
 *
 * The append-only source of truth remains `player_stat_lines`: this row is derived from it and
 * can be rebuilt from it, which is the second half of the same convention.
 */
export const statWeeks = pgTable("stat_weeks", {
  week: integer("week").primaryKey(),
  status: weekStatusEnum("status").notNull().default("scheduled"),
  /** Monotonic, advanced only on a tick that actually changed a stat line. */
  version: integer("version").notNull().default(0),
  gamesTotal: integer("games_total").notNull().default(0),
  gamesFinal: integer("games_final").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
 * THE HISTORICAL PLAYER UNIVERSE — every man who has ever taken an NFL snap, not the men on a
 * roster today (Phase 2, Task 1).
 *
 * Phase 1 keyed the projection store to `players`, which is a CURRENT roster snapshot fetched from
 * the stats provider, and measured what that costs: the nflverse crosswalk resolved 98.1% of the
 * 2024 season and 87.1% of 2023, degrading monotonically the further back a backfill reached,
 * because anyone who has since retired simply is not in a roster snapshot. Latavius Murray played
 * 2023; he is not on a 2026 roster; his season was therefore invisible. A model needs several
 * seasons, so a roster snapshot is the wrong spine for one.
 *
 * `id` is nflverse's `gsis_id` — the NFL's own player id, which every historical feed carries and
 * which never changes. That turns the whole identity problem from a NAME JOIN into an ID JOIN:
 * `stats_player_week` carries `gsis_id` directly, `snap_counts` carries `pfr_id` which this table
 * cross-references, and neither has to guess whether `Josh Palmer` and `Joshua Palmer` are one man.
 * The universe file itself carries TWO Josh Allens — a quarterback and a retired centre — which is
 * precisely the case a name join cannot settle and an id join never has to.
 *
 * Deliberately NOT linked to `players`. The projection engine models NFL players; mapping those to
 * the roster the product drafts from is a separate concern with its own failure modes, and it
 * belongs to whichever phase first renders a projection. An unused foreign key here would be a
 * guess at that mapping's shape, made years early.
 */
export const nflPlayers = pgTable(
  "nfl_players",
  {
    /** nflverse `gsis_id` (`00-0034857`) — the NFL's own id, stable for a career. */
    id: text("id").primaryKey(),
    /**
     * Pro Football Reference's id (`AlleJo02`). NULLABLE because the universe carries players PFR
     * never listed, and the unique index tolerates that: Postgres treats NULLs as distinct. It is
     * the ONLY way into the snap-counts file, which keys by `pfr_player_id` and carries no
     * `gsis_id` at all — so this column is what joins participation to outcomes.
     */
    pfrId: text("pfr_id"),
    /**
     * ESPN's own player id (`4362628`), migration 0051. NULLABLE, and null for a third of the
     * universe: the release carries one for 16,769 of its 25,066 people, essentially everyone ESPN
     * has ever built a page for and nobody else.
     *
     * THIS IS THE BRIDGE TO THE PRODUCT. `players.id` is the stats provider's own player id, and
     * the provider numbers players in ESPN's space — the same man is `4362628` in both. That makes
     * the crosswalk between the research corpus and the roster a league drafts from an ID JOIN,
     * which is the only kind this codebase accepts for identity (`players.ts` is scathing about
     * name joins and is right). `player_crosswalk` is the table it fills.
     *
     * The column was in the source file from the first backfill and was discarded by the mapper,
     * along with five other id spaces. It is read now because a phase finally needs it, which is
     * the same rule `nfl_players`' own docblock applies to the link it refused to guess at.
     */
    espnId: text("espn_id"),
    name: text("name").notNull(),
    /**
     * nflverse's own spelling (`QB`, `RB`, `WR`, `TE`, `FB`, `C`, …), NOT narrowed to this
     * product's `Position`. The universe holds linemen and fullbacks we never project, and storing
     * a narrowed enum would mean either dropping them (losing the snap denominator) or inventing a
     * position for a centre. `projectedPosition` (`src/projections/nflverse/players.ts`) does the
     * narrowing at the one place that needs it.
     */
    position: text("position").notNull(),
    /** Last team the release lists him on. Descriptive only — a player's team in a given WEEK comes
     *  from that week's own rows, never from here. */
    latestTeam: text("latest_team"),
    rookieSeason: integer("rookie_season"),
    lastSeason: integer("last_season"),
  },
  (t) => [
    /** The snap-counts join. Unique because two people sharing a PFR id would mean one man's snaps
     *  written onto another, silently and forever — the failure the Phase 1 crosswalk's coherence
     *  check was built to catch. Enforcing it here makes it a database error instead. */
    uniqueIndex("nfl_players_pfr_id_idx").on(t.pfrId),
    /** The same ruling as `pfr_id`'s, for the same reason and with more at stake: two people
     *  sharing an ESPN id would mean one man's expert consensus and one man's projection rendered
     *  on another man's screen. Measured on the live release before the index was written — 16,769
     *  ids, zero collisions — so this asserts a property the data already has. */
    uniqueIndex("nfl_players_espn_id_idx").on(t.espnId),
  ],
);

/**
 * THE POINT-IN-TIME STORE the projection engine rests on (Phase 1, Task 1 —
 * `docs/design/2026-08-27-projection-engine-spec.md`). Every fact the engine will ever learn from
 * lands here first, and `as_of` is why: it is the moment that fact became KNOWABLE, not the moment
 * we happened to write it down. A backtest replaying week 7 filters `as_of <= <kickoff>` and is
 * therefore structurally unable to read a number that did not exist yet.
 *
 * This is the one thing in the engine that cannot be retrofitted. Leakage is how projection work
 * fools itself — a single end-of-season column reachable from a mid-season replay makes the model
 * look brilliant and be worthless — and by the time the numbers look too good, every measurement
 * ever taken is suspect. Retrofitting `as_of` means rebuilding the store and re-ingesting
 * everything, because the stamp is not recoverable after the fact.
 *
 * NARROW AND TALL (one row per player-week-source-metric), not a wide per-week row, deliberately:
 * metrics arrive from different sources at different times — snap counts on Tuesday, a box score on
 * Sunday night, a stat correction the following Thursday — and a wide row forces a writer to know
 * every column at once, which it never does. It also means adding a metric is an INSERT rather than
 * a migration, and the engine is going to add metrics for years.
 *
 * A RESTATEMENT IS A NEW ROW, never an UPDATE. Tank01's Changelog corrects stat lines days later;
 * so does the NFL. Overwriting the original would quietly rewrite history and make every backtest
 * that ran before the correction unreproducible — the dishonest kind of quiet. Two rows, two
 * `as_of` stamps, and the reader picks the latest one it was allowed to see.
 */
export const playerWeekObservations = pgTable(
  "player_week_observations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    /**
     * An `nfl_players.id` (a `gsis_id`), NOT a `players.id`. Repointed in Phase 2, Task 1: keyed to
     * the current roster this table could only ever hold the seasons whose players are still
     * playing, which is not enough seasons to fit a model on. See `nflPlayers`' own docblock.
     */
    playerId: text("player_id")
      .notNull()
      .references(() => nflPlayers.id, { onDelete: "cascade" }),
    /** Which feed said it (`nflverse_snap_counts`, `nflverse_player_week`, `tank01`) — provenance,
     *  and the axis an ablation holds a whole source out on. */
    source: text("source").notNull(),
    /** Snake_case name of the quantity (`offensive_snaps`, `targets`, `receiving_yards`). Free
     *  text on purpose: see the narrow/tall note above. */
    metric: text("metric").notNull(),
    /** `double precision`, not `real`: this column holds counts, yards, shares and rates alike, and
     *  float4's ~7 significant digits are enough to make a share computed here disagree in the
     *  seventh place with the same share computed in TypeScript. A store the harness measures
     *  against should not introduce error of its own. */
    value: doublePrecision("value").notNull(),
    /** THE STAMP. When the fact became knowable — game end for a box score, release time for a
     *  weekly file, publication for a correction. NEVER `defaultNow()`: a default would silently
     *  stamp a backfill of 2019 with today, which is precisely the leak this table exists to
     *  prevent, so every writer must state it. */
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    /** When we wrote it down. Operational only — never a filter in a backtest. The gap between
     *  this and `as_of` is how far behind the ingestion is running. */
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Identity of a fact: this player's this metric from this source, as known at this moment.
     *  Re-running an ingestion is therefore a no-op rather than a duplicate, and `recordObservations`
     *  leans on it for idempotency instead of asking the caller to track what it already sent. */
    uniqueIndex("player_week_observations_fact_idx").on(t.season, t.week, t.playerId, t.source, t.metric, t.asOf),
    /** The hottest read in the engine by a wide margin: `observationsAsOf` scans exactly this range
     *  — one season, a week or a span of them, everything stamped at or before a moment — once per
     *  replayed week, and a backtest replays every week of every season it can reach. */
    index("player_week_observations_as_of_idx").on(t.season, t.week, t.asOf),
  ],
);

/**
 * THE EPHEMERAL FEEDS, CAPTURED RAW — the one table in this product where waiting has a permanent
 * cost (Phase 1, Task 4b).
 *
 * Most of the projection engine's inputs can be backfilled whenever we like: nflverse publishes
 * historical archives, so participation, snap counts and play-by-play are always retrievable. These
 * cannot. Injury designations, depth charts, ADP as it drifts through the preseason, weekly DFS
 * salaries, the betting line as it stood before kickoff, the news wire — every one is a CURRENT
 * snapshot with no history endpoint anywhere. Not ours, not the vendor's. A week this job does not
 * run is a week of training data that does not exist and cannot be bought later.
 *
 * WHY THE RAW BODY AND NOT PARSED FEATURES. The irreversible thing is the observation, never the
 * interpretation: a mapper written today against a shape nobody has seen (there is no API key yet)
 * would produce confident garbage, while the bytes it misread would still be right here to remap
 * the day the key arrives. Storing the response verbatim decouples "do not lose this" — which is
 * urgent — from "decide what it means", which is not. `player_week_observations` is derived from
 * this table and can be rebuilt from it; that is the same append-only-source-of-truth convention
 * `stat_weeks` follows over `player_stat_lines`.
 *
 * `captured_at` is when WE FETCHED IT, from the worker's injected clock — never the timestamp the
 * vendor puts inside the payload. We can only honestly claim to have known something at the moment
 * we saw it, and a vendor's own "as of" is a claim about their pipeline, not about our knowledge.
 *
 * A row is written only when the payload's `digest` differs from the most recent row for that
 * source, so a daily poll of an unchanged injury report writes nothing. That loses no knowledge: a
 * point-in-time read asks for the latest snapshot at or before a moment, and an unchanged feed is
 * still correctly answered by the snapshot before it.
 */
export const captureSnapshots = pgTable(
  "capture_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Which feed — `tank01_injuries`, `tank01_betting_odds`. Matches `CAPTURE_FEEDS`. */
    source: text("source").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    /** SHA-256 of the canonical payload. The change detector, and cheaper than comparing jsonb. */
    digest: text("digest").notNull(),
    /** The upstream response, verbatim. `jsonb` rather than `text`: the same bytes, but queryable
     *  when a later phase writes the mapper, which is the entire point of keeping them. */
    payload: jsonb("payload").notNull(),
  },
  (t) => [
    /** Both reads this table has: "what is the newest snapshot for this source" (the change
     *  detector, every tick) and "what did we know as of a moment" (every future mapper). */
    index("capture_snapshots_source_captured_idx").on(t.source, t.capturedAt),
  ],
);

/**
 * WHICH OFFENCE A PLAYER WAS IN, WEEK BY WEEK — the edge `player_week_observations` deliberately
 * does not carry, and which every context feature needs.
 *
 * The observation store is player-keyed with team totals riding on each player's own row, and that
 * was the right call for layer 1: a player traded in October carries his new offence's volume with
 * him automatically, where a team-keyed lookup would hand him his old one. But layers 2 and 4 ask
 * questions that are ABOUT the team — how does this line block, how fast does this offence play,
 * who is the defence this week — and those cannot be answered without knowing whose offence a man
 * was in. Deriving it from the volume triple (as `fitLeagueTeamVolume` does to count team-weeks)
 * identifies a team-week but not a TEAM, so it cannot follow one across a season.
 *
 * A separate table rather than a column on the observations, because it is a different KIND of
 * fact: one row per player-week rather than one per metric, and a text value rather than a number.
 * Squeezing a team code into a `double precision` column would mean an integer nobody can read in
 * a query result, which is how a join silently goes wrong.
 *
 * `as_of` carries the same meaning and the same discipline as the observation store's: when the
 * fact became knowable, which for "he took a snap for Cleveland in week 6" is the end of that game.
 * A trade is therefore only visible to a replay AFTER the player has played a down for his new
 * team, which is the honest bound — the transaction wire is a Phase 4 concern, and until it exists
 * the engine may not pretend to have read it.
 */
export const playerWeekTeams = pgTable(
  "player_week_teams",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    /** An `nfl_players.id` (a `gsis_id`), matching `player_week_observations`. */
    playerId: text("player_id")
      .notNull()
      .references(() => nflPlayers.id, { onDelete: "cascade" }),
    /** The nflverse team abbreviation (`CLE`, `BUF`). Free text, as the store's metric names are. */
    team: text("team").notNull(),
    /** THE STAMP, meaning exactly what it means in `player_week_observations`. Never `defaultNow()`. */
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Identity of the fact, so a re-run of an ingestion is a no-op. A player can legitimately
     *  appear for two teams in one WEEK only if a feed is wrong, and then the two rows differ by
     *  `team` and both are kept for the operator to see rather than one silently winning. */
    uniqueIndex("player_week_teams_fact_idx").on(t.season, t.week, t.playerId, t.team, t.asOf),
    index("player_week_teams_as_of_idx").on(t.season, t.week, t.asOf),
  ],
);

/**
 * TEAM-LEVEL FACTS, POINT IN TIME — the same store as `player_week_observations`, one level up.
 *
 * Everything the context layers read lives here: the offensive line composite's four components,
 * situation-neutral pace and pass rate over expected, the opponent's adjusted defence, the implied
 * total and spread, the weather and the rest. Every one is a property of a TEAM in a WEEK and has
 * no player to hang on, and forcing them onto player rows would repeat one number across fifty
 * players and invite somebody to average it.
 *
 * The shape is copied from the player store on purpose rather than generalised into one table with
 * a nullable `player_id`: the two have different foreign keys, different natural indexes and
 * different write paths, and a nullable key is how a query that meant to read team rows quietly
 * reads a hundred thousand player rows too.
 *
 * `as_of` is the load-bearing column here more than anywhere else in the engine, because the
 * temptation in a context feature is enormous. A betting line for Sunday's game is knowable before
 * Sunday and a kickoff temperature is not, and the difference between them is invisible in the
 * value. The stamp is the only place that difference is recorded, so a feature derived from a fact
 * stamped at kickoff is structurally unable to reach a projection made the Tuesday before — which
 * is the correct outcome and one the ablation will report as "no effect" rather than hide.
 */
export const teamWeekObservations = pgTable(
  "team_week_observations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    /** The nflverse team abbreviation. Not a foreign key: teams relocate and rename, and a lookup
     *  table would have to be maintained for no read this engine performs. */
    team: text("team").notNull(),
    /** Which derivation said it (`nflverse_pbp`, `nflverse_schedule`, `commish_line`). */
    source: text("source").notNull(),
    /** Snake_case quantity (`pace_seconds_per_play`, `line_stuffed_rate`, `implied_team_total`). */
    metric: text("metric").notNull(),
    value: doublePrecision("value").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("team_week_observations_fact_idx").on(t.season, t.week, t.team, t.source, t.metric, t.asOf),
    /** The read every context feature performs: one season, a span of weeks, everything knowable at
     *  a moment — once per replayed week, for every week of every season the harness can reach. */
    index("team_week_observations_as_of_idx").on(t.season, t.week, t.asOf),
  ],
);

/**
 * THE WEEK-ONE ROSTER, AS IT STOOD BEFORE ANYBODY PLAYED — the one thing a preseason board cannot
 * do without and the one thing the rest of the store structurally cannot supply.
 *
 * Every other player fact in this engine becomes knowable when a game produces it. `player_week_teams`
 * says so in its own docblock: a man's team is only visible once he has taken a snap for it, which
 * for a preseason board is one whole season too late. A board built in August that did not know a
 * receiver had changed teams in March would be worse than useless, and deriving his new team from a
 * week-1 box score would read the future.
 *
 * nflverse's `weekly_rosters` release carries the real answer: every club's roster in week 1, with
 * the status the league assigned each man, plus the biography that never changes (birth date, draft
 * year, overall draft pick, drafting club). The NFL's final cutdown to 53 is a league-wide deadline
 * in the last days of August, so this snapshot describes a world that existed BEFORE the opener, and
 * `as_of` records that rather than the game day the file happens to be keyed to.
 *
 * ONE ROW PER PLAYER PER SEASON, not per week. A weekly roster table would be a second, parallel
 * `player_week_teams` with worse provenance for every week after the first; the week-1 snapshot is
 * the only one whose knowable-before-kickoff claim is true, so it is the only one stored.
 *
 * THE BIOGRAPHY LIVES HERE RATHER THAN ON `nfl_players` on purpose. `nfl_players` is a CURRENT
 * snapshot, upserted on every backfill — a 2023 board reading a draft class off it would be reading
 * a 2026 file. Carried per season, the same fact is stamped with the season it was true in, and a
 * backtest cannot reach a later restatement of it.
 */
export const preseasonRosters = pgTable(
  "preseason_rosters",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    season: integer("season").notNull(),
    /** The nflverse team abbreviation, matching `player_week_teams.team`. */
    team: text("team").notNull(),
    playerId: text("player_id")
      .notNull()
      .references(() => nflPlayers.id, { onDelete: "cascade" }),
    /** nflverse's own spelling, unnarrowed, exactly as `nfl_players.position` is. */
    position: text("position").notNull(),
    /**
     * Coarsened league status: `active`, `reserve`, `practice_squad` or `off_roster`.
     *
     * DELIBERATELY COARSER THAN THE FILE. nflverse distinguishes ACT from INA, and INA is decided
     * ninety minutes before kickoff — reading it here would smuggle a game-day fact into a stamp
     * that claims late August. The four values kept are all settled at the cutdown deadline, which
     * is what this row's `as_of` asserts. See `rosterStatusOf`.
     */
    status: text("status").notNull(),
    /** ISO `yyyy-mm-dd`, as text: a date column would be read back through the driver's timezone
     *  and an age computed from it would move by a day depending on where the process runs. */
    birthDate: text("birth_date"),
    /** The season he entered the league. Fixed at his draft and never restated. */
    draftYear: integer("draft_year"),
    /** OVERALL pick number (1 to ~262), not the round. A round is a coarsening of this, and the
     *  gap between pick 33 and pick 63 is most of a round's worth of intent. Null for the undrafted,
     *  which is a real and common status rather than a missing value. */
    draftPick: integer("draft_pick"),
    draftClub: text("draft_club"),
    /** THE STAMP. Cutdown day, never the game day the source file is keyed to, and never
     *  `defaultNow()`. See `week1RosterAsOf`. */
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("preseason_rosters_fact_idx").on(t.season, t.playerId, t.asOf),
    index("preseason_rosters_as_of_idx").on(t.season, t.asOf),
  ],
);

/**
 * THE MARKET AND THE CONSENSUS, AS THEY STOOD BEFORE A SEASON — the two benchmarks the engine spec
 * names and the two the repository did not have.
 *
 * `docs/research/2026-08-27-decision-quality.md` records the gap as its second-highest priority:
 * "There is no real average draft position anywhere in this repository. `players.adp` is a
 * current-value column with no history and no join to the historical player universe." Without a
 * dated market price, a board can only be scored against outcomes, and "we beat last season's points
 * per game" is a much weaker claim than "we beat what the room was actually paying".
 *
 * A DEDICATED TABLE RATHER THAN WEEK ZERO IN `player_week_observations`, and the reason is not
 * taste. `replayMomentsFor` derives week 1's replay moment as the maximum `as_of` of week 0 — which
 * today is the end of the prior season, exactly as intended. A preseason ranking written at week 0
 * would silently become that moment, moving every week-1 replay in the engine eight months forward
 * and admitting data none of the published measurements were taken under. The leak would look like
 * an improvement.
 *
 * `rank` is `double precision` because an average draft position is a fraction (1.4, 26.7) while an
 * expert consensus rank is an integer, and both belong in the column a scorer reads.
 */
export const preseasonRankings = pgTable(
  "preseason_rankings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    season: integer("season").notNull(),
    /** Which market or panel said it (`ffc_adp_ppr_12`, `fantasypros_ecr_ppr`). */
    source: text("source").notNull(),
    playerId: text("player_id")
      .notNull()
      .references(() => nflPlayers.id, { onDelete: "cascade" }),
    /** Lower is better, in whatever unit the source publishes. */
    rank: doublePrecision("rank").notNull(),
    /** THE STAMP: the day the source published this ranking, which for both benchmarks is inside
     *  the last week of the preseason. Never `defaultNow()`. */
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("preseason_rankings_fact_idx").on(t.season, t.source, t.playerId, t.asOf),
    index("preseason_rankings_as_of_idx").on(t.season, t.source, t.asOf),
  ],
);

/**
 * EVERY NFL DRAFT PICK — the ground truth `preseason/rookie-curve.ts` fits its points curve against.
 *
 * `preseason_rosters.draft_pick` already carries a pick number for a rookie season, and reusing it
 * was the first option this table's own module docblock considered. It does not reach far enough
 * back: this repository's roster backfill floor is `HISTORICAL_ROSTER_FLOOR` (`nflverse/rosters.ts`;
 * 2003 since fit-round Task 1, 2013 before it), which is a roster-availability limit, not a
 * draft-history one — the `draft_picks` release nflverse publishes carries every pick back to 1980,
 * keyed on the same `gsis_id` every other table here uses. A curve fit on nine draft classes and a
 * curve fit on twenty are different measurements, and the wider one is the one worth having a
 * dedicated table for.
 *
 * A DEDICATED TABLE RATHER THAN `player_week_observations`, for the exact reason
 * `preseason_rankings`' own docblock gives: a draft pick is a fact about a SEASON, not a WEEK, and
 * forcing it into week zero of the observation store risks the same silent-leak class that table's
 * docblock warns about — a fact meant to be read once, at a fixed pick, ending up folded into
 * whatever moment a different reader's week-0 lookup resolves to.
 *
 * `as_of` IS APPROXIMATE ON PURPOSE. The release does not carry the exact day of each pick, and the
 * NFL draft's three days always fall in April, so every row here is stamped the first of May of its
 * own `season` — always after the real pick, by at most a few weeks. Nothing in the engine reads
 * this table through the point-in-time gate today (`rookie-curve.ts`'s fit runs offline and bakes
 * its output into a committed file, exactly as `preseason/fitted.ts` does for every other prior), so
 * the approximation costs nothing yet; the column is carried anyway so a future point-in-time reader
 * never has to be invented from nothing.
 */
export const nflDraftPicks = pgTable(
  "nfl_draft_picks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** The draft year — a rookie's own pick season, and the season `rookie-curve.ts` reads his
     *  outcome from. */
    season: integer("season").notNull(),
    round: integer("round").notNull(),
    /** OVERALL pick number, 1-based. Never null: every row here is an actual selection, unlike
     *  `preseason_rosters.draft_pick`, which also has to represent "undrafted". */
    pick: integer("pick").notNull(),
    playerId: text("player_id")
      .notNull()
      .references(() => nflPlayers.id, { onDelete: "cascade" }),
    /** nflverse's own spelling, unnarrowed, exactly as `nfl_players.position` is. */
    position: text("position").notNull(),
    /** The drafting club's nflverse abbreviation. */
    team: text("team").notNull(),
    /** THE STAMP. See the module docblock: the first of May of `season`, an approximation. */
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One player per overall pick per season — the natural key, and what makes a re-ingestion a
     *  no-op rather than a duplicate. */
    uniqueIndex("nfl_draft_picks_fact_idx").on(t.season, t.pick),
    index("nfl_draft_picks_player_idx").on(t.playerId),
  ],
);

/**
 * THE OFFICIAL WEEKLY INJURY REPORT, ARCHIVED VERBATIM — the raw fact `availability/season-end.ts`
 * derives a "his season ended after week 4 (knee, placed on injured reserve)" claim from.
 *
 * `news/retrieve.ts`'s `mapInjuries` already turns this same release into ordinal
 * `player_week_observations` (a MODEL FEATURE: how bad is his outlook, as a number a fit can weigh).
 * This is a different job. A fact sheet needs the report's OWN WORDS — "Knee", "Out" — not the
 * ordinal a model prefers, and it needs every player the release names, not only the skill positions
 * `mapInjuries` narrows to for the projection engine. Two consumers, two shapes; forcing the fact
 * sheet to reverse-engineer a designation's text back out of an integer would be guessing at
 * something the source already said in plain words.
 *
 * ONE ROW PER (season, week, gsis_id), matching the release itself: measured against six seasons of
 * the real file (2009, 2015, 2018, 2020, 2023-2025), nflverse already collapses a player's week to a
 * single row — the rare exception (two 2024 rows, a designation revised mid-week) is resolved by
 * `mapInjuryRows` keeping the later `date_modified`, so this table only ever holds nflverse's OWN
 * latest word for that player-week, never two competing rows for a caller to disagree about.
 *
 * APPEND-ONLY BY UPSERT, NOT BY INSERT-ONLY. A re-ingested season's row for a week already stored is
 * an update in place keyed on the unique index below, not a second row and not silently discarded:
 * unlike `nfl_draft_picks` (a pick never changes once made), nflverse DOES occasionally republish a
 * week's designation, and `onConflictDoNothing` would freeze the first version an operator happened
 * to fetch. The archive is still append-only at the SEASON grain a `live-tables` reader cares about
 * — nothing here is ever deleted, and a corrected row still carries its own `date_modified`, so the
 * history of what nflverse said and when remains reconstructable from `ingested_at` order alone.
 *
 * `report_status` and `report_primary_injury` are stored EXACTLY as published, including the empty
 * string nflverse uses for "on the report, no game-status designation yet" — never null-coalesced
 * into a guess and never a step more specific than the source. See `season-end.ts`'s own docblock
 * for why upgrading "Knee" to "ACL" would be exactly the fabrication this table exists to prevent.
 */
export const nflverseInjuries = pgTable(
  "nflverse_injuries",
  {
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    playerId: text("player_id")
      .notNull()
      .references(() => nflPlayers.id, { onDelete: "cascade" }),
    /** The league's own game-status designation ("Out", "Questionable", "Doubtful", or "" when
     *  listed with none), verbatim — never the ordinal `news/retrieve.ts` maps it to. */
    reportStatus: text("report_status").notNull(),
    /** The report's own injury text ("Knee", "Hamstring"), or "" when none was published. Never
     *  narrowed or inferred to something more specific than these words. */
    primaryInjury: text("primary_injury").notNull(),
    /** The Wednesday-through-Friday practice designation, verbatim, or "" when not on the report. */
    practiceStatus: text("practice_status").notNull(),
    /** The league's own filing timestamp for this row — nflverse's `date_modified`, taken literally
     *  exactly as `news/retrieve.ts`'s `reportFiledAt` does for the same column.
     *
     *  NULLABLE since the 2025 release: nflverse dropped this column outright starting with
     *  `injuries_2025.csv` (measured against the live files; `season_type` was added the same
     *  release). An absent stamp is recorded as absent — `null`, never a fabricated "now" or a
     *  copy of `ingested_at` — because a manufactured timestamp would misrepresent WHEN the league
     *  filed the report, the one fact this column exists to preserve. See `injuries.ts`'s
     *  `mapInjuryRows` for which shape a given season's file is read as, and `recordInjuryRows` for
     *  how a null stamp is treated on re-ingestion (a null-stamped row is always taken to be the
     *  latest word for its player-week — see `changedRowWhere`'s docblock there — since a 2025+
     *  file carries no timestamp to compare two revisions by at all). */
    dateModified: timestamp("date_modified", { withTimezone: true }),
    /** Provenance: which release this row came from. Free text, matching the convention every other
     *  `source` column in this schema keeps, rather than a boolean nobody could extend. */
    source: text("source").notNull().default("nflverse_injuries"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** The natural key IS the primary key, deliberately — not a surrogate `bigserial` beside a
     *  unique index the way `nfl_draft_picks` carries one. This table's writer upserts on conflict
     *  (`recordInjuryRows`, `db/upsert.ts`'s `excludedSetFor`/`changedRowWhere`), and a serial `id`
     *  sitting outside the conflict target would itself be rewritten to a freshly-consumed sequence
     *  value on every re-ingested row — a surrogate key that changes under upsert is worse than
     *  none. `ingested_at` is deliberately excluded from the update set for the same reason
     *  `player_week_observations` never lets a re-run touch its own timestamp: it names when this
     *  fact was FIRST written down, not when it was last confirmed. */
    primaryKey({ columns: [t.season, t.week, t.playerId] }),
    /** `season-end.ts`'s read: every row for one player, one season, in week order. */
    index("nflverse_injuries_player_season_idx").on(t.playerId, t.season, t.week),
  ],
);

/**
 * THE OFFICIAL WEEKLY ROSTER STATUS, ARCHIVED VERBATIM — one row per (season, week, gsis_id), the
 * SECOND anchor `availability/season-end.ts` derives a season-ending absence from.
 *
 * WHY THIS EXISTS BESIDE `nflverse_injuries`. The weekly injury report only names a player while a
 * team is still filing a designation for him — see `season-end.ts`'s own docblock: once a man is
 * actually done for the year, teams routinely STOP filing him on the report at all, and he simply
 * VANISHES from it. Measured live against the 2025 release: Malik Nabers (00-0039337, NYG) tore his
 * ACL in week 5 and the injury report alone derives nothing for him past that gap — no row, no
 * evidence, `deriveSeasonEndingAbsence` correctly refuses rather than guesses. The weekly ROSTER,
 * unlike the injury report, is a census: nflverse's `weekly_rosters` release lists every man on
 * every club's roster every week, healthy or not, so a reserve-list placement is explicit and
 * durable for as long as the placement lasts — Nabers reads `RES` from week 5 through week 18 of
 * the same file. This table is that census, kept exactly as published, so a gap in the injury
 * report can be closed by a fact the roster never stopped stating.
 *
 * THE SAME RELEASE `preseason/rosters.ts` ALREADY READS, A DELIBERATELY DIFFERENT SLICE OF IT.
 * `rosters.ts`'s `mapWeek1Rosters` keeps ONLY week 1, coarsens the status to four buckets
 * (`RosterStatus`), and deliberately folds `INA` into `active` because a game-day inactive list is
 * knowable ninety minutes before kickoff and would leak a Sunday fact into a claim about the
 * cutdown. None of those choices belong here: this table archives EVERY week, VERBATIM, because a
 * season-ending derivation needs to see a status change mid-season (week 4 `ACT` -> week 5 `RES`),
 * not a snapshot of week 1 alone, and needs the league's own spelling rather than a bucket a later
 * consumer cannot un-coarsen.
 *
 * VOCABULARY OBSERVED IN THE REAL RELEASE (`status` column, `roster_weekly_2024.csv` and
 * `roster_weekly_2025.csv`, every row, both files): `ACT`, `INA`, `RES`, `DEV`, `CUT`, `RET`,
 * `EXE`, `TRC`, `TRD`, and a single stray `E01` (2024, one row). See
 * `availability/season-end.ts`'s `RESERVE_CLASS_STATUSES` for which of these count as a
 * reserve-list placement for the derivation, and why the set is narrower than `rosters.ts`'s own
 * `rosterStatusOf` default-case bucket.
 */
export const nflverseRosterWeeks = pgTable(
  "nflverse_roster_weeks",
  {
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    playerId: text("player_id")
      .notNull()
      .references(() => nflPlayers.id, { onDelete: "cascade" }),
    /** The club this week's row lists him with. nflverse's own team code, unmapped. */
    team: text("team").notNull(),
    /** The league's own roster-status code, verbatim ("ACT", "RES", "INA", "CUT", "DEV", …) — never
     *  coarsened, unlike `preseason_rosters`' `RosterStatus`. See the table docblock for the full
     *  observed vocabulary. */
    status: text("status").notNull(),
    /** nflverse's own spelling, unnarrowed, exactly as `nfl_players.position` and
     *  `nfl_draft_picks.position` are. */
    position: text("position").notNull(),
    /** Provenance: which release this row came from, matching every other `source` column's
     *  convention in this schema. */
    source: text("source").notNull().default("nflverse_roster_weeks"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** The natural key IS the primary key, deliberately — not a surrogate id — for the identical
     *  reason `nflverse_injuries` gives: this table's writer upserts on conflict
     *  (`recordRosterWeekRows`, `db/upsert.ts`'s `excludedSetFor`/`changedRowWhere`), and a
     *  surrogate rewritten on every re-ingested row would be worse than none. `ingested_at` is
     *  excluded from the update set for the same reason: it names when this fact was FIRST written,
     *  not when it was last confirmed. */
    primaryKey({ columns: [t.season, t.week, t.playerId] }),
    /** `season-end.ts`'s read: every row for one player, one season, in week order. */
    index("nflverse_roster_weeks_player_season_idx").on(t.playerId, t.season, t.week),
  ],
);

/**
 * THE HISTORICAL KICKING RECORD, one row per (season, week, kicker), exactly as the release
 * published it.
 *
 * WHY IT DID NOT ALREADY EXIST. `player_week_observations` is built by a mapper that reads the
 * skill-position columns of this same release family and nothing else, and `projectedPosition`
 * narrowed every row to QB, RB, WR or TE, so a kicker has never had a row anywhere in this store. A
 * preseason board that ranks kickers needs the four quantities a kicker's fantasy season decomposes
 * into — field-goal attempts, field-goal make rate, extra-point attempts, extra-point make rate —
 * and every one of them is in this file and nowhere else we hold.
 *
 * THE DISTANCE BUCKETS ARE STORED AND NOT YET SCORED, deliberately. The product's scoring shape
 * carries ONE flat field-goal weight and the live in-season feed carries no distance at all, so a
 * distance-weighted preset would be a projection nothing could ever be scored against. The history
 * does carry the buckets, storing them costs one column each, and not storing them would mean
 * re-ingesting thirteen seasons the day the scoring shape widens. `fg_made` is archived BESIDE the
 * buckets rather than derived from them, because a derived total that disagreed with the published
 * one would be silently wrong in exactly the direction nobody checks.
 *
 * REGULAR SEASON ONLY (`NFLVERSE_CONFIG.seasonType`), matching every other ingester in the adapter.
 */
export const nflverseKickingWeeks = pgTable(
  "nflverse_kicking_weeks",
  {
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    playerId: text("player_id")
      .notNull()
      .references(() => nflPlayers.id, { onDelete: "cascade" }),
    /** The club the row lists him with. nflverse's own team code, UNMAPPED — `team-codes.ts` is
     *  where a reader translates it, so this archive stays a verbatim copy of what was published. */
    team: text("team").notNull(),
    fieldGoalsMade: integer("fg_made").notNull(),
    fieldGoalsAttempted: integer("fg_att").notNull(),
    fieldGoalsMissed: integer("fg_missed").notNull(),
    fieldGoalsBlocked: integer("fg_blocked").notNull(),
    fieldGoalsMade0To19: integer("fg_made_0_19").notNull(),
    fieldGoalsMade20To29: integer("fg_made_20_29").notNull(),
    fieldGoalsMade30To39: integer("fg_made_30_39").notNull(),
    fieldGoalsMade40To49: integer("fg_made_40_49").notNull(),
    fieldGoalsMade50To59: integer("fg_made_50_59").notNull(),
    fieldGoalsMade60Plus: integer("fg_made_60").notNull(),
    fieldGoalsMissed0To19: integer("fg_missed_0_19").notNull(),
    fieldGoalsMissed20To29: integer("fg_missed_20_29").notNull(),
    fieldGoalsMissed30To39: integer("fg_missed_30_39").notNull(),
    fieldGoalsMissed40To49: integer("fg_missed_40_49").notNull(),
    fieldGoalsMissed50To59: integer("fg_missed_50_59").notNull(),
    fieldGoalsMissed60Plus: integer("fg_missed_60").notNull(),
    extraPointsMade: integer("pat_made").notNull(),
    extraPointsAttempted: integer("pat_att").notNull(),
    extraPointsMissed: integer("pat_missed").notNull(),
    extraPointsBlocked: integer("pat_blocked").notNull(),
    source: text("source").notNull().default("nflverse_kicking_weeks"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** The natural key IS the primary key, for the identical reason `nflverse_roster_weeks` gives:
     *  the writer upserts on conflict (`db/upsert.ts`'s `excludedSetFor`/`changedRowWhere`) and a
     *  surrogate rewritten on every re-ingested row would be worse than none. `ingested_at` is
     *  excluded from the update set by the writer, because it names when this fact was FIRST
     *  written and not when it was last confirmed. */
    primaryKey({ columns: [t.season, t.week, t.playerId] }),
    /** The component fit's own read: every week one kicker played, across the seasons it asks for. */
    index("nflverse_kicking_weeks_player_season_idx").on(t.playerId, t.season, t.week),
    /** The team-opportunity read: every kicking week a club produced, whoever kicked it. Attempts
     *  travel with the offense, so this index is the one a kicker's opportunity term walks. */
    index("nflverse_kicking_weeks_team_season_idx").on(t.team, t.season, t.week),
  ],
);

/**
 * THE HISTORICAL TEAM-DEFENSE RECORD, one row per (season, week, team), already in the frame a
 * fantasy defense is scored in.
 *
 * WHY THE PER-PLAYER FILE COULD NOT ANSWER THIS. `map.ts` deliberately refuses the per-person
 * defensive columns and is right to: a linebacker's three sacks are a fact about him, and summing a
 * roster's worth of them back into a team total would depend on every man on that defense having a
 * row in a file built for fantasy skill positions. The team release publishes the team's own totals
 * directly, which is the quantity being projected.
 *
 * YARDS ALLOWED IS COMPUTED AT INGEST, NEVER AT READ TIME. A row's `passing_yards` and
 * `rushing_yards` in the published file are that team's OWN offense. A fantasy defense is scored on
 * what it ALLOWED, which is the other row of the same game. `team-defense-weeks.ts` joins the pair
 * once and writes the result here under names that say whose yards they are. A later reader who got
 * that join backwards would produce a defense graded on how good its own offense was, and nothing
 * downstream would look wrong.
 *
 * POINTS ALLOWED WAS DELIBERATELY ABSENT AND IS NOW A NULLABLE COLUMN (migration 0079). The
 * original argument stood on `schedule.ts` already storing every game's score as team observations,
 * which is true for the FIT path and stays true: that join is untouched. It does not hold for a
 * product surface, because the observation store carries only the season in play, so a finished
 * season's defense weeks join to nothing and the whole history stops at the database boundary. Both
 * copies are written from the same `games.csv`, so they have one origin rather than two opinions.
 * See the column's own docblock.
 *
 * NO FOREIGN KEY, because a team code is not an `nfl_players.id`. The 32 synthetic universe rows
 * (`team-codes.ts`'s `teamDefenseUniverseId`) exist for the PROJECTION store's key, not for this
 * one: this table is an archive of a published file and is keyed the way the file is.
 */
export const nflverseTeamDefenseWeeks = pgTable(
  "nflverse_team_defense_weeks",
  {
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    /** nflverse's own team code, UNMAPPED, contemporary to the season (`STL`, `SD` and `OAK` all
     *  appear in the early seasons of the covered span). `team-codes.ts` translates on read. */
    team: text("team").notNull(),
    /** Who they played. Carried so the yards-allowed join stays auditable after the fact. */
    opponentTeam: text("opponent_team").notNull(),
    /** `real` and not `integer`: a shared sack is credited as a half in the published file. */
    sacks: real("def_sacks").notNull(),
    interceptions: integer("def_interceptions").notNull(),
    fumbleRecoveries: integer("fumble_recovery_opp").notNull(),
    defensiveTouchdowns: integer("def_tds").notNull(),
    safeties: integer("def_safeties").notNull(),
    puntBlocks: integer("def_punt_blocks").notNull(),
    extraPointBlocks: integer("def_pat_blocks").notNull(),
    fieldGoalBlocks: integer("def_fg_blocks").notNull(),
    specialTeamsTouchdowns: integer("special_teams_tds").notNull(),
    /** THE OPPONENT's passing yards in this game. See the table docblock. */
    passingYardsAllowed: integer("passing_yards_allowed").notNull(),
    /** THE OPPONENT's rushing yards in this game. */
    rushingYardsAllowed: integer("rushing_yards_allowed").notNull(),
    /**
     * THE OPPONENT's yards lost to sacks in this game, so yards allowed can be stated NET the way
     * a box score states it (gross passing minus sack yardage, plus rushing). NULLABLE for rows
     * written before the column existed: a null leaves the yards-allowed tier unscored rather than
     * scored off a gross figure that lands a bracket too high. The next backfill fills it.
     */
    sackYardsLostAllowed: integer("sack_yards_lost_allowed"),
    /**
     * THE OPPONENT's final score in this game, from the schedule file, or NULL when that file had
     * no scoreline for the pairing.
     *
     * NULLABLE AND NOT `notNull`, deliberately: a defense week with no points allowed on it is a
     * week this archive cannot say what the defense gave up, and the points-allowed tier is then
     * left unscored rather than scored as a shutout. Zero is the single most flattering fabricated
     * number a defense row can carry, so it is the one this column must never invent.
     *
     * WHY IT IS HERE AT ALL, against the table docblock's original refusal. The refusal was right
     * about the FIT path, which reads `team_week_observations` and still does, untouched. It is
     * wrong about a product surface: the schedule observation store holds only the season in play,
     * so a reader asking what a defense allowed in a finished season joins to nothing there and a
     * kicker's and a defense's whole history stops at the database boundary. The column is filled
     * from the same `games.csv` those observations are themselves written from, so the two copies
     * have one origin and cannot drift apart on their own.
     */
    pointsAllowed: integer("points_allowed"),
    source: text("source").notNull().default("nflverse_team_defense_weeks"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.season, t.week, t.team] }),
    /** The component fit's own read: every defensive week one club produced. */
    index("nflverse_team_defense_weeks_team_season_idx").on(t.team, t.season, t.week),
  ],
);

/**
 * THE ONE EDGE BETWEEN THE TWO ID SPACES THIS PRODUCT HOLDS (migration 0051).
 *
 * `nfl_players`' own docblock refused to guess at this link and said who should draw it: "mapping
 * those to the roster the product drafts from is a separate concern with its own failure modes,
 * and it belongs to whichever phase first renders a projection." This is that phase. Everything
 * the engine knows is keyed to a gsis id and everything the product shows is keyed to the stats
 * provider's id, and until this table existed there was no join between them anywhere — which is
 * why a player's screen printed a dash where expert consensus and our own number belong.
 *
 * IT IS AN ID JOIN, NOT A NAME JOIN. The provider numbers players in ESPN's space and nflverse
 * publishes an `espn_id` for most of its universe, so the same man carries the same integer on
 * both sides and nothing has to guess. Measured on the live data the day it was built: 1,223 of
 * 1,647 league players, 74.3%. Set aside the 52 team defences and the 230 fabricated seed rows the
 * demo dataset carries and it is 1,223 of 1,365 real NFL players, 89.6% — and every one of the 444
 * players the market ranks resolved, which is the population any product surface actually draws.
 * The 11 pairs whose NAMES disagree across a matched id are the argument for the mechanism rather
 * than against it: every one is a nickname for the same person (`Hollywood Brown` against
 * `Marquise Brown`, `Joshua Palmer` against `Josh Palmer`), so a name join would have lost all
 * eleven while still having to guess at the 124 name-and-position collisions the universe holds.
 *
 * EVERY LEAGUE PLAYER GETS A ROW, matched or not. One row per `players.id`, always, so the table
 * is a census rather than a success list and the match rate is a query over it rather than a
 * number somebody remembered from a script run. An unmatched man is recorded with the reason he
 * could not be placed; he is never dropped, and he is never attached to somebody who happens to
 * share his name.
 *
 * NO `as_of`, DELIBERATELY, and this is the one table in the engine's neighbourhood where that is
 * correct. `universe.ts` states the rule: identity is not a fact that gets restated by a
 * Sunday-night correction. A stamp here would invite a reader to filter on it and silently drop
 * every player resolved after the moment it was asking about — a leakage defence turned into a
 * data-loss bug. The point-in-time discipline lives on the RANKING and the PROJECTION this table
 * leads to, both of which carry their own stamp.
 */
export const playerCrosswalk = pgTable(
  "player_crosswalk",
  {
    /** A `players.id` — the stats provider's id (`4362628`). One row per league player, always. */
    playerId: text("player_id")
      .primaryKey()
      .references(() => players.id, { onDelete: "cascade" }),
    /** The `nfl_players.id` (a gsis id) he is the same person as, or NULL when he could not be
     *  placed. `restrict` rather than `cascade`: a universe row vanishing under a live crosswalk
     *  is a bug upstream, and it should stop the delete rather than quietly unlink a player. */
    nflPlayerId: text("nfl_player_id").references(() => nflPlayers.id, { onDelete: "restrict" }),
    /** How he was placed (`espn_id`). NULL exactly when unmatched. Free text so a second mechanism
     *  can be added without a migration, and so a row always says which one placed it. */
    method: text("method"),
    /**
     * Why he could not be placed. NULL exactly when matched. One of `not_an_nfl_player` (a team
     * defence, which has no person and never will), `no_espn_id` (nobody in the universe carries
     * this id — a fringe or undrafted man the release has not listed, or a fabricated seed row) or
     * `ambiguous_espn_id` (two universe rows claim it, which the unique index upstream makes
     * impossible today and which is recorded rather than resolved if it ever happens).
     */
    unmatchedReason: text("unmatched_reason"),
    /** When the resolver last ran for this row. Operational only, never a filter — see the
     *  docblock on why this table has no `as_of`. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    /** A matched row states a method and no reason; an unmatched row states a reason and no
     *  method. Enforced here rather than in the writer because a half-filled row is the shape a
     *  silent drop takes, and the database is the only place every writer passes through. */
    check(
      "player_crosswalk_matched_ck",
      sql`(${t.nflPlayerId} IS NOT NULL AND ${t.method} IS NOT NULL AND ${t.unmatchedReason} IS NULL)
          OR (${t.nflPlayerId} IS NULL AND ${t.method} IS NULL AND ${t.unmatchedReason} IS NOT NULL)`,
    ),
    /** TWO LEAGUE PLAYERS MAY NOT BE THE SAME NFL PLAYER. The failure this whole table exists to
     *  prevent is one man's numbers rendered on another's screen, and collapsing two provider rows
     *  onto one gsis id is exactly how that happens. Postgres treats NULLs as distinct, so the
     *  unmatched are unaffected. */
    uniqueIndex("player_crosswalk_nfl_player_idx").on(t.nflPlayerId),
  ],
);

/**
 * WHERE THE BOARD LANDS (migration 0051) — the first table in this repository that holds a number
 * the model produced rather than a number somebody else published.
 *
 * `preseasonBoard` has been a pure function whose only callers print to a research document. That
 * was right while the question was "is it any good"; it is wrong now that the answer is yes
 * (`docs/research/2026-08-28-starter-band.md`). A rank correlation over a held-out season is a
 * fact about the BOARD; a manager looking at one receiver needs a fact about that receiver, and
 * nothing could give him one because the board did not survive the process that computed it.
 *
 * THE SHAPE IS `preseason_rankings`, deliberately and almost column for column. Our own board and
 * the two published benchmarks are the same KIND of object — one source's ordering of one season's
 * players, published at a moment — and the source strip on a player's screen sets all three beside
 * each other. Storing ours in a differently-shaped table would have made that comparison a
 * translation. `source` carries the same style of value the benchmarks use (`ffc_adp_ppr_12`,
 * `fantasypros_ecr_ppr`), naming both the model version and the format it was composed under,
 * because a projected point total is meaningless without the scoring rules that produced it.
 *
 * WIDE, WHERE `player_week_observations` IS NARROW AND TALL, and the difference is not taste. That
 * store is tall because its metrics arrive from different feeds at different times and no writer
 * ever knows every column at once. A board is the opposite: one process computes every column of
 * every row in one pass from one set of inputs, and splitting it into fourteen rows per player
 * would let a reader reassemble a projection whose points came from one run and whose rank came
 * from another.
 *
 * `as_of` IS THE PRESEASON MOMENT THE BOARD WAS TAKEN AT — `loadPreseason`'s own `moment`, which
 * is one millisecond before the earliest thing the season would reveal, and which that function
 * asserts the store against before it returns. It is not the time of the run. A projection is a
 * claim about the future made from a stated position in time, and a stamp of `now()` would erase
 * the only thing that makes the claim checkable. Two leakage defects have already been found in
 * this engine, both silent, both caught by audit rather than by a failure; a projection that could
 * not say what it was allowed to see would make a third one unfindable.
 */
export const preseasonProjections = pgTable(
  "preseason_projections",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    season: integer("season").notNull(),
    /** Which board said it — model version and league format together, as the benchmark sources
     *  name market and format together. `commish_board_v7_ppr_12` (the shipped, market-blended
     *  board; the fit-round of 2026-09-02 wrote v8 and v9 above it and neither cleared the held-out
     *  bar, so the constant points back at v7 until the 2025-outcomes round; see `board-store.ts`'s
     *  own `BOARD_SOURCE` docblock for the full v1-through-v9 history and both verdicts).
     *  `commish_board_v1_ppr_12` is the raw model's own historical source, kept for provenance. */
    source: text("source").notNull(),
    /** An `nfl_players.id` (a gsis id), the space the whole engine keys on. The product reaches it
     *  through `player_crosswalk`, never by name. */
    playerId: text("player_id")
      .notNull()
      .references(() => nflPlayers.id, { onDelete: "cascade" }),
    /** 1-based overall rank BY PROJECTED POINTS — the board's own order. Comparable to a published
     *  consensus rank, which is what the source strip sets it beside. */
    rank: integer("rank").notNull(),
    /** 1-based rank within his position, from the same order. */
    positionRank: integer("position_rank").notNull(),
    /** Season points under this row's stated scoring rules. */
    projectedPoints: doublePrecision("projected_points").notNull(),
    /** The draft-value view: points above this position's replacement level. Carried with its own
     *  rank because the board measured worse when ordered by it and better when it is offered as a
     *  labelled second reading — see `board.ts`. */
    valueOverReplacement: doublePrecision("value_over_replacement").notNull(),
    valueRank: integer("value_rank").notNull(),
    expectedGames: doublePrecision("expected_games").notNull(),
    /** Season points at the tenth, fiftieth and ninetieth percentiles of his games distribution.
     *  Honest about what it covers — availability — and silent about what it does not. */
    floorPoints: doublePrecision("floor_points").notNull(),
    medianPoints: doublePrecision("median_points").notNull(),
    ceilingPoints: doublePrecision("ceiling_points").notNull(),
    /** 0-based tier within his position, from `decide/tiers.ts`' gap rule. */
    tier: integer("tier").notNull(),
    /** THE STAMP: the preseason moment the board was taken at. Never `defaultNow()`, for the
     *  reason every other stamp in this engine is not. */
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    /** WHICH ARM OF `BoardMoment` (`projections/preseason/source.ts`) `asOf` came from — `'replay'`
     *  for a moment derived from a completed season, `'live'` for one taken before a season's own
     *  first kickoff. DEFAULT `'replay'` (Task 2, the live-board round) so the four historical
     *  seasons already in this table when the column was added mean exactly what they always meant,
     *  with no backfill required. The scorecard's own `assertGradableMoment` / `gradableInputs`
     *  (`preseason/scorecard.ts`) refuses to grade any row where this is `'live'` — there is no
     *  actual outcome yet for a season that has not been played. `boardMomentKindEnum` (fix round,
     *  M8) constrains the column's own values at the database, not merely in application code, the
     *  same guarantee every other closed vocabulary in this file gets.
     *
     *  NOT PART OF THE FACT IDENTITY BELOW (fix round, M7 — a deliberate omission, documented rather
     *  than silent). `preseason_projections_fact_idx` keys on `(season, source, player_id, as_of)`
     *  without `moment_kind`, and that is safe rather than an oversight: the two arms are
     *  TEMPORALLY EXCLUSIVE for one season. A REPLAY moment can only be DERIVED once `season` has
     *  game-derived data in the store (`preseasonMomentFor` throws otherwise); a LIVE moment can
     *  only be derived while `season`'s first kickoff is still in the future (`liveMomentFor` throws
     *  otherwise). No `season` can be in both states at once, so for a fixed `(season, source)` no
     *  `as_of` value could ever be written once under each kind — `moment_kind` is a fact ABOUT the
     *  row the identity already pins, never a second axis a row could vary along. Adding it to the
     *  index would cost a wider key for a collision that provably cannot occur. */
    momentKind: boardMomentKindEnum("moment_kind").notNull().default("replay"),
    /** When the fit ran. Operational only — the gap between this and `as_of` is how stale a board
     *  on a screen is, and it is never a filter. */
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Identity of the fact, matching `preseason_rankings_fact_idx`: this board's opinion of this
     *  player, as taken at this moment. Re-running the writer is a no-op rather than a duplicate,
     *  and a refit is a NEW row under a new `source` or a new stamp rather than an overwrite of a
     *  number somebody has already been shown. */
    uniqueIndex("preseason_projections_fact_idx").on(t.season, t.source, t.playerId, t.asOf),
    /** The read the product performs: one season, one board, everything knowable at a moment. */
    index("preseason_projections_as_of_idx").on(t.season, t.source, t.asOf),
  ],
);

/**
 * WHY A PLAYER SITS WHERE HE SITS ON ONE BOARD — the explanation surface `board-store.ts`'s own
 * docblock used to say was deliberately NOT stored yet (Task 7 lifts that). Every `BoardReason`
 * variant a board produced for a player is one row here: `code` is the union's own tag
 * (`board.ts`'s `BoardReason`), `payload` is every other field of that variant, verbatim.
 *
 * `detail` IS THE DISCRIMINATOR WITHIN A CODE (fix round, superseding Task 7's original PK). Every
 * code the board emits today is single-per-player EXCEPT `"law"`, which fires once per CONFIRMED
 * law whose condition holds — a receiver can trip `target_share_persistence` and
 * `wr_target_competition` at once, and a `(source, season, player_id, code)` PK could not hold both
 * rows. `detail` carries the law id for `"law"` rows and `''` for every other current variant, so
 * `(source, season, player_id, code, detail)` identifies exactly one reason and a player can carry
 * one row per confirmed law rather than the first one written winning silently.
 *
 * NOT VERSIONED BY MOMENT, unlike `preseason_projections` next door: no `as_of` here, so a rerun of
 * the same board replaces this table's opinion rather than adding a second, dated one. Reasons are
 * the CURRENT explanation for the CURRENT ranking, not a historical ledger a backtest replays — that
 * claim belongs to the ranks and points themselves, which `preseason_projections` already carries
 * under its own stamp.
 */
export const preseasonBoardReasons = pgTable(
  "preseason_board_reasons",
  {
    source: text("source").notNull(),
    season: integer("season").notNull(),
    /** An `nfl_players.id` — a gsis id, the same space every other board row keys on. */
    playerId: text("player_id")
      .notNull()
      .references(() => nflPlayers.id, { onDelete: "cascade" }),
    /** The `BoardReason` union's own discriminant — `"availability"`, `"law"`, and so on. */
    code: text("code").notNull(),
    /** The discriminator WITHIN `code` — a law id for `"law"` rows, `''` for every other variant
     *  today, since none of them can fire twice for the same player on the same board. */
    detail: text("detail").notNull().default(""),
    /** Every other field of that `BoardReason` variant, verbatim — `code` itself excluded. */
    payload: jsonb("payload").$type<JsonObject>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.source, t.season, t.playerId, t.code, t.detail] })],
);

/**
 * THE PLAYER-PROPS ARCHIVE — append-only, forward-looking, and deliberately NOT idempotent
 * (vegas-laws Task 6).
 *
 * Every other observation store in this file (`player_week_observations`, `team_week_observations`)
 * treats a repeated write as a no-op: the fact key is stable, so re-running an ingestion should not
 * duplicate it. A player prop line is not that kind of fact. The Over/Under a book posts on a
 * Tuesday and the number still up Friday morning are two DIFFERENT observations of the same
 * player-market-bookmaker pairing, and the line's own movement between them is exactly the signal a
 * later round (props-as-anchor measurement, deferred out of this round) will want to read.
 * Collapsing repeated snapshots onto one row the way `onConflictDoNothing` does elsewhere would
 * erase that movement, so this table carries no unique constraint on the fact key at all: a
 * repeated snapshot inserts new rows, stamped with its own `fetched_at`, and nothing here ever
 * updates or deletes a row. Deduping down to "the latest line before some moment" is a reader's job
 * for a later round, not this table's.
 *
 * `player_name` IS THE RAW STRING THE API RETURNS (an outcome's `description` field), not a
 * resolved `nfl_players.id`. Resolving names against the crosswalk is real work — suffixes,
 * nicknames, mid-season trades all need handling — and doing it half-heartedly here would make this
 * table lie about a name it could not actually match. The honest record is the string as given;
 * name resolution is the next round's problem, stated in the brief this table was built from.
 */
export const playerPropObservations = pgTable(
  "player_prop_observations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** The Odds API's own event id — stable across every snapshot of one game. */
    eventId: text("event_id").notNull(),
    commenceTime: timestamp("commence_time", { withTimezone: true }).notNull(),
    /** Bookmaker key as the API returns it — `draftkings`, `fanduel`, and so on. Every book a
     *  response carries is stored, not just one preferred book. */
    bookmaker: text("bookmaker").notNull(),
    /** One of the four verified markets — `player_pass_yds`, `player_reception_yds`,
     *  `player_receptions`, `player_rush_yds`. Free text, matching this store's sibling tables. */
    market: text("market").notNull(),
    /** The outcome's own `description` field, verbatim. See the table doc for why this is never
     *  resolved to a player id here. */
    playerName: text("player_name").notNull(),
    point: doublePrecision("point").notNull(),
    /** American odds — always an integer on this API. */
    overPrice: integer("over_price").notNull(),
    underPrice: integer("under_price").notNull(),
    /** When THIS snapshot run fetched the line. No default: the writer always states it
     *  explicitly, the same discipline `as_of` carries elsewhere in this file, so a row's stamp is
     *  never an accident of when Postgres happened to run the insert. */
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    /** The read this table serves today: per-event, per-market counts for one snapshot run's own
     *  report. */
    index("player_prop_observations_event_market_idx").on(t.eventId, t.market),
    index("player_prop_observations_fetched_at_idx").on(t.fetchedAt),
  ],
);

/**
 * THE NAME RESOLUTION `player_prop_observations` DEFERRED — props-backfill Task 1.
 *
 * One row per (raw prop name, season) that a name-matching pass resolved to an `nfl_players.id`.
 * Season-scoped rather than a single global name -> id map, because the same string can mean two
 * different people across the archive's own 2023-2025 span (a rookie debuting under a name a
 * retiree already held), and season-scoping is exactly the spine `preseason/benchmarks.ts`'s
 * `resolveRankings` already leans on for the identical class of name-join problem.
 *
 * A row here means MATCHED — a name the resolver could not place, ambiguously or not at all, is
 * never written; it is reported instead (`scripts/odds-props-resolve.ts`'s unmatched summary), the
 * same discipline `player_crosswalk`'s own builder keeps for the id-space join.
 */
export const propsPlayerMap = pgTable(
  "props_player_map",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** The archive's own `player_name`, verbatim — the join key back to `player_prop_observations`. */
    propName: text("prop_name").notNull(),
    season: integer("season").notNull(),
    playerId: text("player_id")
      .notNull()
      .references(() => nflPlayers.id, { onDelete: "restrict" }),
    /** How the match was made — `exact` (normalized full name, unique in the season) or `loose`
     *  (first-initial + surname, unique in the season). See `player-map.ts`'s own docblock. */
    method: text("method").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One resolution per name per season — a re-run of the resolver is idempotent, never a second,
     *  possibly-different, row for the same fact. */
    uniqueIndex("props_player_map_name_season_idx").on(t.propName, t.season),
  ],
);

/**
 * THE PROSPECTIVE REGISTER, HALF ONE: WHAT WAS CLAIMED, BEFORE THE WEEK COULD ANSWER (data-year
 * Task 1).
 *
 * Every measurement this engine has published is RETROSPECTIVE — a board rebuilt for a season that
 * has already been played, scored against outcomes that were sitting in the store the whole time.
 * The discipline around that is real (`BoardMoment`'s two arms, the `as_of` gate on every read,
 * `assertNothingFromTheSeasonIsVisible`), and it is still, structurally, a claim made after the
 * fact by a process that could in principle have seen the answer. 2026 is the first season this
 * repository can do the other thing: write down what four different opinions said about a week
 * BEFORE that week existed, and come back afterwards.
 *
 * AN ARCHIVE BY CONSTRUCTION. There is no `UPDATE` and no `ON CONFLICT DO UPDATE` anywhere in
 * `src/projections/register`, and no `DELETE` at all. A freeze taken again before kickoff is a NEW
 * `frozen_at` and a fresh set of rows; the earlier freeze's rows are not touched, not superseded
 * and not marked stale, because "what we said on Tuesday" does not stop being true when Wednesday
 * disagrees. That is the opposite of `preseason_projections`' live arm, which RETIRES its previous
 * generation on purpose (a board is a current claim about a moving roster, and yesterday's is a
 * stale answer to a question nobody asked). The register is not a current claim; it is a record of
 * claims, and the whole value of it is that the record cannot be edited afterwards.
 *
 * THE UNIQUE KEY IS THE IMMUTABILITY GUARANTEE, not a de-duplication convenience: two rows for one
 * player at one freeze instant would mean the register held two different answers to "what did the
 * board say at 12:00:00.000Z", and the writer inserts plainly so Postgres REFUSES that rather than
 * quietly keeping whichever landed first.
 *
 * THE FOUR COLUMNS, and why three of them are nullable. `board_*` is what the PRODUCT served,
 * read through `preseasonProjectionsAsOf` under `BOARD_SOURCE` rather than recomputed, so the row
 * records the claim a manager could actually have seen. `adp_rank`, `ecr_rank` and
 * `props_points` are the three benchmarks, and every one of them is genuinely absent for some
 * players in some weeks: a rookie nobody drafted has no average draft position, a panel does not
 * rank everybody, and a bookmaker posts props on a few hundred people a week. NULL IS NOT ZERO here
 * for the same reason it is not zero anywhere else in this store — a player with no line did not
 * have a line of zero, and scoring him as though he did would drag every benchmark's own agreement
 * number toward whatever the unlisted population happened to do.
 */
export const registerFreezeRows = pgTable(
  "register_freeze_rows",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    season: integer("season").notNull(),
    /** The REGULAR-SEASON week this freeze is a claim about. */
    week: integer("week").notNull(),
    /** THE FREEZE INSTANT — when the claim was written down, always strictly before this week's own
     *  first kickoff (`freeze.ts` refuses otherwise). Part of the row's identity, never a
     *  bookkeeping timestamp. */
    frozenAt: timestamp("frozen_at", { withTimezone: true }).notNull(),
    playerId: text("player_id")
      .notNull()
      .references(() => nflPlayers.id, { onDelete: "restrict" }),
    /** WHICH BOARD THIS ROW IS THE CLAIM OF — a value from `register/sources.ts`'s
     *  `REGISTER_BOARD_SOURCES`, stored rather than assumed, so a row stays readable after a round
     *  bumps whichever constant produced it.
     *
     *  PART OF THE ROW'S IDENTITY SINCE THE DUAL-TRACK RULING (Round D). One freeze instant now
     *  records EVERY tracked board's claim — the served one and each shadow — so `(season, week,
     *  frozen_at, player_id)` names a player twice at one instant and only this column tells the two
     *  apart. It is in the unique index below for that reason, and the register's no-update rule
     *  means a collision on it is still two different answers claimed for one board at one instant. */
    boardSource: text("board_source").notNull(),
    /** The stamp the served board row itself carried — the board's own moment, not the freeze's. */
    boardAsOf: timestamp("board_as_of", { withTimezone: true }).notNull(),
    boardPoints: doublePrecision("board_points").notNull(),
    boardRank: integer("board_rank").notNull(),
    boardValueRank: integer("board_value_rank").notNull(),
    /** Average draft position, fractional as the market publishes it. NULL where the market never
     *  priced this player. */
    adpRank: doublePrecision("adp_rank"),
    /** Expert consensus rank. NULL where the panel never ranked this player. */
    ecrRank: doublePrecision("ecr_rank"),
    /** The week's props consensus, priced into fantasy points under the register's own scoring
     *  rules. NULL where no book posted a line on this player for this week. */
    propsPoints: doublePrecision("props_points"),
    /** The median line per market behind `props_points` (`player_reception_yds` -> 70.5), kept so
     *  the derived number can always be checked against what the books actually posted. NULL
     *  exactly when `props_points` is. */
    propsMarkets: jsonb("props_markets").$type<JsonObject>(),
  },
  (t) => [
    /** One row per player per BOARD per freeze — see the table doc: this index IS the immutability
     *  rule, and `board_source` is in it because one instant carries every tracked board's claim. */
    uniqueIndex("register_freeze_rows_fact_idx").on(t.season, t.week, t.frozenAt, t.boardSource, t.playerId),
    /** The read grading performs: one week's freezes, latest first. */
    index("register_freeze_rows_week_idx").on(t.season, t.week, t.frozenAt),
  ],
);

/**
 * THE PROSPECTIVE REGISTER, HALF TWO: WHAT THE WEEK ANSWERED (data-year Task 1).
 *
 * One row per player per grading of one freeze. `frozen_at` is not decoration — it names the EXACT
 * freeze these ranks were computed from, so a week that was frozen twice can be graded against
 * either one and the two gradings can never be confused. `graded_at` is part of the identity for
 * the same reason `frozen_at` is on the other table: re-grading a week after a stat correction is a
 * SECOND, later statement, appended beside the first rather than overwriting it, so the record
 * shows both what we scored on Monday and what the corrected file said on Thursday.
 *
 * THE RANKS ARE PER-COLUMN AND SCOPED TO THAT COLUMN'S OWN COVERED POPULATION. A column that had no
 * opinion about a player (no ADP, no ECR, no props line) stores NULL rather than a rank invented for
 * him, and its own agreement number is computed over the players it actually spoke about. Mixing
 * those populations would let a benchmark look better simply by being quiet about hard players.
 *
 * `actual_points` and `actual_rank` are stored raw so every metric in `grade.ts` is DERIVABLE from
 * these rows alone. Nothing here stores a correlation or an error: a metric is a summary, summaries
 * change as the season lengthens, and a table that stored last week's summary would be a second
 * source of truth for a number the rows already contain.
 */
export const registerGradeRows = pgTable(
  "register_grade_rows",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    /** The exact `register_freeze_rows.frozen_at` these ranks came from. */
    frozenAt: timestamp("frozen_at", { withTimezone: true }).notNull(),
    /** When this grading ran, and the point-in-time bound its outcome read was taken at. */
    gradedAt: timestamp("graded_at", { withTimezone: true }).notNull(),
    /** Which board's claim was graded — the matching `register_freeze_rows.board_source`. One
     *  grading run scores every board the freeze recorded, so this is part of the identity for the
     *  same reason it is over there: without it, two boards' verdicts on one player collide. */
    boardSource: text("board_source").notNull(),
    playerId: text("player_id")
      .notNull()
      .references(() => nflPlayers.id, { onDelete: "restrict" }),
    /** What the player actually scored that week, under the register's own scoring rules. */
    actualPoints: doublePrecision("actual_points").notNull(),
    /** His place in the graded population by actual points, 1 = best. */
    actualRank: integer("actual_rank").notNull(),
    /** The board's own ordering of the graded population. Never null: the board is what defines
     *  the population. */
    boardRank: integer("board_rank").notNull(),
    /** Each benchmark's ordering of the players IT covered, or NULL where it covered nobody by
     *  that name. */
    adpRank: integer("adp_rank"),
    ecrRank: integer("ecr_rank"),
    propsRank: integer("props_rank"),
  },
  (t) => [
    uniqueIndex("register_grade_rows_fact_idx").on(t.season, t.week, t.frozenAt, t.gradedAt, t.boardSource, t.playerId),
    /** The read the running scoreboard performs: a whole season's gradings. */
    index("register_grade_rows_season_idx").on(t.season, t.week, t.gradedAt),
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
/** `"llm"` only when BOTH a capsule's sizes were freshly written and cleared the validator this
 *  run; `"template"` whenever either fell back to the deterministic floor — see
 *  `src/capsules/generate.ts`'s own docblock for why this stays one conservative flag rather than
 *  one per size. */
export const capsuleSourceEnum = pgEnum("capsule_source", ["llm", "template"]);

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
     *  option `@/draft-hq/board/service.ts`'s own board picker already offers. */
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
     * violation `store.ts`'s `createSimRun` catches (`isUniqueViolation`, `@/db/errors`) and
     * answers with the WINNER's own row — a concurrent duplicate request joins the run already in
     * flight rather than erroring or starting a second one.
     */
    uniqueIndex("sim_runs_inflight_idx").on(t.userId, t.configHash, t.boardGeneration).where(sql`${t.status} in ('pending', 'running')`),
  ],
);

/**
 * THE ADP TREND ARCHIVE (Draft HQ phase 2 Task 6, spec §10) — append-only, unlike
 * `preseason_rankings` (which a live season's re-ingest may delete-and-replace, per that table's
 * own docblock): the live-tables rule is that a writer which OVERWRITES a live claim must retire
 * it transactionally, and a table meant to grow a TREND must never be that writer. Every nightly
 * capture is a new row, never an update, so `adp_snapshots` is the one place this product can
 * ever answer "what was his ADP two weeks ago" — the market page phase 4 builds on this.
 *
 * `playerId` references `nfl_players`, the SAME id space `preseason_rankings`/`preseason_projections`
 * already key their own market/evidence rows on (`ADP_SNAPSHOT_CONFIG`'s own docblock,
 * `@/draft-service/adp-snapshot/ingest.ts`), because the feed this table captures is the identical
 * `fetchAverageDraftPosition` feed `market_anchor` already resolves through that same crosswalk —
 * one resolution path, not two.
 */
export const adpSnapshots = pgTable(
  "adp_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    playerId: text("player_id")
      .notNull()
      .references(() => nflPlayers.id, { onDelete: "cascade" }),
    /** Free text, matching `preseason_rankings.source`'s own convention (`ffc_adp_ppr_12`) —
     *  which market/format this snapshot came from. */
    source: text("source").notNull(),
    /** The scoring/team-count format the source's own board is drafted under (`ppr_12` today —
     *  the one format `BENCHMARK_SOURCES.adp`'s feed publishes). A future second format is a new
     *  value here, never a schema change. */
    format: text("format").notNull(),
    adp: real("adp").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** The trend read: one player's history over time, newest last. */
    index("adp_snapshots_player_idx").on(t.playerId, t.capturedAt),
    /** One capture per player per source per run — a re-run of the same night's job (a retry
     *  after a partial failure) must never double an already-written night's row. */
    uniqueIndex("adp_snapshots_player_source_captured_idx").on(t.playerId, t.source, t.capturedAt),
  ],
);

/**
 * THE PLAYER CAPSULE STORE (spec §9 AMENDED 2026-09-04, Task 3) — one row per player, LLM voice
 * over verified facts, mechanically validated. `factsHash` is the cache key: the sweep job
 * (`src/jobs/defs/capsule-sweep-job.ts`) recomputes a player's facts every run and regenerates
 * only when this hash has moved or the row is missing — never on a timer alone.
 *
 * TWO SIZES, ONE ROW (founder, live-fire review, "a competitor's player readout set the quality
 * bar"): `bodyCompact` is the bottom-sheet peek's own capsule (60-110 words), `bodyFull` is the
 * full player page's "Read" (180-280 words) — same facts, same writer/validator machinery, two
 * prompts. `source`/`model` describe the PAIR: `"llm"` only when both sizes were freshly written
 * and cleared the validator this run (`generate.ts`'s own conservative provenance rule); either
 * one falling back to the deterministic template marks the whole row `"template"`, and BOTH
 * columns then hold template text — a template's job is honesty and availability, not matching a
 * stylistic length band it was never trying to hit (see `template.ts`'s own docblock).
 *
 * NO player-id CASCADE FROM `nfl_players` — this keys on `players.id`, the product's own directory
 * (the same id space `player_stat_lines`/`injuries.ts`/the harvested news feed already join on),
 * never the historical projections engine's gsis id space `nfl_players`/`preseason_projections`
 * use. A capsule is a product-surface artifact, not a projection-engine one.
 */
export const playerCapsules = pgTable("player_capsules", {
  playerId: text("player_id")
    .primaryKey()
    .references(() => players.id, { onDelete: "cascade" }),
  factsHash: text("facts_hash").notNull(),
  bodyCompact: text("body_compact").notNull(),
  bodyFull: text("body_full").notNull(),
  source: capsuleSourceEnum("source").notNull(),
  /** `CAPSULE_MODEL` at generation time, or `null` for a `"template"`-sourced row — a template
   *  was never asked of any model. */
  model: text("model"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});
