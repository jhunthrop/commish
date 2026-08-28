CREATE TABLE "nfl_players" (
	"id" text PRIMARY KEY NOT NULL,
	"pfr_id" text,
	"name" text NOT NULL,
	"position" text NOT NULL,
	"latest_team" text,
	"rookie_season" integer,
	"last_season" integer
);
--> statement-breakpoint
ALTER TABLE "player_week_observations" DROP CONSTRAINT "player_week_observations_player_id_players_id_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX "nfl_players_pfr_id_idx" ON "nfl_players" USING btree ("pfr_id");--> statement-breakpoint
ALTER TABLE "player_week_observations" ADD CONSTRAINT "player_week_observations_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;