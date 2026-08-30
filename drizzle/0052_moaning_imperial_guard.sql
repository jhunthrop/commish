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
CREATE INDEX "nfl_games_week_idx" ON "nfl_games" USING btree ("week");