CREATE TABLE "nflverse_injuries" (
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"player_id" text NOT NULL,
	"report_status" text NOT NULL,
	"primary_injury" text NOT NULL,
	"practice_status" text NOT NULL,
	"date_modified" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'nflverse_injuries' NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nflverse_injuries_season_week_player_id_pk" PRIMARY KEY("season","week","player_id")
);
--> statement-breakpoint
ALTER TABLE "nflverse_injuries" ADD CONSTRAINT "nflverse_injuries_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nflverse_injuries_player_season_idx" ON "nflverse_injuries" USING btree ("player_id","season","week");