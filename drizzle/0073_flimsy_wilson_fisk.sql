CREATE TYPE "public"."capsule_source" AS ENUM('llm', 'template');--> statement-breakpoint
CREATE TABLE "player_capsules" (
	"player_id" text PRIMARY KEY NOT NULL,
	"facts_hash" text NOT NULL,
	"body_compact" text NOT NULL,
	"body_full" text NOT NULL,
	"source" "capsule_source" NOT NULL,
	"model" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_capsules" ADD CONSTRAINT "player_capsules_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;