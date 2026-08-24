ALTER TABLE "drafts" ADD COLUMN "kickoff_rolls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "fill_fired_at" timestamp with time zone;