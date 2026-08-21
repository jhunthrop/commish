import {
  pgTable,
  pgEnum,
  text,
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
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import { AUDIT_EVENT_TYPES, type JsonObject } from "@/domain/audit";

export const experienceTierEnum = pgEnum("experience_tier", ["beginner", "experienced"]);
export const draftFormatEnum = pgEnum("draft_format", ["snake", "auction"]);
export const draftStatusEnum = pgEnum("draft_status", ["scheduled", "in_progress", "complete"]);
export const playerPositionEnum = pgEnum("player_position", ["QB", "RB", "WR", "TE", "K", "DEF"]);
export const weekStatusEnum = pgEnum("week_status", ["scheduled", "in_progress", "final"]);
export const helpLevelEnum = pgEnum("help_level", ["guided", "standard"]);
/**
 * The vocabulary is fixed by the spec and declared in full today (`@/domain/audit`): no later
 * plan adds a value, so no later migration ever runs `ALTER TYPE … ADD VALUE`. Contrast
 * `member_notices.notice_type` (Task 7), which every later plan extends and is therefore `text`.
 */
export const auditEventTypeEnum = pgEnum("audit_event_type", AUDIT_EVENT_TYPES);
export const auditActorTypeEnum = pgEnum("audit_actor_type", ["user", "system"]);
/**
 * A GIF is a `chat.message`, not a second event type (ruling 17): this is the ONE thing that
 * distinguishes the two rows shapes rather than inferring it from `gif_url` being non-null, so a
 * row can never be ambiguous mid-migration or under a future third kind.
 */
export const chatMessageKindEnum = pgEnum("chat_message_kind", ["text", "gif"]);

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
 * Plan D's, and a stored preference for a channel with no sender is a switch wired to nothing.
 * The day the sender exists, this table gains the column and the surface gains the toggles.
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
    commissionerUserId: text("commissioner_user_id")
      .notNull()
      .references(() => users.id),
    /** The league's roster shape. The draft reads this to know its rounds and slot rules. */
    rosterSlots: jsonb("roster_slots").$type<readonly RosterSlotConfig[]>().notNull().default([...STANDARD_ROSTER_SLOTS]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * PARTIAL, on purpose. `is_public_matchmade` is false for the overwhelming majority of
     * leagues (a league is private unless a commissioner opts in), and the only query that
     * reads this column reads `= true` and then orders by `created_at`. A partial index on
     * `created_at` over just those rows is therefore the smallest index that serves the
     * `WHERE is_public_matchmade` filter without a sequential scan of `leagues`.
     *
     * It does NOT let the browse `LIMIT` stop early on its own: `browseQuery` groups by league
     * (for the fill-count `HAVING`) before it orders, and the measured plan is
     * `Limit -> Sort (top-N heapsort) -> HashAggregate -> ...` — the `HashAggregate` destroys
     * whatever order the index scan produced, so `created_at` is re-sorted afterward regardless.
     * The index's payoff is entirely the filter, verified in `src/db/index-plans.test.ts`.
     *
     * There is deliberately NO index on `commissioner_user_id`: every read of it fetches the
     * league by primary key and compares in application code (`src/lib/leagues/membership.ts`,
     * `src/league-service/read.ts`). An index on a column nothing filters on is maintenance
     * cost with no read to pay for it. Add one the day a "leagues I commission" query exists.
     */
    index("leagues_public_browse_idx").on(t.createdAt).where(sql`${t.isPublicMatchmade}`),
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
});

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
  },
  (t) => [
    // UNIQUE, not a plain index: nothing else in the schema enforces "one draft per league",
    // and two live call sites already assume it — browse.ts's innerJoin (a second draft row
    // duplicates the league card and burns two of the browse LIMIT slots) and join.ts's
    // leftJoin + single-row read (an arbitrary draft row decides whether a join is accepted).
    // This converts that invariant-by-convention into an invariant-by-constraint before any
    // Phase 1 data exists to violate it.
    uniqueIndex("drafts_league_id_idx").on(t.leagueId),
    // The ticker scans every in_progress draft on a fixed interval — this is what makes
    // that scan an index lookup instead of a sequential scan as the table grows.
    index("drafts_status_idx").on(t.status),
  ],
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

export const weeks = pgTable(
  "weeks",
  {
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    weekNumber: integer("week_number").notNull(),
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
  },
  (t) => [primaryKey({ columns: [t.playerId, t.week] }), index("player_stat_lines_week_idx").on(t.week)],
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
