CREATE TYPE "public"."player_position" AS ENUM('QB', 'RB', 'WR', 'TE', 'K', 'DEF');--> statement-breakpoint
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
	"sacks" integer DEFAULT 0 NOT NULL,
	"defensive_interceptions" integer DEFAULT 0 NOT NULL,
	"defensive_touchdowns" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "player_stat_lines_player_id_week_pk" PRIMARY KEY("player_id","week")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"position" "player_position" NOT NULL,
	"nfl_team" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_stat_lines" ADD CONSTRAINT "player_stat_lines_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_stat_lines_week_idx" ON "player_stat_lines" USING btree ("week");--> statement-breakpoint
CREATE INDEX "players_position_idx" ON "players" USING btree ("position");