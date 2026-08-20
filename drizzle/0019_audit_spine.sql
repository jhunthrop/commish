CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TYPE "public"."audit_event_type" AS ENUM('league_created', 'member_joined', 'draft_pick', 'draft_completed', 'lineup_change', 'roster_move', 'trade_proposed', 'trade_accepted', 'trade_rejected', 'flag_raised', 'flag_resolved', 'admin_action', 'system_action', 'session_started', 'profile_updated', 'review_removed');--> statement-breakpoint
CREATE TABLE "audit_chain_checkpoints" (
	"scope" text PRIMARY KEY NOT NULL,
	"verified_through_sequence" integer DEFAULT 0 NOT NULL,
	"verified_through_hash" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_chains" (
	"scope" text PRIMARY KEY NOT NULL,
	"head_sequence" integer DEFAULT 0 NOT NULL,
	"head_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"chain_scope" text NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" "audit_event_type" NOT NULL,
	"actor_id" text,
	"actor_type" "audit_actor_type" NOT NULL,
	"league_id" text,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"previous_event_hash" text NOT NULL,
	"event_hash" text NOT NULL,
	"hash_version" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_chain_checkpoints" ADD CONSTRAINT "audit_chain_checkpoints_scope_audit_chains_scope_fk" FOREIGN KEY ("scope") REFERENCES "public"."audit_chains"("scope") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_scope_sequence_idx" ON "audit_events" USING btree ("chain_scope","sequence");--> statement-breakpoint
CREATE INDEX "audit_events_league_occurred_idx" ON "audit_events" USING btree ("league_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_type_occurred_idx" ON "audit_events" USING btree ("actor_id","event_type","occurred_at");
--> statement-breakpoint
-- HAND-WRITTEN, appended after `drizzle-kit generate`. Drizzle has no trigger builder, exactly as
-- it has no `INCLUDE` builder (see 0018's note). A future migration that recreates this table must
-- re-add these two triggers by hand, the same way; `src/db/index-plans.test.ts` reads pg_trigger
-- back out of the catalog so a migration that forgets fails the build rather than the audit.
CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not permitted on this table', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
-- TRUNCATE is deliberately NOT blocked (ruling 26): a statement-level BEFORE TRUNCATE trigger
-- would break `truncateAll` and therefore every integration test in this repo, and TRUNCATE
-- already requires table ownership — a privilege level that can also DROP TABLE and
-- ALTER TABLE ... DISABLE TRIGGER. Blocking it would buy nothing against an attacker who already
-- has it, and would cost the test suite.