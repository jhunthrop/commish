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
	"player_id" text NOT NULL,
	"actual_points" double precision NOT NULL,
	"actual_rank" integer NOT NULL,
	"board_rank" integer NOT NULL,
	"adp_rank" integer,
	"ecr_rank" integer,
	"props_rank" integer
);
--> statement-breakpoint
ALTER TABLE "register_freeze_rows" ADD CONSTRAINT "register_freeze_rows_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_grade_rows" ADD CONSTRAINT "register_grade_rows_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "register_freeze_rows_fact_idx" ON "register_freeze_rows" USING btree ("season","week","frozen_at","player_id");--> statement-breakpoint
CREATE INDEX "register_freeze_rows_week_idx" ON "register_freeze_rows" USING btree ("season","week","frozen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "register_grade_rows_fact_idx" ON "register_grade_rows" USING btree ("season","week","frozen_at","graded_at","player_id");--> statement-breakpoint
CREATE INDEX "register_grade_rows_season_idx" ON "register_grade_rows" USING btree ("season","week","graded_at");