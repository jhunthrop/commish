CREATE TABLE "props_player_map" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"prop_name" text NOT NULL,
	"season" integer NOT NULL,
	"player_id" text NOT NULL,
	"method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "props_player_map" ADD CONSTRAINT "props_player_map_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "props_player_map_name_season_idx" ON "props_player_map" USING btree ("prop_name","season");