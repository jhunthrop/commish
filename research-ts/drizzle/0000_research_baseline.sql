CREATE TYPE "public"."board_moment_kind" AS ENUM('replay', 'live');--> statement-breakpoint
CREATE TYPE "public"."capsule_source" AS ENUM('llm', 'template');--> statement-breakpoint
CREATE TYPE "public"."player_position" AS ENUM('QB', 'RB', 'WR', 'TE', 'K', 'DEF');--> statement-breakpoint
CREATE TYPE "public"."week_status" AS ENUM('scheduled', 'in_progress', 'final');--> statement-breakpoint
CREATE TABLE "adp_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"source" text NOT NULL,
	"format" text NOT NULL,
	"adp" real NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capture_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"digest" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"team" text NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"start_week" integer NOT NULL,
	"end_week" integer NOT NULL,
	"source" text NOT NULL,
	"note" text NOT NULL,
	"head_coach" text,
	"head_coach_first_season" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coaches_role_ck" CHECK ("coaches"."role" IN ('HC', 'OC')),
	CONSTRAINT "coaches_source_ck" CHECK ("coaches"."source" IN ('wikipedia', 'pfr', 'both')),
	CONSTRAINT "coaches_weeks_ck" CHECK ("coaches"."start_week" >= 1 AND "coaches"."start_week" <= "coaches"."end_week"),
	CONSTRAINT "coaches_head_coach_pair_ck" CHECK (("coaches"."head_coach" IS NULL) = ("coaches"."head_coach_first_season" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "model_artifacts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"fit_stamp" timestamp with time zone NOT NULL,
	"fitted_on" text NOT NULL,
	"payload" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_artifacts_version_ck" CHECK ("model_artifacts"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "nfl_draft_picks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"round" integer NOT NULL,
	"pick" integer NOT NULL,
	"player_id" text NOT NULL,
	"position" text NOT NULL,
	"team" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nfl_games" (
	"game_id" text PRIMARY KEY NOT NULL,
	"week" integer NOT NULL,
	"home_nfl_team" text NOT NULL,
	"away_nfl_team" text NOT NULL,
	"game_date" text DEFAULT '' NOT NULL,
	"kickoff_et" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nfl_players" (
	"id" text PRIMARY KEY NOT NULL,
	"pfr_id" text,
	"espn_id" text,
	"name" text NOT NULL,
	"position" text NOT NULL,
	"latest_team" text,
	"rookie_season" integer,
	"last_season" integer
);
--> statement-breakpoint
CREATE TABLE "nflverse_injuries" (
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"player_id" text NOT NULL,
	"report_status" text NOT NULL,
	"primary_injury" text NOT NULL,
	"practice_status" text NOT NULL,
	"date_modified" timestamp with time zone,
	"source" text DEFAULT 'nflverse_injuries' NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nflverse_injuries_season_week_player_id_pk" PRIMARY KEY("season","week","player_id")
);
--> statement-breakpoint
CREATE TABLE "nflverse_kicking_weeks" (
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"player_id" text NOT NULL,
	"team" text NOT NULL,
	"fg_made" integer NOT NULL,
	"fg_att" integer NOT NULL,
	"fg_missed" integer NOT NULL,
	"fg_blocked" integer NOT NULL,
	"fg_made_0_19" integer NOT NULL,
	"fg_made_20_29" integer NOT NULL,
	"fg_made_30_39" integer NOT NULL,
	"fg_made_40_49" integer NOT NULL,
	"fg_made_50_59" integer NOT NULL,
	"fg_made_60" integer NOT NULL,
	"fg_missed_0_19" integer NOT NULL,
	"fg_missed_20_29" integer NOT NULL,
	"fg_missed_30_39" integer NOT NULL,
	"fg_missed_40_49" integer NOT NULL,
	"fg_missed_50_59" integer NOT NULL,
	"fg_missed_60" integer NOT NULL,
	"pat_made" integer NOT NULL,
	"pat_att" integer NOT NULL,
	"pat_missed" integer NOT NULL,
	"pat_blocked" integer NOT NULL,
	"source" text DEFAULT 'nflverse_kicking_weeks' NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nflverse_kicking_weeks_season_week_player_id_pk" PRIMARY KEY("season","week","player_id")
);
--> statement-breakpoint
CREATE TABLE "nflverse_roster_weeks" (
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"player_id" text NOT NULL,
	"team" text NOT NULL,
	"status" text NOT NULL,
	"status_detail" text DEFAULT '' NOT NULL,
	"position" text NOT NULL,
	"source" text DEFAULT 'nflverse_roster_weeks' NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nflverse_roster_weeks_season_week_player_id_pk" PRIMARY KEY("season","week","player_id")
);
--> statement-breakpoint
CREATE TABLE "nflverse_team_defense_weeks" (
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"team" text NOT NULL,
	"opponent_team" text NOT NULL,
	"def_sacks" real NOT NULL,
	"def_interceptions" integer NOT NULL,
	"fumble_recovery_opp" integer NOT NULL,
	"def_tds" integer NOT NULL,
	"def_safeties" integer NOT NULL,
	"def_punt_blocks" integer NOT NULL,
	"def_pat_blocks" integer NOT NULL,
	"def_fg_blocks" integer NOT NULL,
	"special_teams_tds" integer NOT NULL,
	"passing_yards_allowed" integer NOT NULL,
	"rushing_yards_allowed" integer NOT NULL,
	"sack_yards_lost_allowed" integer,
	"points_allowed" integer,
	"source" text DEFAULT 'nflverse_team_defense_weeks' NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nflverse_team_defense_weeks_season_week_team_pk" PRIMARY KEY("season","week","team")
);
--> statement-breakpoint
CREATE TABLE "player_capsules" (
	"player_id" text PRIMARY KEY NOT NULL,
	"facts_hash" text NOT NULL,
	"body_compact" text NOT NULL,
	"body_full" text NOT NULL,
	"source" "capsule_source" NOT NULL,
	"narrative" jsonb,
	"model" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_crosswalk" (
	"player_id" text PRIMARY KEY NOT NULL,
	"nfl_player_id" text,
	"method" text,
	"unmatched_reason" text,
	"resolved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "player_crosswalk_matched_ck" CHECK (("player_crosswalk"."nfl_player_id" IS NOT NULL AND "player_crosswalk"."method" IS NOT NULL AND "player_crosswalk"."unmatched_reason" IS NULL)
          OR ("player_crosswalk"."nfl_player_id" IS NULL AND "player_crosswalk"."method" IS NULL AND "player_crosswalk"."unmatched_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "player_prop_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"commence_time" timestamp with time zone NOT NULL,
	"bookmaker" text NOT NULL,
	"market" text NOT NULL,
	"player_name" text NOT NULL,
	"point" double precision NOT NULL,
	"over_price" integer NOT NULL,
	"under_price" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_stat_lines" (
	"player_id" text NOT NULL,
	"week" integer NOT NULL,
	"passing_yards" integer DEFAULT 0 NOT NULL,
	"passing_touchdowns" integer DEFAULT 0 NOT NULL,
	"interceptions" integer DEFAULT 0 NOT NULL,
	"rushing_yards" integer DEFAULT 0 NOT NULL,
	"rushing_touchdowns" integer DEFAULT 0 NOT NULL,
	"receiving_yards" integer DEFAULT 0 NOT NULL,
	"receiving_touchdowns" integer DEFAULT 0 NOT NULL,
	"receptions" integer DEFAULT 0 NOT NULL,
	"fumbles_lost" integer DEFAULT 0 NOT NULL,
	"field_goals_made" integer DEFAULT 0 NOT NULL,
	"extra_points_made" integer DEFAULT 0 NOT NULL,
	"sacks" real DEFAULT 0 NOT NULL,
	"defensive_interceptions" integer DEFAULT 0 NOT NULL,
	"defensive_touchdowns" integer DEFAULT 0 NOT NULL,
	"targets" integer DEFAULT 0 NOT NULL,
	"carries" integer DEFAULT 0 NOT NULL,
	"pass_attempts" integer DEFAULT 0 NOT NULL,
	"pass_completions" integer DEFAULT 0 NOT NULL,
	"field_goals_attempted" integer DEFAULT 0 NOT NULL,
	"points_allowed" integer DEFAULT 0 NOT NULL,
	"offensive_snaps" integer DEFAULT 0 NOT NULL,
	"offensive_snap_share" real DEFAULT 0 NOT NULL,
	"two_point_conversions" integer DEFAULT 0 NOT NULL,
	"field_goals_missed" integer DEFAULT 0 NOT NULL,
	"extra_points_missed" integer DEFAULT 0 NOT NULL,
	"kick_return_touchdowns" integer DEFAULT 0 NOT NULL,
	"punt_return_touchdowns" integer DEFAULT 0 NOT NULL,
	"yards_allowed" integer DEFAULT 0 NOT NULL,
	"defensive_fumbles_recovered" integer DEFAULT 0 NOT NULL,
	"safeties" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "player_stat_lines_player_id_week_pk" PRIMARY KEY("player_id","week")
);
--> statement-breakpoint
CREATE TABLE "player_week_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"player_id" text NOT NULL,
	"source" text NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_week_teams" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"player_id" text NOT NULL,
	"team" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"position" "player_position" NOT NULL,
	"nfl_team" text NOT NULL,
	"adp" real,
	"pos_adp" text,
	"headshot_url" text
);
--> statement-breakpoint
CREATE TABLE "preseason_board_reasons" (
	"source" text NOT NULL,
	"season" integer NOT NULL,
	"player_id" text NOT NULL,
	"code" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "preseason_board_reasons_source_season_player_id_code_detail_pk" PRIMARY KEY("source","season","player_id","code","detail")
);
--> statement-breakpoint
CREATE TABLE "preseason_projections" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"source" text NOT NULL,
	"player_id" text NOT NULL,
	"rank" integer NOT NULL,
	"position_rank" integer NOT NULL,
	"projected_points" double precision NOT NULL,
	"value_over_replacement" double precision NOT NULL,
	"value_rank" integer NOT NULL,
	"expected_games" double precision NOT NULL,
	"floor_points" double precision NOT NULL,
	"median_points" double precision NOT NULL,
	"ceiling_points" double precision NOT NULL,
	"tier" integer NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"moment_kind" "board_moment_kind" DEFAULT 'replay' NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preseason_rankings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"source" text NOT NULL,
	"player_id" text NOT NULL,
	"rank" double precision NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preseason_rosters" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"team" text NOT NULL,
	"player_id" text NOT NULL,
	"position" text NOT NULL,
	"status" text NOT NULL,
	"birth_date" text,
	"draft_year" integer,
	"draft_pick" integer,
	"draft_club" text,
	"as_of" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "props_player_map" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"prop_name" text NOT NULL,
	"season" integer NOT NULL,
	"player_id" text NOT NULL,
	"method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "register_freeze_rows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"frozen_at" timestamp with time zone NOT NULL,
	"player_id" text NOT NULL,
	"board_source" text NOT NULL,
	"board_as_of" timestamp with time zone NOT NULL,
	"board_points" double precision NOT NULL,
	"board_rank" integer NOT NULL,
	"board_value_rank" integer NOT NULL,
	"adp_rank" double precision,
	"ecr_rank" double precision,
	"props_points" double precision,
	"props_markets" jsonb
);
--> statement-breakpoint
CREATE TABLE "register_grade_rows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"frozen_at" timestamp with time zone NOT NULL,
	"graded_at" timestamp with time zone NOT NULL,
	"board_source" text NOT NULL,
	"player_id" text NOT NULL,
	"actual_points" double precision NOT NULL,
	"actual_rank" integer NOT NULL,
	"board_rank" integer NOT NULL,
	"adp_rank" integer,
	"ecr_rank" integer,
	"props_rank" integer
);
--> statement-breakpoint
CREATE TABLE "stat_weeks" (
	"week" integer PRIMARY KEY NOT NULL,
	"status" "week_status" DEFAULT 'scheduled' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"games_total" integer DEFAULT 0 NOT NULL,
	"games_final" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_week_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"team" text NOT NULL,
	"source" text NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "adp_snapshots" ADD CONSTRAINT "adp_snapshots_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfl_draft_picks" ADD CONSTRAINT "nfl_draft_picks_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nflverse_injuries" ADD CONSTRAINT "nflverse_injuries_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nflverse_kicking_weeks" ADD CONSTRAINT "nflverse_kicking_weeks_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nflverse_roster_weeks" ADD CONSTRAINT "nflverse_roster_weeks_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_capsules" ADD CONSTRAINT "player_capsules_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_crosswalk" ADD CONSTRAINT "player_crosswalk_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_crosswalk" ADD CONSTRAINT "player_crosswalk_nfl_player_id_nfl_players_id_fk" FOREIGN KEY ("nfl_player_id") REFERENCES "public"."nfl_players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_stat_lines" ADD CONSTRAINT "player_stat_lines_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_week_observations" ADD CONSTRAINT "player_week_observations_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_week_teams" ADD CONSTRAINT "player_week_teams_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preseason_board_reasons" ADD CONSTRAINT "preseason_board_reasons_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preseason_projections" ADD CONSTRAINT "preseason_projections_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preseason_rankings" ADD CONSTRAINT "preseason_rankings_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preseason_rosters" ADD CONSTRAINT "preseason_rosters_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "props_player_map" ADD CONSTRAINT "props_player_map_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_freeze_rows" ADD CONSTRAINT "register_freeze_rows_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_grade_rows" ADD CONSTRAINT "register_grade_rows_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adp_snapshots_player_idx" ON "adp_snapshots" USING btree ("player_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "adp_snapshots_player_source_captured_idx" ON "adp_snapshots" USING btree ("player_id","source","captured_at");--> statement-breakpoint
CREATE INDEX "capture_snapshots_source_captured_idx" ON "capture_snapshots" USING btree ("source","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coaches_tenure_idx" ON "coaches" USING btree ("season","team","role","start_week");--> statement-breakpoint
CREATE UNIQUE INDEX "model_artifacts_name_version_idx" ON "model_artifacts" USING btree ("name","version");--> statement-breakpoint
CREATE UNIQUE INDEX "nfl_draft_picks_fact_idx" ON "nfl_draft_picks" USING btree ("season","pick");--> statement-breakpoint
CREATE INDEX "nfl_draft_picks_player_idx" ON "nfl_draft_picks" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "nfl_games_week_idx" ON "nfl_games" USING btree ("week");--> statement-breakpoint
CREATE UNIQUE INDEX "nfl_players_pfr_id_idx" ON "nfl_players" USING btree ("pfr_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nfl_players_espn_id_idx" ON "nfl_players" USING btree ("espn_id");--> statement-breakpoint
CREATE INDEX "nflverse_injuries_player_season_idx" ON "nflverse_injuries" USING btree ("player_id","season","week");--> statement-breakpoint
CREATE INDEX "nflverse_kicking_weeks_player_season_idx" ON "nflverse_kicking_weeks" USING btree ("player_id","season","week");--> statement-breakpoint
CREATE INDEX "nflverse_kicking_weeks_team_season_idx" ON "nflverse_kicking_weeks" USING btree ("team","season","week");--> statement-breakpoint
CREATE INDEX "nflverse_roster_weeks_player_season_idx" ON "nflverse_roster_weeks" USING btree ("player_id","season","week");--> statement-breakpoint
CREATE INDEX "nflverse_team_defense_weeks_team_season_idx" ON "nflverse_team_defense_weeks" USING btree ("team","season","week");--> statement-breakpoint
CREATE UNIQUE INDEX "player_crosswalk_nfl_player_idx" ON "player_crosswalk" USING btree ("nfl_player_id");--> statement-breakpoint
CREATE INDEX "player_prop_observations_event_market_idx" ON "player_prop_observations" USING btree ("event_id","market");--> statement-breakpoint
CREATE INDEX "player_prop_observations_fetched_at_idx" ON "player_prop_observations" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "player_stat_lines_week_idx" ON "player_stat_lines" USING btree ("week");--> statement-breakpoint
CREATE UNIQUE INDEX "player_week_observations_fact_idx" ON "player_week_observations" USING btree ("season","week","player_id","source","metric","as_of");--> statement-breakpoint
CREATE INDEX "player_week_observations_as_of_idx" ON "player_week_observations" USING btree ("season","week","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "player_week_teams_fact_idx" ON "player_week_teams" USING btree ("season","week","player_id","team","as_of");--> statement-breakpoint
CREATE INDEX "player_week_teams_as_of_idx" ON "player_week_teams" USING btree ("season","week","as_of");--> statement-breakpoint
CREATE INDEX "players_position_idx" ON "players" USING btree ("position");--> statement-breakpoint
CREATE UNIQUE INDEX "preseason_projections_fact_idx" ON "preseason_projections" USING btree ("season","source","player_id","as_of");--> statement-breakpoint
CREATE INDEX "preseason_projections_as_of_idx" ON "preseason_projections" USING btree ("season","source","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "preseason_rankings_fact_idx" ON "preseason_rankings" USING btree ("season","source","player_id","as_of");--> statement-breakpoint
CREATE INDEX "preseason_rankings_as_of_idx" ON "preseason_rankings" USING btree ("season","source","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "preseason_rosters_fact_idx" ON "preseason_rosters" USING btree ("season","player_id","as_of");--> statement-breakpoint
CREATE INDEX "preseason_rosters_as_of_idx" ON "preseason_rosters" USING btree ("season","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "props_player_map_name_season_idx" ON "props_player_map" USING btree ("prop_name","season");--> statement-breakpoint
CREATE UNIQUE INDEX "register_freeze_rows_fact_idx" ON "register_freeze_rows" USING btree ("season","week","frozen_at","board_source","player_id");--> statement-breakpoint
CREATE INDEX "register_freeze_rows_week_idx" ON "register_freeze_rows" USING btree ("season","week","frozen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "register_grade_rows_fact_idx" ON "register_grade_rows" USING btree ("season","week","frozen_at","graded_at","board_source","player_id");--> statement-breakpoint
CREATE INDEX "register_grade_rows_season_idx" ON "register_grade_rows" USING btree ("season","week","graded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_week_observations_fact_idx" ON "team_week_observations" USING btree ("season","week","team","source","metric","as_of");--> statement-breakpoint
CREATE INDEX "team_week_observations_as_of_idx" ON "team_week_observations" USING btree ("season","week","as_of");