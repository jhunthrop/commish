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
	"source" text DEFAULT 'nflverse_team_defense_weeks' NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nflverse_team_defense_weeks_season_week_team_pk" PRIMARY KEY("season","week","team")
);
--> statement-breakpoint
ALTER TABLE "nflverse_kicking_weeks" ADD CONSTRAINT "nflverse_kicking_weeks_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nflverse_kicking_weeks_player_season_idx" ON "nflverse_kicking_weeks" USING btree ("player_id","season","week");--> statement-breakpoint
CREATE INDEX "nflverse_kicking_weeks_team_season_idx" ON "nflverse_kicking_weeks" USING btree ("team","season","week");--> statement-breakpoint
CREATE INDEX "nflverse_team_defense_weeks_team_season_idx" ON "nflverse_team_defense_weeks" USING btree ("team","season","week");