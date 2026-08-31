CREATE TABLE "injured_reserve" (
	"team_id" text NOT NULL,
	"player_id" text NOT NULL,
	"designation_at_placement" text NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "injured_reserve_team_id_player_id_pk" PRIMARY KEY("team_id","player_id")
);
--> statement-breakpoint
ALTER TABLE "injured_reserve" ADD CONSTRAINT "injured_reserve_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "injured_reserve" ADD CONSTRAINT "injured_reserve_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;