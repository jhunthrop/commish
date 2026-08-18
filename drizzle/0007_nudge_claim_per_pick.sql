-- The moderator's "already nudged this turn" claim is re-keyed from the action sequence to the
-- pick number. A SET_QUEUE bumps `sequence` without starting a new turn (by design — editing a
-- queue must never touch a clock), so a sequence-keyed claim released mid-turn. Existing rows
-- hold sequence numbers, which are not pick numbers, so they are discarded rather than
-- reinterpreted; the worst case is one extra nudge on a turn that is in flight right now.
DELETE FROM "draft_nudges";--> statement-breakpoint
ALTER TABLE "draft_nudges" DROP CONSTRAINT "draft_nudges_draft_id_sequence_pk";--> statement-breakpoint
ALTER TABLE "draft_nudges" ADD COLUMN "pick_number" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_nudges" ADD CONSTRAINT "draft_nudges_draft_id_pick_number_pk" PRIMARY KEY("draft_id","pick_number");--> statement-breakpoint
ALTER TABLE "draft_nudges" DROP COLUMN "sequence";
