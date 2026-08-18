CREATE TABLE "league_invites" (
	"code" text PRIMARY KEY NOT NULL,
	"league_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lineup_slots" (
	"team_id" text NOT NULL,
	"week_number" integer NOT NULL,
	"slot" text NOT NULL,
	"slot_index" integer NOT NULL,
	"player_id" text,
	CONSTRAINT "lineup_slots_team_id_week_number_slot_slot_index_pk" PRIMARY KEY("team_id","week_number","slot","slot_index")
);
--> statement-breakpoint
ALTER TABLE "leagues" DROP CONSTRAINT "leagues_invite_code_unique";--> statement-breakpoint
ALTER TABLE "league_invites" ADD CONSTRAINT "league_invites_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_invites" ADD CONSTRAINT "league_invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineup_slots" ADD CONSTRAINT "lineup_slots_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "league_invites_league_id_idx" ON "league_invites" USING btree ("league_id");--> statement-breakpoint
ALTER TABLE "leagues" DROP COLUMN "invite_code";