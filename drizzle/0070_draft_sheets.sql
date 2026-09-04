CREATE TYPE "public"."draft_sheet_tag" AS ENUM('target', 'avoid', 'never');--> statement-breakpoint
CREATE TABLE "draft_sheet_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"sheet_id" text NOT NULL,
	"player_id" text NOT NULL,
	"rank" integer NOT NULL,
	"tier_label" text,
	"note" text,
	"tag" "draft_sheet_tag"
);
--> statement-breakpoint
CREATE TABLE "draft_sheets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"league_id" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draft_sheet_entries" ADD CONSTRAINT "draft_sheet_entries_sheet_id_draft_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."draft_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_sheet_entries" ADD CONSTRAINT "draft_sheet_entries_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_sheets" ADD CONSTRAINT "draft_sheets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_sheets" ADD CONSTRAINT "draft_sheets_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_sheet_entries_sheet_player_idx" ON "draft_sheet_entries" USING btree ("sheet_id","player_id");--> statement-breakpoint
CREATE INDEX "draft_sheet_entries_sheet_rank_idx" ON "draft_sheet_entries" USING btree ("sheet_id","rank");--> statement-breakpoint
CREATE INDEX "draft_sheets_user_idx" ON "draft_sheets" USING btree ("user_id","created_at");