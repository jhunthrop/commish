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
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nfl_players" ADD COLUMN "espn_id" text;--> statement-breakpoint
ALTER TABLE "player_crosswalk" ADD CONSTRAINT "player_crosswalk_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_crosswalk" ADD CONSTRAINT "player_crosswalk_nfl_player_id_nfl_players_id_fk" FOREIGN KEY ("nfl_player_id") REFERENCES "public"."nfl_players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preseason_projections" ADD CONSTRAINT "preseason_projections_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_crosswalk_nfl_player_idx" ON "player_crosswalk" USING btree ("nfl_player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "preseason_projections_fact_idx" ON "preseason_projections" USING btree ("season","source","player_id","as_of");--> statement-breakpoint
CREATE INDEX "preseason_projections_as_of_idx" ON "preseason_projections" USING btree ("season","source","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "nfl_players_espn_id_idx" ON "nfl_players" USING btree ("espn_id");