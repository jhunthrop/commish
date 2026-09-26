CREATE TABLE "draft_room_facts" (
	"draft_id" text PRIMARY KEY NOT NULL,
	"sequence" integer NOT NULL,
	"facts" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draft_room_facts" ADD CONSTRAINT "draft_room_facts_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;