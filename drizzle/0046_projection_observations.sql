CREATE TABLE "player_week_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"player_id" text NOT NULL,
	"source" text NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_week_observations" ADD CONSTRAINT "player_week_observations_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_week_observations_fact_idx" ON "player_week_observations" USING btree ("season","week","player_id","source","metric","as_of");--> statement-breakpoint
CREATE INDEX "player_week_observations_as_of_idx" ON "player_week_observations" USING btree ("season","week","as_of");