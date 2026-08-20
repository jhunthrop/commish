CREATE TABLE "integrity_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"flag_type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"league_id" text,
	"evidence" jsonb NOT NULL,
	"raised_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" text,
	"resolution" text,
	"resolution_note" text
);
--> statement-breakpoint
ALTER TABLE "integrity_flags" ADD CONSTRAINT "integrity_flags_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_flags" ADD CONSTRAINT "integrity_flags_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integrity_flags_open_subject_idx" ON "integrity_flags" USING btree ("subject_type","subject_id") WHERE "integrity_flags"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "integrity_flags_queue_idx" ON "integrity_flags" USING btree ("raised_at") WHERE "integrity_flags"."resolved_at" is null;