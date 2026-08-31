CREATE TABLE "preseason_board_reasons" (
	"source" text NOT NULL,
	"season" integer NOT NULL,
	"player_id" text NOT NULL,
	"code" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "preseason_board_reasons_source_season_player_id_code_pk" PRIMARY KEY("source","season","player_id","code")
);
--> statement-breakpoint
ALTER TABLE "preseason_board_reasons" ADD CONSTRAINT "preseason_board_reasons_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;