CREATE TABLE "preseason_rankings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"source" text NOT NULL,
	"player_id" text NOT NULL,
	"rank" double precision NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preseason_rosters" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"team" text NOT NULL,
	"player_id" text NOT NULL,
	"position" text NOT NULL,
	"status" text NOT NULL,
	"birth_date" text,
	"draft_year" integer,
	"draft_pick" integer,
	"draft_club" text,
	"as_of" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "preseason_rankings" ADD CONSTRAINT "preseason_rankings_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preseason_rosters" ADD CONSTRAINT "preseason_rosters_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "preseason_rankings_fact_idx" ON "preseason_rankings" USING btree ("season","source","player_id","as_of");--> statement-breakpoint
CREATE INDEX "preseason_rankings_as_of_idx" ON "preseason_rankings" USING btree ("season","source","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "preseason_rosters_fact_idx" ON "preseason_rosters" USING btree ("season","player_id","as_of");--> statement-breakpoint
CREATE INDEX "preseason_rosters_as_of_idx" ON "preseason_rosters" USING btree ("season","as_of");