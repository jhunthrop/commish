CREATE TABLE "league_waivers" (
	"league_id" text NOT NULL,
	"player_id" text NOT NULL,
	"until" timestamp with time zone NOT NULL,
	CONSTRAINT "league_waivers_league_id_player_id_pk" PRIMARY KEY("league_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "waiver_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"league_id" text NOT NULL,
	"team_id" text NOT NULL,
	"add_player_id" text NOT NULL,
	"drop_player_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "waiver_priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "league_waivers" ADD CONSTRAINT "league_waivers_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_waivers" ADD CONSTRAINT "league_waivers_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_claims" ADD CONSTRAINT "waiver_claims_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_claims" ADD CONSTRAINT "waiver_claims_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_claims" ADD CONSTRAINT "waiver_claims_add_player_id_players_id_fk" FOREIGN KEY ("add_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waiver_claims_league_player_idx" ON "waiver_claims" USING btree ("league_id","add_player_id");