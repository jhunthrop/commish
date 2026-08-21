CREATE TABLE "session_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"accept_language" text,
	"ip_hash" text,
	"ip_source" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_signals" ADD CONSTRAINT "session_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_signals_user_occurred_idx" ON "session_signals" USING btree ("user_id","occurred_at");