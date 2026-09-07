CREATE TABLE "player_peek_facts" (
	"player_id" text NOT NULL,
	"season" integer NOT NULL,
	"dossier" jsonb NOT NULL,
	"touches_rank" integer,
	"touches_qualifier_count" integer,
	"prior_seasons_held" integer[] NOT NULL,
	"last_season_line" jsonb,
	"basis" jsonb NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_peek_facts" ADD CONSTRAINT "player_peek_facts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_peek_facts_fact_idx" ON "player_peek_facts" USING btree ("player_id","season","as_of");