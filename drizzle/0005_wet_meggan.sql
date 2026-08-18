CREATE TABLE "draft_nudges" (
	"draft_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_nudges_draft_id_sequence_pk" PRIMARY KEY("draft_id","sequence")
);
--> statement-breakpoint
ALTER TABLE "draft_nudges" ADD CONSTRAINT "draft_nudges_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;