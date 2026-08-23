-- Phase 3.5, Tasks 6 and 7: authored together, in the one migration, per the binding controller
-- ruling for this migration — an applied migration is never edited, so Task 6's slot-preference
-- table and Task 7's sit-and-go trigger column are both authored here, complete, even though
-- Task 7's own read/write code lands in a later task. Hand-verified against `drizzle-kit
-- generate`'s own output, per the sibling migrations in this file's own history.
--
-- `draft_slot_preferences` (Task 6, NFFC's Kentucky Derby System): one row per team that has
-- ranked the draft slots it wants, an INPUT to the one-time draw whose OUTPUT is snapshotted
-- into `START_DRAFT.draftOrder` (ruling 27 — the same reason the player pool is a table and not
-- a draft action). `drafts.start_trigger` (Task 7): which of the two ways this draft's
-- `kickoff_at` came to be set, defaulting `'scheduled'` so every existing and hand-scheduled
-- draft is unaffected.
CREATE TYPE "public"."draft_start_trigger" AS ENUM('scheduled', 'when_full');--> statement-breakpoint
CREATE TABLE "draft_slot_preferences" (
	"draft_id" text NOT NULL,
	"team_id" text NOT NULL,
	"ranking" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_slot_preferences_draft_id_team_id_pk" PRIMARY KEY("draft_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "start_trigger" "draft_start_trigger" DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_slot_preferences" ADD CONSTRAINT "draft_slot_preferences_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_slot_preferences" ADD CONSTRAINT "draft_slot_preferences_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;