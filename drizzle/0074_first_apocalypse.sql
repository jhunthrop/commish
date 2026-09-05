CREATE TYPE "public"."draft_grade_letter" AS ENUM('A', 'B', 'C', 'D');--> statement-breakpoint
CREATE TABLE "draft_grades" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"draft_id" text NOT NULL,
	"league_id" text NOT NULL,
	"team_id" text NOT NULL,
	"letter" "draft_grade_letter" NOT NULL,
	"components" jsonb NOT NULL,
	"projected_rank" integer NOT NULL,
	"board_generation" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "draft_grades_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_grades" ADD CONSTRAINT "draft_grades_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_grades" ADD CONSTRAINT "draft_grades_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_grades" ADD CONSTRAINT "draft_grades_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_grades_draft_team_idx" ON "draft_grades" USING btree ("draft_id","team_id");--> statement-breakpoint
CREATE INDEX "draft_grades_draft_idx" ON "draft_grades" USING btree ("draft_id");