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

export const experienceTierEnum = pgEnum("experience_tier", ["beginner", "experienced"]);
export const draftFormatEnum = pgEnum("draft_format", ["snake", "auction"]);
export const draftStatusEnum = pgEnum("draft_status", ["scheduled", "in_progress", "complete"]);
export const playerPositionEnum = pgEnum("player_position", ["QB", "RB", "WR", "TE", "K", "DEF"]);
export const weekStatusEnum = pgEnum("week_status", ["scheduled", "in_progress", "final"]);
export const helpLevelEnum = pgEnum("help_level", ["guided", "standard"]);
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
  },
  // The physical index also carries `INCLUDE (body)` — added by hand in
  // `drizzle/0018_chat_messages_covering_index.sql` because drizzle-orm's `index()` builder has
  // no `.include()` API to express it here. See that migration's own comment: widening this row
  // (0017's gif_* columns) tipped the planner off `chat_messages_league_id_idx` for a paginated
  // read and onto a much more expensive `chat_messages_pkey` scan-and-discard, which this
  // covering index (an Index-Only Scan once vacuumed) undoes. A future migration that drops and
  // recreates this index from THIS definition must re-add `INCLUDE (body)` by hand, the same way.
  (t) => [index("chat_messages_league_id_idx").on(t.leagueId, t.id)],
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
 * review disappear leaving nothing behind. Phase 3 owns the real audit log; this row is the
 * interim record it will read, not a second system it will have to reconcile.
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
 * A report is in-product moderation SIGNAL, not moderation ACTION (ruling 18: no admin role
 * exists to act on it in this phase). One row per reporter per review — the primary key is the
 * pair, so reporting twice is a no-op upsert (`onConflictDoNothing`) rather than a duplicate or
 * an error: reporting the same review again is the same report, not a second one.
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
