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
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";

export const experienceTierEnum = pgEnum("experience_tier", ["beginner", "experienced"]);
export const draftFormatEnum = pgEnum("draft_format", ["snake", "auction"]);
export const draftStatusEnum = pgEnum("draft_status", ["scheduled", "in_progress", "complete"]);
export const playerPositionEnum = pgEnum("player_position", ["QB", "RB", "WR", "TE", "K", "DEF"]);

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

export const leagues = pgTable("leagues", {
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
});

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
  (t) => [primaryKey({ columns: [t.teamId, t.weekNumber, t.slot, t.slotIndex] })],
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
  (t) => [primaryKey({ columns: [t.teamId, t.slot, t.slotIndex] })],
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
    index("drafts_league_id_idx").on(t.leagueId),
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
  (t) => [primaryKey({ columns: [t.leagueId, t.weekNumber, t.homeTeamId] })],
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
    sacks: integer("sacks").notNull().default(0),
    defensiveInterceptions: integer("defensive_interceptions").notNull().default(0),
    defensiveTouchdowns: integer("defensive_touchdowns").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.week] }), index("player_stat_lines_week_idx").on(t.week)],
);

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
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
