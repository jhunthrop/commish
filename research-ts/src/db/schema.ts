import {
  pgTable,
  pgEnum,
  text,
  integer,
  real,
  doublePrecision,
  timestamp,
  jsonb,
  bigserial,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { JsonObject } from "@research-ts/domain/json";

/**
 * THE RESEARCH TABLES: everything the nightly run and the advisor read and write, owned by the
 * research core and migrated from `research-ts/drizzle` (spec §2.5, the two-schema rule). The league
 * app's tables live in `src/db/schema.ts` and reference these; nothing here references them.
 */
export const playerPositionEnum = pgEnum("player_position", ["QB", "RB", "WR", "TE", "K", "DEF"]);
export const weekStatusEnum = pgEnum("week_status", ["scheduled", "in_progress", "final"]);
/**
 * Live-board round, Task 2, fix round (M8). `projections/preseason/source.ts`'s `BoardMoment` is a
 * closed, two-value discriminated union by design — not a vocabulary any later plan is expected to
 * extend casually the way `member_notices.notice_type` is (see that enum's own contrasting note) —
 * so it gets a real Postgres enum rather than the bare `text` column Task 2 originally shipped with
 * no value constraint at all. `preseason_projections.moment_kind` is its one consumer today.
 */
export const boardMomentKindEnum = pgEnum("board_moment_kind", ["replay", "live"]);

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
    /**
     * The release's `status_description_abbr`, verbatim, `""` where the file carries none (the
     * 2013-2019 files leave it blank or `A01`/`I01` for most rows). THE ONLY PLACE A SUSPENSION IS
     * VISIBLE FROM 2021 ON (founder report 2026-09-08): the coarse `SUS` code carries suspensions
     * through 2020 and all but vanishes after; a suspended player since sits under `RES` with the
     * detail saying why (`R40` suspended by the commissioner for a stated term, `R30` indefinitely,
     * `R33` by his club; `R01`/`R48` are injured reserve, `R04` PUP, `R05` non-football injury).
     * `availability/week-classification.ts` reads it to keep a served suspension out of a player's
     * injury history. Measured on the real 2013-2025 files.
     */
    statusDetail: text("status_detail").notNull().default(""),
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
/** `"llm"` only when BOTH a capsule's sizes were freshly written and cleared the validator this
 *  run; `"template"` whenever either fell back to the deterministic floor — see
 *  `src/capsules/generate.ts`'s own docblock for why this stays one conservative flag rather than
 *  one per size. */
export const capsuleSourceEnum = pgEnum("capsule_source", ["llm", "template"]);

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
  /**
   * THE NARRATIVE (founder amendment 2026-09-07, "every peek sentence is written") — one JSON
   * object of named slots, each a validated short sentence a module renders in place of its own
   * template sentence (`capsules/narrative-slots.ts` holds the keys and the one accessor). Written
   * by the SAME sweep and keyed by the SAME `factsHash` as the two reads above, so it can never
   * describe a player from facts the reads no longer hold.
   *
   * NULLABLE, AND INDEPENDENT OF `source`. The narrative is a separate gateway call: it can fail
   * while both reads succeed, and a page with no narrative is a page of template sentences, which
   * is exactly what every one of those modules rendered before this column existed. Folding its
   * failure into `source` would flip two good reads to "template" over a sentence.
   */
  narrative: jsonb("narrative").$type<Record<string, string>>(),
  /** `CAPSULE_MODEL` at generation time, or `null` for a `"template"`-sourced row — a template
   *  was never asked of any model. */
  model: text("model"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * THE COACHES TABLE (coaches-table round, 2026-09-08): the curated play-caller file,
 * `data/play-callers/play-callers.csv`, as the server actually reads it.
 *
 * THE CSV STAYS THE SOURCE OF TRUTH. It is reviewed in the repo, every row cites its source, and
 * `scripts/validate-play-callers.ts` checks it. What changed is WHO reads it at request time:
 * nobody. The serverless bundle traces imported modules, not data files, and a request-path
 * `readFileSync` of the CSV threw ENOENT in production on the team page and the capsule sweep.
 * `npm run coaches:ingest` validates the file and upserts it here; the team page and the fact
 * sheet read this table through `src/coaches/store.ts`.
 *
 * One row per contiguous tenure, exactly as the CSV encodes it: `role` is the CSV's own
 * HC-or-OC claim about the man NAMED in `name`, and `team` is the CSV's own spelling for that
 * season (nflverse's, folded by every reader with `sourceTeamCode` as before). The head-coach
 * pair is NULL wherever the file is blank, which is every season nobody has sourced yet; a null
 * here is an honest absence, never a default.
 */
export const coaches = pgTable(
  "coaches",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    season: integer("season").notNull(),
    team: text("team").notNull(),
    /** `HC` or `OC`: whether the person named called the plays as head coach or coordinator. */
    role: text("role").notNull(),
    name: text("name").notNull(),
    startWeek: integer("start_week").notNull(),
    endWeek: integer("end_week").notNull(),
    /** `wikipedia`, `pfr` or `both`, the citation the CSV carries for this row. */
    source: text("source").notNull(),
    note: text("note").notNull(),
    headCoach: text("head_coach"),
    headCoachFirstSeason: integer("head_coach_first_season"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** The natural key: one tenure per role per team-season starting a given week. A re-ingest
     *  updates the row in place rather than duplicating it. */
    uniqueIndex("coaches_tenure_idx").on(t.season, t.team, t.role, t.startWeek),
    check("coaches_role_ck", sql`${t.role} IN ('HC', 'OC')`),
    check("coaches_source_ck", sql`${t.source} IN ('wikipedia', 'pfr', 'both')`),
    check("coaches_weeks_ck", sql`${t.startWeek} >= 1 AND ${t.startWeek} <= ${t.endWeek}`),
    /** The head-coach pair is filled together or blank together, the CSV parser's own rule. */
    check("coaches_head_coach_pair_ck", sql`(${t.headCoach} IS NULL) = (${t.headCoachFirstSeason} IS NULL)`),
  ],
);

/**
 * THE MODEL ARTIFACT STORE (file-sourced data round, 2026-09-09): every fitted table the engine
 * serves, keyed by artifact name and version, so a re-fit is a data write with an audit row and
 * the code never reads a module for numbers.
 *
 * WHY A TABLE AND NOT A GENERATED MODULE. A fitted table committed as TypeScript ships inside the
 * bundle, which is convenient right up to the moment a fit has to change what production serves
 * without a deploy, or a reviewer has to answer "which fit produced this board" from the store
 * that built it. Here a fit script publishes `(name, version)` once, immutably, with the moment the
 * fit ran and the window it was fit on; the code pins the version it was written against
 * (`src/projections/model/artifacts.ts`) and throws when the store lacks it, never falling back to
 * a number compiled into a module.
 *
 * THE REVIEWED RECORD STAYS IN THE REPOSITORY, under `data/model-artifacts/<name>/v<version>.json`,
 * exactly as the coaches CSV is the reviewed input to its ingest: `npm run artifacts:publish`
 * loads every committed record into whichever database `DATABASE_URL` names, and the server reads
 * only this table.
 *
 * `payload` is whatever shape the artifact's own parser accepts; the loader validates it on every
 * read rather than trusting the column.
 */
export const modelArtifacts = pgTable(
  "model_artifacts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** `<family>/<artifact>`, the key the code declares beside its pinned version. */
    name: text("name").notNull(),
    version: integer("version").notNull(),
    /** When the fit that produced this payload ran. Provenance, never a filter. */
    fitStamp: timestamp("fit_stamp", { withTimezone: true }).notNull(),
    /** The train window in the fit script's own words, for the audit row. */
    fittedOn: text("fitted_on").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** A version is immutable: the same name and version is one row, forever. */
    uniqueIndex("model_artifacts_name_version_idx").on(t.name, t.version),
    check("model_artifacts_version_ck", sql`${t.version} >= 1`),
  ],
);
