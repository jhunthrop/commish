ALTER TABLE "preseason_board_reasons" ADD COLUMN "detail" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "preseason_board_reasons" DROP CONSTRAINT "preseason_board_reasons_source_season_player_id_code_pk";--> statement-breakpoint
ALTER TABLE "preseason_board_reasons" ADD CONSTRAINT "preseason_board_reasons_source_season_player_id_code_detail_pk" PRIMARY KEY("source","season","player_id","code","detail");
