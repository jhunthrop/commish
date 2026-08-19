CREATE TYPE "public"."week_status" AS ENUM('scheduled', 'in_progress', 'final');--> statement-breakpoint
CREATE TABLE "stat_weeks" (
	"week" integer PRIMARY KEY NOT NULL,
	"status" "week_status" DEFAULT 'scheduled' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"games_total" integer DEFAULT 0 NOT NULL,
	"games_final" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "lineup_slots_player_week_idx" ON "lineup_slots" USING btree ("player_id","week_number");--> statement-breakpoint
CREATE INDEX "roster_slots_player_idx" ON "roster_slots" USING btree ("player_id");