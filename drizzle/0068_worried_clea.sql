CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'abandoned');--> statement-breakpoint
CREATE TABLE "job_run_steps" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" bigint NOT NULL,
	"run_id" bigint NOT NULL,
	"step" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" bigint NOT NULL,
	"attempt" integer NOT NULL,
	"status" "job_status" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	"error_kind" text,
	"claimed_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"claimed_by" text,
	"heartbeat_at" timestamp with time zone,
	"schedule_name" text,
	"scheduled_for" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "schedule_cursors" (
	"schedule_name" text PRIMARY KEY NOT NULL,
	"last_evaluated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_run_steps" ADD CONSTRAINT "job_run_steps_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_run_steps" ADD CONSTRAINT "job_run_steps_run_id_job_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."job_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_run_steps_job_step_idx" ON "job_run_steps" USING btree ("job_id","step");--> statement-breakpoint
CREATE UNIQUE INDEX "job_runs_attempt_idx" ON "job_runs" USING btree ("job_id","attempt");--> statement-breakpoint
CREATE INDEX "job_runs_started_idx" ON "job_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_key_idx" ON "jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_status_run_at_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
-- APPEND-ONLY RUN HISTORY (spec section 2, on the 0019 audit-spine precedent). A `job_runs` row is
-- the record of one attempt: the CURRENT attempt may finish itself exactly once (UPDATE while the
-- old row still says 'running' — the pending-to-terminal transition), and a finished row may never
-- be rewritten. DELETE is never permitted. TRUNCATE is deliberately not blocked, for 0019's own
-- reason (ruling 26): it would break `truncateAll` and buys nothing against table ownership.
CREATE OR REPLACE FUNCTION job_runs_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'job_runs is append-only history: DELETE is not permitted on this table'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'running' THEN
    RAISE EXCEPTION 'job_runs is append-only history: a finished run (status %) may not be rewritten', OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER job_runs_no_rewrite BEFORE UPDATE ON job_runs
  FOR EACH ROW EXECUTE FUNCTION job_runs_append_only();
--> statement-breakpoint
CREATE TRIGGER job_runs_no_delete BEFORE DELETE ON job_runs
  FOR EACH ROW EXECUTE FUNCTION job_runs_append_only();
--> statement-breakpoint
-- The checkpoint log is stricter: a completed step is a fact, never edited at all.
CREATE OR REPLACE FUNCTION job_run_steps_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'job_run_steps is an append-only checkpoint log: % is not permitted on this table', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER job_run_steps_no_update BEFORE UPDATE ON job_run_steps
  FOR EACH ROW EXECUTE FUNCTION job_run_steps_append_only();
--> statement-breakpoint
CREATE TRIGGER job_run_steps_no_delete BEFORE DELETE ON job_run_steps
  FOR EACH ROW EXECUTE FUNCTION job_run_steps_append_only();
