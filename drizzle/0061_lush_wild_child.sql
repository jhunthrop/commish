CREATE TABLE "nfl_draft_picks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"round" integer NOT NULL,
	"pick" integer NOT NULL,
	"player_id" text NOT NULL,
	"position" text NOT NULL,
	"team" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nfl_draft_picks" ADD CONSTRAINT "nfl_draft_picks_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nfl_draft_picks_fact_idx" ON "nfl_draft_picks" USING btree ("season","pick");--> statement-breakpoint
CREATE INDEX "nfl_draft_picks_player_idx" ON "nfl_draft_picks" USING btree ("player_id");