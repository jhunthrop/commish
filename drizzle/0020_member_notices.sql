CREATE TABLE "member_notices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"league_id" text,
	"notice_type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"context" jsonb NOT NULL,
	"audit_event_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "member_notices" ADD CONSTRAINT "member_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_notices" ADD CONSTRAINT "member_notices_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_notices_user_created_idx" ON "member_notices" USING btree ("user_id","created_at");