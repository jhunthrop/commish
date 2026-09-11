CREATE TABLE "event_reactions" (
	"event_id" text NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_reactions_event_id_user_id_emoji_pk" PRIMARY KEY("event_id","user_id","emoji")
);
--> statement-breakpoint
ALTER TABLE "event_reactions" ADD CONSTRAINT "event_reactions_event_id_audit_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."audit_events"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reactions" ADD CONSTRAINT "event_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
