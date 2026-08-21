ALTER TABLE "chat_messages" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "removed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "removal_reason" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_removed_by_user_id_users_id_fk" FOREIGN KEY ("removed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "chat_message_reports" (
	"message_id" bigint NOT NULL,
	"reporter_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_message_reports_message_id_reporter_user_id_pk" PRIMARY KEY("message_id","reporter_user_id")
);
--> statement-breakpoint
ALTER TABLE "chat_message_reports" ADD CONSTRAINT "chat_message_reports_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_reports" ADD CONSTRAINT "chat_message_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-written, exactly as 0018 was and for the same reason: drizzle-orm's index() builder has no
-- .include() API, so a generated recreation of this index silently drops the clause. Widened with
-- the two removal columns the chat page now reads (ChatMessageView.removal). `removed_by_user_id`
-- is deliberately NOT included — see chat_messages' own comment in src/db/schema.ts.
-- src/db/index-plans.test.ts asserts this back out of pg_indexes rather than trusting this file to
-- still be what is on disk.
DROP INDEX "chat_messages_league_id_idx";--> statement-breakpoint
CREATE INDEX "chat_messages_league_id_idx" ON "chat_messages" USING btree ("league_id","id") INCLUDE ("body","removed_at","removal_reason");
